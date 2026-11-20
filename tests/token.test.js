"use strict";
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const PLUGIN = path.resolve(__dirname, "..");
const MAIN = path.join(PLUGIN, "main.js");
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? " :: " + JSON.stringify(x) : "")); } };
function fresh() { for (const k of Object.keys(require.cache)) if (k.startsWith(PLUGIN)) delete require.cache[k]; return require(MAIN); }

const USAGE = JSON.stringify({ usage: { rolling: { percent: 10, resetsAt: new Date(Date.now() + 3600e3).toISOString() } } });

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "octok-"));
  const settings = { autoDetect: false, credentials: {} };
  const calls = [];
  global.pi = {
    plugin: {
      getSettings: async () => settings,
      setSettings: async (patch) => { Object.assign(settings, patch); },
      getDataPath: async () => tmp,
    },
    net: { fetch: async (input) => { calls.push(input); return input.url.includes("opencode.ai") ? { status: 200, bodyText: USAGE } : { status: 401, bodyText: "{}" }; } },
    shell: { openExternal: async () => {} },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {} },
  };
  const mod = fresh();

  console.log("1) initial tokens state");
  let r = await mod.onPanelInvoke("quota.tokens");
  check("ok", r.ok === true, r);
  check("opencode false", r.tokens.opencode === false, r.tokens);
  check("openrouter false", r.tokens.openrouter === false, r.tokens);
  check("no token value leaked", !JSON.stringify(r).includes("sk-"), r);

  console.log("2) setToken opencode");
  r = await mod.onPanelInvoke("quota.setToken", { vendor: "opencode", token: "sk-go-abc" });
  check("ok", r.ok === true, r);
  check("persisted to settings", settings.credentials.opencode === "sk-go-abc", settings.credentials);
  check("result has no token", !JSON.stringify(r).includes("sk-go-abc"), r);
  r = await mod.onPanelInvoke("quota.tokens");
  check("opencode true", r.tokens.opencode === true, r.tokens);
  check("tokens result no secret", !JSON.stringify(r).includes("sk-go-abc"), r);

  console.log("3) snapshot shows opencode from settings");
  const snap = await mod.onPanelInvoke("quota.snapshot", { force: true });
  const acct = (snap.accounts || []).find((a) => a.provider === "opencode");
  check("account present", !!acct);
  check("source settings", acct && acct.source === "settings", acct && acct.source);
  check("ok status", acct && acct.status === "ok");
  const oc = calls.find((c) => c.url.includes("opencode.ai"));
  check("bearer uses saved key", oc && oc.headers.authorization === "Bearer sk-go-abc", oc && oc.headers);

  console.log("4) clearToken opencode");
  r = await mod.onPanelInvoke("quota.clearToken", { vendor: "opencode" });
  check("ok", r.ok === true, r);
  check("removed from settings", !("opencode" in settings.credentials), settings.credentials);
  r = await mod.onPanelInvoke("quota.tokens");
  check("opencode false again", r.tokens.opencode === false, r.tokens);
  const snap2 = await mod.onPanelInvoke("quota.snapshot", { force: true });
  check("no opencode account", !(snap2.accounts || []).some((a) => a.provider === "opencode"));

  console.log("5) validation");
  r = await mod.onPanelInvoke("quota.setToken", { vendor: "anthropic", token: "x" });
  check("reject non-api-key vendor", r.ok === false, r);
  r = await mod.onPanelInvoke("quota.setToken", { vendor: "opencode", token: "   " });
  check("reject empty token", r.ok === false, r);
  r = await mod.onPanelInvoke("quota.setToken", { vendor: "opencode", token: "x".repeat(5000) });
  check("reject overlong token", r.ok === false, r);
  r = await mod.onPanelInvoke("quota.clearToken", { vendor: "nope" });
  check("reject clear unknown vendor", r.ok === false, r);

  console.log("6) openrouter also supported");
  r = await mod.onPanelInvoke("quota.setToken", { vendor: "openrouter", token: "sk-or-1" });
  check("ok", r.ok === true, r);
  r = await mod.onPanelInvoke("quota.tokens");
  check("openrouter true", r.tokens.openrouter === true, r.tokens);
  check("opencode still false", r.tokens.opencode === false, r.tokens);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });