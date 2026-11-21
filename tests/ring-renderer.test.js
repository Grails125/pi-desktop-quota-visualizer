"use strict";
// Smoke-test the renderer module: mount slot, fetch summary, render ring, click -> detail layer.
const fs = require("node:fs");
const path = require("node:path");
const RENDERER = path.join(__dirname, "..", "renderer", "quota-ring.mjs");
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? " :: " + JSON.stringify(x) : "")); } };

function node(tag) {
  const n = {
    tagName: (tag || "div").toUpperCase(), children: [], parentNode: null, attrs: {}, style: {},
    className: "", textContent: "", listeners: {},
    append(...k) { for (const c of k) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } } },
    appendChild(c) { n.append(c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return n.attrs[k] ?? null; },
    addEventListener(t, fn) { (n.listeners[t] = n.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { n.listeners[t] = (n.listeners[t] || []).filter((f) => f !== fn); },
    contains(o) { let x = o; while (x) { if (x === n) return true; x = x.parentNode; } return false; },
    click() { for (const fn of n.listeners.click || []) fn({ target: n }); },
  };
  return n;
}
global.document = { createElement: node, addEventListener() {}, removeEventListener() {}, body: node("body") };
global.window = global;

// React stub with a hook cursor reset before each render.
let stateQueue = [];
let hookCursor = 0;
let effectQueue = [];
const React = {
  useState(initial) {
    const idx = hookCursor++;
    if (idx >= stateQueue.length) stateQueue.push(initial);
    return [stateQueue[idx], (value) => { stateQueue[idx] = value; }];
  },
  useEffect(fn) { effectQueue.push(fn); },
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
      const el = node("div");
      const layer = { element: el, closed: false, close() { layer.closed = true; } };
      layers.push(layer);
      return layer;
    },
  },
  slots: {
    register(spec) { registered = spec; return () => { registered = null; }; },
  },
  dispatch: async (action, payload) => {
    dispatched.push({ action, payload });
    return {
      ok: true,
      remaining: 20,
      accounts: [{ label: "OpenCode Go", provider: "opencode", windows: [
        { label: "session", remaining: 88, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
        { label: "week", remaining: 20, resetsAt: new Date(Date.now() + 86400e3).toISOString() },
      ] }],
    };
  },
};

function render(component) {
  hookCursor = 0;
  effectQueue = [];
  return component({ position: "right" });
}

async function loadModule() {
  let source = fs.readFileSync(RENDERER, "utf8");
  source = source.replace(/import React from "react";/, "const React = globalThis.__PI_RENDERER_HOST__.react;");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

(async () => {
  console.log("load renderer module");
  const mod = await loadModule();
  check("exports onLoad", typeof mod.onLoad === "function");
  check("exports onUnload", typeof mod.onUnload === "function");

  console.log("onLoad");
  const dispose = mod.onLoad(pi);
  check("style injected", typeof injectedCss === "string" && injectedCss.includes("quota-ring-svg"));
  check("slot=composerControl", registered && registered.slot === "composerControl", registered && registered.slot);
  check("positions=right (left of context ring)", registered && Array.isArray(registered.positions) && registered.positions.includes("right"), registered && registered.positions);
  check("component is function", typeof registered?.component === "function");

  console.log("mount component (useEffect => dispatch)");
  let element = render(registered.component);
  check("initial render null (no data yet)", element === null, element);
  for (const fn of effectQueue) fn();
  await new Promise((r) => setTimeout(r, 10));
  element = render(registered.component);
  check("dispatch called once", dispatched.length === 1, dispatched);
  check("plugin.call + quota.ring", dispatched[0]?.action === "plugin.call" && dispatched[0]?.payload?.method === "quota.ring", dispatched[0]);
  check("ring button rendered", !!element && element.type === "button", element && element.type);
  check("data-level=warn (20%)", element?.props?.["data-level"] === "warn", element?.props?.["data-level"]);
  check("aria-label has 20%", /20%/.test(element?.props?.["aria-label"] || ""), element?.props?.["aria-label"]);
  const children = element?.children || [];
  check("svg + value span", children.length === 2 && children[0].type === "svg" && children[1].type === "span", children.map((c) => c.type));
  const progress = children[0]?.children?.[1];
  check("progress circle has dasharray", !!progress?.props?.strokeDasharray, progress?.props);

  console.log("click -> detail layer");
  element.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  check("layer opened", layers.length === 1, layers.length);
  const panel = layers[0]?.element?.children?.[0];
  check("panel rendered", !!panel && panel.className === "quota-ring-panel", panel && panel.className);
  const text = JSON.stringify(panel, (k, v) => (k === "parentNode" ? undefined : v));
  check("shows OpenCode Go", text.includes("OpenCode Go"));
  check("shows 剩余 20%", text.includes("剩余 20%"));
  check("shows 剩余 88%", text.includes("剩余 88%"));
  check("no token in details", !text.includes("sk-"));
  check("has close button", text.includes("qrp-close"));

  console.log("dispose");
  dispose();
  check("layer closed on dispose", layers.every((l) => l.closed), layers.map((l) => l.closed));
  check("slot disposed", registered === null);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SMOKE ERROR", e); process.exit(2); });