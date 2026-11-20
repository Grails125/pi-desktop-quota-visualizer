"use strict";
// Minimal DOM stub to drive the panel's API-key UI end to end.
const fs = require("node:fs");
const path = require("node:path");
const PANEL = path.join(__dirname, "..", "views", "quota.html");
const html = fs.readFileSync(PANEL, "utf8");
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n;\n");

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x ? " :: " + JSON.stringify(x) : "")); } };

function makeNode(tag) {
  const node = {
    tagName: (tag || "div").toUpperCase(),
    children: [], parentNode: null, dataset: {}, attrs: {}, style: {},
    className: "", textContent: "", innerHTML: "", value: "", placeholder: "",
    disabled: false, hidden: false, type: "", autocomplete: "", spellcheck: false, autocapitalize: "",
    _handlers: {},
    append(...kids) { for (const k of kids) { if (k && typeof k === "object") { k.parentNode = node; node.children.push(k); } } },
    appendChild(k) { node.append(k); return k; },
    remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node); node.parentNode = null; },
    replaceChildren(...kids) { node.children = []; node.append(...kids); },
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute(k) { return node.attrs[k] ?? null; },
    addEventListener(type, fn) { (node._handlers[type] = node._handlers[type] || []).push(fn); },
    contains(other) { let n = other; while (n) { if (n === node) return true; n = n.parentNode; } return false; },
    focus() { document.activeElement = node; },
    scrollIntoView() {},
    closest(sel) {
      const key = sel === "[data-auth]" ? "auth" : sel === "[data-account-id]" ? "accountId" : null;
      let n = node;
      while (n) { if (key && n.dataset && n.dataset[key] !== undefined) return n; n = n.parentNode; }
      return null;
    },
    click() { dispatch(node, "click"); },
    querySelector() { return null; },
  };
  return node;
}
function dispatch(target, type) {
  const event = { target, preventDefault() {}, stopPropagation() {}, key: "" };
  let n = target;
  while (n) { for (const fn of n._handlers[type] || []) fn(event); n = n.parentNode; }
}
const byId = new Map();
const document = {
  hidden: false, activeElement: null, documentElement: makeNode("html"),
  getElementById(id) { if (!byId.has(id)) byId.set(id, makeNode("div")); return byId.get(id); },
  createElement: makeNode,
  createTextNode: (t) => ({ textContent: t, parentNode: null }),
  addEventListener() {},
};
const bridgeCalls = [];
let tokensState = { opencode: false, openrouter: false };
const bridge = {
  invoke: async (channel, payload) => {
    bridgeCalls.push({ channel, payload });
    if (channel === "quota.tokens") return { ok: true, tokens: { ...tokensState } };
    if (channel === "quota.setToken") { tokensState[payload.vendor] = true; return { ok: true }; }
    if (channel === "quota.clearToken") { tokensState[payload.vendor] = false; return { ok: true }; }
    if (channel === "quota.auth.status") return { ok: true, accounts: [], login: null };
    if (channel === "quota.snapshot" || channel === "quota.refresh")
      return { ok: true, accounts: [], generatedAt: new Date().toISOString(), demo: false, autoDetect: true, refreshSeconds: 300 };
    if (channel === "app.getAppearance") return { locale: "zh-CN" };
    return { ok: true };
  },
  on() {},
};
global.window = global;
global.document = document;
Object.defineProperty(global, "navigator", { value: { language: "zh-CN" }, configurable: true });
global.window.pluginBridge = bridge;
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
global.addEventListener = () => {};
global.removeEventListener = () => {};

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

(async () => {
  // Run panel script.
  new Function(script)();
  await flush();

  console.log("open manage-accounts");
  document.getElementById("auth-toggle").click();
  await flush();

  const keysHost = document.getElementById("auth-keys");
  check("key groups rendered", keysHost.children.length === 2, keysHost.children.length);
  const ocGroup = keysHost.children.find((g) => g.dataset.vendor === "opencode");
  check("opencode group present", !!ocGroup);
  const findAll = (node, pred, out = []) => { for (const c of node.children || []) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; };
  const input = findAll(ocGroup, (c) => c.type === "password")[0];
  const saveBtn = findAll(ocGroup, (c) => c.dataset && c.dataset.auth === "key-save")[0];
  const clearBtn = findAll(ocGroup, (c) => c.dataset && c.dataset.auth === "key-clear")[0];
  check("password input present", !!input);
  check("save button present", !!saveBtn);
  check("clear button present", !!clearBtn);
  check("input enabled (not blocked)", input && input.disabled === false, input && input.disabled);
  check("clear disabled when unset", clearBtn && clearBtn.disabled === true, clearBtn && clearBtn.disabled);
  check("status shows unset", /未配置/.test(ocGroup.children.map((c) => c.textContent).join("")), ocGroup.children.map((c) => c.textContent));

  console.log("save empty -> validation message");
  saveBtn.click();
  await flush();
  check("no setToken call on empty", !bridgeCalls.some((c) => c.channel === "quota.setToken"));
  check("empty message shown", /请先填写/.test(document.getElementById("auth-key-message").textContent), document.getElementById("auth-key-message").textContent);

  console.log("save a key");
  input.value = "sk-go-smoke";
  saveBtn.click();
  await flush(10);
  const setCall = bridgeCalls.find((c) => c.channel === "quota.setToken");
  check("setToken invoked", !!setCall, bridgeCalls.map((c) => c.channel));
  check("vendor opencode", setCall && setCall.payload.vendor === "opencode", setCall && setCall.payload);
  check("token forwarded", setCall && setCall.payload.token === "sk-go-smoke", setCall && setCall.payload);
  check("input cleared after save", input.value === "", input.value);
  check("saved message", /已保存/.test(document.getElementById("auth-key-message").textContent), document.getElementById("auth-key-message").textContent);
  check("status shows configured", /已配置/.test(ocGroup.children.map((c) => c.textContent).join("")));
  check("clear now enabled", clearBtn.disabled === false, clearBtn.disabled);

  console.log("clear the key");
  clearBtn.click();
  await flush(10);
  const clearCall = bridgeCalls.find((c) => c.channel === "quota.clearToken");
  check("clearToken invoked", !!clearCall);
  check("clear vendor opencode", clearCall && clearCall.payload.vendor === "opencode");
  check("status back to unset", /未配置/.test(ocGroup.children.map((c) => c.textContent).join("")));

  console.log("close panel clears input");
  input.value = "leftover";
  document.getElementById("auth-close").click();
  await flush();
  check("input cleared on close", input.value === "", input.value);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE ERROR", e); process.exit(2); });