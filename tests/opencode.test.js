"use strict";
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const PLUGIN = path.resolve(__dirname, "..");
const MAIN = path.join(PLUGIN, "main.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " :: " + JSON.stringify(extra) : "")); }
}

function freshModule() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(PLUGIN)) delete require.cache[key];
  }
  return require(MAIN);
}

function setupPi({ settings, fetchImpl, dataDir }) {
  global.pi = {
    plugin: {
      getSettings: async () => settings,
      setSettings: async () => {},
      getDataPath: async () => dataDir,
    },
    net: { fetch: fetchImpl },
    shell: { openExternal: async () => {} },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {} },
  };
}

const USAGE_BODY = JSON.stringify({
  usage: {
    rolling: { percent: 20, resetsAt: new Date(Date.now() + 3600e3).toISOString(), status: "ok" },
    weekly: { percent: 55.5, resetsAt: new Date(Date.now() + 86400e3).toISOString(), status: "ok" },
    monthly: { percent: 90, resetsAt: new Date(Date.now() + 5 * 86400e3).toISOString(), status: "ok" },
  },
});

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocq-"));

  // ── A) 手工令牌 happy path ──
  {
    const calls = [];
    setupPi({
      settings: { autoDetect: false, credentials: { opencode: "sk-go-test" } },
      dataDir: path.join(tmp, "a"),
      fetchImpl: async (input) => {
        calls.push(input);
        if (input.url.includes("opencode.ai")) return { status: 200, bodyText: USAGE_BODY };
        return { status: 401, bodyText: "{}" };
      },
    });
    const mod = freshModule();
    const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
    const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
    console.log("A) manual token happy path");
    check("account present", !!acct, snap);
    check("source=settings", acct && acct.source === "settings", acct && acct.source);
    check("status ok", acct && acct.status === "ok", acct && acct.status);
    check("3 windows", acct && acct.windows.length === 3, acct && acct.windows.length);
    const byKey = Object.fromEntries((acct?.windows || []).map((w) => [w.key, w]));
    check("rolling=session", byKey["opencode-rolling"]?.period === "session", byKey["opencode-rolling"]);
    check("weekly=week", byKey["opencode-weekly"]?.period === "week");
    check("monthly=month", byKey["opencode-monthly"]?.period === "month");
    check("rolling remaining 80", byKey["opencode-rolling"]?.remainingPercent === 80, byKey["opencode-rolling"]?.remainingPercent);
    check("weekly used 55.5", byKey["opencode-weekly"]?.usedPercent === 55.5, byKey["opencode-weekly"]?.usedPercent);
    check("monthly remaining 10", byKey["opencode-monthly"]?.remainingPercent === 10, byKey["opencode-monthly"]?.remainingPercent);
    check("resetsAt parsed", !!byKey["opencode-rolling"]?.resetsAt);
    const ocCall = calls.find((c) => c.url.includes("opencode.ai"));
    check("correct URL", ocCall && ocCall.url === "https://opencode.ai/zen/go/v1/usage", ocCall && ocCall.url);
    check("Bearer header", ocCall && ocCall.headers.authorization === "Bearer sk-go-test", ocCall && ocCall.headers);
    check("no other vendor accounts", (snap.accounts || []).every((a) => a.provider === "opencode"), snap.accounts.map(a=>a.provider));
  }

  // ── B) 404 无 Go 订阅 ──
  {
    setupPi({
      settings: { autoDetect: false, credentials: { opencode: "sk-go-test" } },
      dataDir: path.join(tmp, "b"),
      fetchImpl: async (input) => input.url.includes("opencode.ai")
        ? { status: 404, bodyText: "{}" } : { status: 401, bodyText: "{}" },
    });
    const mod = freshModule();
    const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
    const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
    console.log("B) 404 no Go subscription");
    check("account present", !!acct);
    check("status empty", acct && acct.status === "empty", acct && acct.status);
    check("no windows", acct && acct.windows.length === 0);
    check("hint mentions Go", acct && /Go/.test(acct.hint || ""), acct && acct.hint);
  }

  // ── C) 401 凭据失效 ──
  {
    setupPi({
      settings: { autoDetect: false, credentials: { opencode: "bad" } },
      dataDir: path.join(tmp, "c"),
      fetchImpl: async (input) => input.url.includes("opencode.ai")
        ? { status: 401, bodyText: "{}" } : { status: 401, bodyText: "{}" },
    });
    const mod = freshModule();
    const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
    const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
    console.log("C) 401 invalid credential");
    check("account present (error)", !!acct);
    check("status error", acct && acct.status === "error", acct && acct.status);
    check("error mentions 401", acct && /401/.test(acct.error || ""), acct && acct.error);
  }

  // ── D) CLI 自动发现 ──
  {
    const xdg = path.join(tmp, "xdg");
    fs.mkdirSync(path.join(xdg, "opencode"), { recursive: true });
    fs.writeFileSync(path.join(xdg, "opencode", "auth.json"),
      JSON.stringify({ opencode: { type: "api", key: "cli-key-123" } }));
    const oldXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = xdg;
    const calls = [];
    setupPi({
      settings: { autoDetect: true, credentials: {} },
      dataDir: path.join(tmp, "d"),
      fetchImpl: async (input) => {
        calls.push(input);
        if (input.url.includes("opencode.ai")) return { status: 200, bodyText: USAGE_BODY };
        return { status: 401, bodyText: "{}" };
      },
    });
    const mod = freshModule();
    const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
    const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
    console.log("D) CLI auto-detect via XDG_DATA_HOME");
    check("account present", !!acct, snap.accounts);
    check("source=cli", acct && acct.source === "cli", acct && acct.source);
    check("status ok", acct && acct.status === "ok");
    const ocCall = calls.find((c) => c.url.includes("opencode.ai"));
    check("uses CLI key", ocCall && ocCall.headers.authorization === "Bearer cli-key-123", ocCall && ocCall.headers);
    if (oldXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = oldXdg;
  }

  // ── E) 无凭据 → 不显示 ──
  {
    setupPi({
      settings: { autoDetect: false, credentials: {} },
      dataDir: path.join(tmp, "e"),
      fetchImpl: async () => ({ status: 200, bodyText: USAGE_BODY }),
    });
    const mod = freshModule();
    const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
    const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
    console.log("E) no credential -> hidden");
    check("no opencode account", !acct, acct);
  }

  // ── F) 部分窗口缺失 + percent 字符串容错 ──
  {
    const body = JSON.stringify({ usage: { rolling: { percent: "33.3", resetsAt: null } } });
    setupPi({
      settings: { autoDetect: false, credentials: { opencode: "k" } },
      dataDir: path.join(tmp, "f"),
      fetchImpl: async (input) => input.url.includes("opencode.ai")
        ? { status: 200, bodyText: body } : { status: 401, bodyText: "{}" },
    });
    const mod = freshModule();
    const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
    const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
    console.log("F) partial windows + string percent");
    check("1 window", acct && acct.windows.length === 1, acct && acct.windows.length);
    check("string percent parsed", acct && acct.windows[0].usedPercent === 33.3, acct && acct.windows[0]);
    check("null resetsAt ok", acct && acct.windows[0].resetsAt === null);
  }

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });