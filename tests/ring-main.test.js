"use strict";
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const PLUGIN = path.resolve(__dirname, "..");
const MAIN = path.join(PLUGIN, "main.js");
const USAGE = JSON.stringify({ usage: {
  rolling: { percent: 12, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
  weekly: { percent: 80, resetsAt: new Date(Date.now() + 86400e3).toISOString() },
} });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
function fresh() { for (const k of Object.keys(require.cache)) if (k.includes("subscription-quota")) delete require.cache[k]; return require(MAIN); }

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ring-main-"));
  const settings = { autoDetect: false, credentials: { opencode: "sk-secret-token-123" } };
  global.pi = {
    plugin: { getSettings: async () => settings, setSettings: async (p) => Object.assign(settings, p), getDataPath: async () => tmp },
    net: { fetch: async (input) => input.url.includes("opencode.ai") ? { status: 200, bodyText: USAGE } : { status: 401, bodyText: "{}" } },
    shell: { openExternal: async () => {} },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {} },
  };
  const mod = fresh();

  console.log("1) quota.ring summary");
  const r = await mod.onRendererCall("quota.ring");
  check("ok", r.ok === true, r);
  check("remaining = min of all windows (20% = 100-80)", r.remaining === 20, r.remaining);
  check("has accounts", Array.isArray(r.accounts) && r.accounts.length >= 1, r.accounts);
  const oc = (r.accounts || []).find((a) => a.provider === "opencode");
  check("opencode present", !!oc, r.accounts);
  check("2 windows", oc && oc.windows.length === 2, oc && oc.windows.length);
  check("window label localized-ish", oc && oc.windows.some((w) => /session|week/.test(w.label)), oc && oc.windows.map((w) => w.label));
  check("no token leaked", !JSON.stringify(r).includes("sk-secret-token-123"), r);
  check("no email field", !JSON.stringify(r).includes("email"), r);
  check("generatedAt set", !!r.generatedAt);

  console.log("2) unknown method rejects");
  let threw = false;
  try { await mod.onRendererCall("nope"); } catch { threw = true; }
  check("throws on unknown method", threw);

  console.log("3) no credentials -> empty summary");
  settings.credentials = {};
  // 通过通道清凭据（同时 invalidateCache），避免读到上一次的缓存快照。
  await mod.onPanelInvoke("quota.clearToken", { vendor: "opencode" });
  const r2 = await mod.onRendererCall("quota.ring");
  check("ok", r2.ok === true, r2);
  check("remaining null", r2.remaining === null, r2.remaining);
  check("no accounts", (r2.accounts || []).length === 0, r2.accounts);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });