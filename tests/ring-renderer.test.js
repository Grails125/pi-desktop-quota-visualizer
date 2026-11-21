"use strict";
const fs = require("node:fs");
const path = require("node:path");
const RENDERER = path.join(__dirname, "..", "renderer", "quota-ring.mjs");
let pass = 0, fail = 0;
const check = (name, condition, extra) => {
  if (condition) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); }
};

function node(tag) {
  const element = {
    tagName: String(tag || "div").toUpperCase(), children: [], parentNode: null,
    attrs: {}, style: {}, className: "", textContent: "", listeners: {},
    offsetHeight: 200, isConnected: true, disabled: false,
    getBoundingClientRect() { return { left: 350, right: 380, top: 700, bottom: 728, width: 30, height: 28 }; },
    append(...children) {
      for (const child of children) {
        if (child && typeof child === "object") { child.parentNode = element; element.children.push(child); }
      }
    },
    appendChild(child) { element.append(child); return child; },
    setAttribute(key, value) { element.attrs[key] = String(value); },
    getAttribute(key) { return element.attrs[key] ?? null; },
    addEventListener(type, listener) { (element.listeners[type] ||= []).push(listener); },
    removeEventListener(type, listener) { element.listeners[type] = (element.listeners[type] || []).filter((fn) => fn !== listener); },
    contains(other) { let current = other; while (current) { if (current === element) return true; current = current.parentNode; } return false; },
  };
  return element;
}

const documentListeners = new Map();
global.document = {
  createElement: node,
  addEventListener(type, callback) { documentListeners.set(type, callback); },
  removeEventListener(type, callback) { if (documentListeners.get(type) === callback) documentListeners.delete(type); },
  body: node("body"),
};
global.window = global;
global.innerWidth = 1200;
global.innerHeight = 800;
const windowListeners = new Map();
global.addEventListener = (type, callback) => windowListeners.set(type, callback);
global.removeEventListener = (type, callback) => { if (windowListeners.get(type) === callback) windowListeners.delete(type); };

let enabled = true;
let selected = "Go";
let onMutation = () => {};
global.MutationObserver = class {
  constructor(callback) { onMutation = callback; }
  observe() {}
  disconnect() { onMutation = () => {}; }
};

let stateQueue = [];
let stateCursor = 0;
let refCursor = 0;
let effectQueue = [];
const refs = [];
const React = {
  useState(initial) {
    const index = stateCursor++;
    if (index >= stateQueue.length) stateQueue.push(initial);
    return [stateQueue[index], (value) => {
      stateQueue[index] = typeof value === "function" ? value(stateQueue[index]) : value;
    }];
  },
  useRef(initial) {
    const index = refCursor++;
    if (!refs[index]) refs[index] = { current: initial };
    return refs[index];
  },
  useEffect(callback) { effectQueue.push(callback); },
  createElement(type, props, ...children) { return { type, props: props || {}, children }; },
};
global.__PI_RENDERER_HOST__ = { react: React };

const layers = [];
const dispatched = [];
let registered = null;
let injectedCss = null;
const pi = {
  ui: {
    injectStyle(css) { injectedCss = css; return () => {}; },
    openLayer() {
      const element = node("div");
      const layer = { element, closed: false, close() { layer.closed = true; } };
      layers.push(layer);
      return layer;
    },
  },
  slots: {
    register(spec) { registered = spec; return () => { registered = null; }; },
  },
  dispatch: async (action, payload) => {
    dispatched.push({ action, payload });
    if (!enabled) return { ok: true, enabled: false };
    return {
      ok: true, enabled: true, activeVendor: "opencode",
      ring: { label: payload.args.modelLabel === "Go" ? "5 小时额度" : "周额度", remaining: payload.args.modelLabel === "Go" ? 88 : 35, resetsAt: new Date(Date.now() + 3600e3).toISOString(), accountLabel: "OpenCode Go", vendor: "opencode" },
      accounts: [{ label: "OpenCode Go", provider: "opencode", windows: [
        { label: "5 小时额度", remaining: 88, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
        { label: "周额度", remaining: 20, resetsAt: new Date(Date.now() + 86400e3).toISOString() },
      ] }],
    };
  },
};

function applyRefs(element) {
  const ref = element?.props?.ref;
  if (typeof ref === "function") ref({ closest: () => ({ querySelector: () => ({ textContent: selected }) }) });
  for (const child of element?.children ?? []) applyRefs(child);
}

function render(component) {
  stateCursor = 0;
  refCursor = 0;
  effectQueue = [];
  const element = component({ position: "right" });
  applyRefs(element);
  return element;
}

async function loadModule() {
  const source = fs.readFileSync(RENDERER, "utf8").replace(
    /import React from "react";/,
    "const React = globalThis.__PI_RENDERER_HOST__.react;",
  );
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

(async () => {
  const mod = await loadModule();
  check("exports onLoad/onUnload", typeof mod.onLoad === "function" && typeof mod.onUnload === "function");
  const dispose = mod.onLoad(pi);
  check("style + slot", typeof injectedCss === "string" && registered?.slot === "composerControl" && registered.positions.includes("right"));

  let element = render(registered.component);
  const cleanup = effectQueue[0]();
  await new Promise((resolve) => setTimeout(resolve, 10));
  element = render(registered.component);
  check("ring rendered from first tier", element?.type === "button" && /5 小时额度剩余88%/.test(element.props["aria-label"]), element?.props?.["aria-label"]);

  const anchor = { isConnected: true, getBoundingClientRect: () => ({ left: 350, right: 380, top: 700, bottom: 728 }) };
  element.props.onPointerEnter({ currentTarget: anchor });
  await new Promise((resolve) => setTimeout(resolve, 330));
  const tip = layers.at(-1)?.element.children[0];
  check("native tooltip copy", tip?.className === "ui-tooltip" && /5 小时额度剩余88%，.*后重置/.test(tip?.textContent || ""), tip?.textContent);
  element.props.onPointerLeave();

  const pane = { getBoundingClientRect: () => ({ left: 240, right: 900 }) };
  const ringAnchor = { getBoundingClientRect: () => ({ left: 350, right: 380, top: 700, bottom: 728 }), closest: () => pane, contains: () => false };
  element.props.onClick({ currentTarget: ringAnchor });
  await new Promise((resolve) => setTimeout(resolve, 10));
  let panel = layers.at(-1)?.element.children[0];
  let text = JSON.stringify(panel, (key, value) => (key === "parentNode" ? undefined : value));
  check("detail shows all subscriptions", text.includes("5 小时额度") && text.includes("周额度") && text.includes("剩余 20%"));
  check("refresh replaces close", text.includes("qrp-refresh") && !text.includes("qrp-close"));
  check("refresh note kept, tier note removed", text.includes("数据每 60 秒更新") && !text.includes("圆环显示当前模型订阅的第一档额度"));
  check("native alignment", panel.style.left === "350px" && panel.style.top === "492px", panel.style);
  check("countdown opacity", /\.qrp-reset\{[^}]*opacity:\.8/.test(injectedCss));

  const refreshButton = panel.children[0].children.at(-1);
  const before = dispatched.length;
  refreshButton.listeners.click[0]();
  await new Promise((resolve) => setTimeout(resolve, 10));
  check("refresh requests force update", dispatched.length === before + 1 && dispatched.at(-1).payload.args.force === true, dispatched.slice(before));

  documentListeners.get("keydown")({ key: "Escape" });
  check("escape closes details", layers.at(-1).closed);
  element.props.onClick({ currentTarget: ringAnchor });
  check("click ring reopens details", layers.at(-1).closed === false);
  documentListeners.get("pointerdown")({ target: node("div") });
  check("outside click closes details", layers.at(-1).closed);
  element.props.onClick({ currentTarget: ringAnchor });
  element.props.onClick({ currentTarget: ringAnchor });
  check("second ring click closes details", layers.at(-1).closed);

  selected = "Claude";
  onMutation();
  await new Promise((resolve) => setTimeout(resolve, 220));
  element = render(registered.component);
  check("model change fetches matching quota", dispatched.at(-1).payload.args.modelLabel === "Claude" && /周额度剩余35%/.test(element.props["aria-label"]), element.props["aria-label"]);

  enabled = false;
  windowListeners.get("focus")();
  await new Promise((resolve) => setTimeout(resolve, 10));
  check("disabled hides ring", render(registered.component).props.hidden === true);

  dispose();
  cleanup();
  check("unload closes everything", registered === null && layers.every((layer) => layer.closed));
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error("SMOKE ERROR", error); process.exit(2); });
