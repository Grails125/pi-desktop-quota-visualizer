"use strict";
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const PLUGIN = path.resolve(__dirname, "..");
const MAIN = path.join(PLUGIN, "main.js");
// opencode: rolling used 12% -> remaining 88; weekly used 80% -> remaining 20
const OPENCODE_USAGE = JSON.stringify({ usage: {
  rolling: { percent: 12, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
  weekly: { percent: 80, resetsAt: new Date(Date.now() + 86400e3).toISOString() },
} });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };
function fresh() { for (const k of Object.keys(require.cache)) if (k.startsWith(PLUGIN)) delete require.cache[k]; return require(MAIN); }
const wait = () => new Promise((r) => setTimeout(r, 10));

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ring-main-"));
  const settings = { autoDetect: false, credentials: { opencode: "sk-secret-token-123" }, accounts: [
    { provider: "anthropic", label: "Claude", windows: [{ period: "week", usedPercent: 65 }] },
  ] };
  const models = [
    { isDefault: true, providerId: "opencode", modelId: "go/latest" },
    { providerId: "anthropic", modelId: "claude-sonnet", alias: "Claude 工作" },
    { providerId: "openrouter", modelId: "shared" },
    { providerId: "opencode", modelId: "shared" },
  ];
  global.pi = {
    plugin: { getSettings: async () => settings, setSettings: async (p) => Object.assign(settings, p), getDataPath: async () => tmp },
    net: { fetch: async (input) => input.url.includes("opencode.ai") ? { status: 200, bodyText: OPENCODE_USAGE } : { status: 401, bodyText: "{}" } },
    models: { list: async () => models },
    shell: { openExternal: async () => {} },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {} },
  };
  const mod = fresh();

  console.log("1) ring = first window of active model vendor");
  let r = await mod.onRendererCall("quota.ring", { modelLabel: "go/latest" });
  check("ok", r.ok === true, r);
  check("activeVendor=opencode", r.activeVendor === "opencode", r.activeVendor);
  check("remaining = first window 88 (not min 20)", r.remaining === 88, r.remaining);
  check("ring label Chinese 5 小时额度", r.ring?.label === "5 小时额度", r.ring);
  check("ring vendor", r.ring?.vendor === "opencode", r.ring);
  check("detail has ALL windows (2)", r.accounts?.[0]?.windows?.length === 2, r.accounts);
  check("detail window labels Chinese", r.accounts?.[0]?.windows?.every((w) => /额度/.test(w.label)), r.accounts?.[0]?.windows);
  check("no token leaked", !JSON.stringify(r).includes("sk-secret-token-123"));
  check("no email leaked", !JSON.stringify(r).includes("email"));
  check("generatedAt", !!r.generatedAt);
  check("ring setting defaults on", r.enabled === true);

  r = await mod.onRendererCall("quota.ring", { modelLabel: "Claude 工作" });
  check("selected alias overrides unchanged default", r.activeVendor === "anthropic" && r.remaining === 35 && r.ring?.label === "周额度", r);
  check("details still include both subscriptions", r.accounts.length === 2);
  for (const modelLabel of ["shared", "unknown", ""]) {
    r = await mod.onRendererCall("quota.ring", { modelLabel });
    check(`no wrong quota for ${modelLabel || "missing label"}`, r.ring === null && r.accounts.length === 2, r);
  }

  settings.showComposerQuotaRing = false;
  r = await mod.onRendererCall("quota.ring", { modelLabel: "go/latest" });
  check("ring disabled without returning details", r.enabled === false && !r.accounts);
  const snapshot = await mod.onPanelInvoke("quota.snapshot", {});
  check("main panel still shows subscriptions", snapshot.accounts.length === 2);
  settings.showComposerQuotaRing = true;

  console.log("4) unknown method rejects");
  let threw = false;
  try { await mod.onRendererCall("nope"); } catch { threw = true; }
  check("throws", threw);

  console.log("5) no credentials -> empty");
  settings.accounts = [];
  await mod.onPanelInvoke("quota.clearToken", { vendor: "opencode" });
  r = await mod.onRendererCall("quota.ring");
  check("ok", r.ok === true);
  check("remaining null", r.remaining === null, r.remaining);
  check("no accounts", (r.accounts || []).length === 0);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });