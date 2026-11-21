/**
 * 订阅额度圆环 —— 挂在输入框右侧、上下文圆环左边（composerControl / right）。
 * 圆环取当前模型对应订阅的第一档额度窗口；点击浮窗显示所有订阅详情。
 * 只通过 plugin.call 读取只读额度摘要：账号名、窗口标签、剩余百分比、重置时间。
 * 不接触令牌、不发起网络请求、不改宿主对话。
 */
import React from "react";

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const POLL_MS = 60_000;
const PANEL_WIDTH = 340;

const CSS = `
.quota-ring-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;
  padding:0 2px;border-radius:var(--radius-full,999px);color:var(--ds-text-secondary);
  background:transparent;border:0;cursor:pointer;transition:background var(--motion-duration-fast,120ms) var(--motion-ease-out,ease),color var(--motion-duration-fast,120ms) var(--motion-ease-out,ease)}
.quota-ring-btn:hover{background:var(--ds-bg-hover);color:var(--ds-text-primary)}
.quota-ring-btn[hidden]{display:none}
.quota-ring-btn:focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px}
.quota-ring-svg{width:17px;height:17px;overflow:visible;transform:rotate(-90deg)}
.quota-ring-track,.quota-ring-progress{fill:none;stroke-width:2.5px}
.quota-ring-track{stroke:var(--ds-text-primary);opacity:.14}
.quota-ring-progress{stroke:currentColor;stroke-linecap:round;transition:stroke-dashoffset var(--motion-duration-normal,200ms) var(--motion-ease-out,ease)}
.quota-ring-value{font-size:var(--text-xs,11px);font-weight:var(--font-weight-semibold,600);line-height:var(--leading-compact,1.2);font-variant-numeric:tabular-nums;white-space:nowrap}
.quota-ring-btn[data-level="ok"]{color:var(--ds-success,#3fb950)}
.quota-ring-btn[data-level="warn"]{color:var(--ds-warning,#d29922)}
.quota-ring-btn[data-level="low"]{color:var(--ds-danger,#f85149)}
.quota-ring-panel{position:fixed;left:0;top:0;width:340px;max-height:min(60vh,520px);
  overflow-y:auto;box-sizing:border-box;padding:16px;border-radius:var(--radius-md-plus,10px);
  border:1px solid var(--ds-border-default);background:var(--ds-bg-elevated-opaque,var(--ds-bg-elevated,#1e1e1e));
  color:var(--ds-text-primary);box-shadow:var(--ds-shadow-dialog,0 8px 28px rgba(0,0,0,.4));
  font-size:var(--text-xs,12px);line-height:var(--leading-body,1.5);z-index:1;text-align:left}
.quota-ring-panel h4{margin:0 0 12px;font-size:var(--text-base,13px);display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.quota-ring-panel .qrp-context{color:var(--ds-text-secondary);font-size:var(--text-xxs,10px);font-weight:var(--font-weight-normal,400)}
.quota-ring-panel .qrp-refresh{border:1px solid var(--ds-border-default);border-radius:6px;background:transparent;color:var(--ds-text-secondary);cursor:pointer;padding:2px 8px;font-size:var(--text-xxs,10px)}
.quota-ring-panel .qrp-refresh:hover{background:var(--ds-bg-hover);color:var(--ds-text-primary)}
.qrp-account{margin:0 0 12px;padding-top:10px;border-top:1px solid var(--ds-border-default)}
.qrp-account:first-of-type{border-top:0;padding-top:0}
.qrp-name{font-weight:var(--font-weight-semibold,600);margin-bottom:6px;word-break:break-word}
.qrp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0}
.qrp-row .qrp-label{color:var(--ds-text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qrp-row .qrp-val{font-variant-numeric:tabular-nums;font-weight:var(--font-weight-semibold,600);flex:none}
.qrp-reset{color:var(--ds-text-tertiary,var(--ds-text-secondary));font-size:var(--text-xxs,10px);margin-left:6px;opacity:.8}
.qrp-empty{color:var(--ds-text-secondary);margin:0}
.qrp-foot{margin-top:10px;color:var(--ds-text-tertiary,var(--ds-text-secondary));font-size:var(--text-xxs,10px)}
`;

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function level(remaining) {
  if (remaining <= 10) return "low";
  if (remaining <= 25) return "warn";
  return "ok";
}

function resetText(iso) {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((at - Date.now()) / 60000);
  if (minutes <= 0) return "即将重置";
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}后`;
  return `${Math.floor(hours / 24)} 天后`;
}

/** Match the context inspector: align left to the trigger within the chat pane. */
function placePanel(panel, anchor, pane) {
  const margin = 16, gap = 8;
  const rect = anchor.getBoundingClientRect();
  const bounds = pane?.getBoundingClientRect();
  const leftEdge = (bounds?.left ?? 0) + margin;
  const rightEdge = (bounds?.right ?? window.innerWidth) - margin;
  const maxWidth = Math.floor(rightEdge - leftEdge);
  if (maxWidth <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
  const width = Math.min(PANEL_WIDTH, maxWidth);
  panel.style.width = `${width}px`;
  const height = panel.offsetHeight;
  const above = rect.top - height - gap;
  const below = rect.bottom + gap;
  const bottomLimit = Math.max(margin, window.innerHeight - height - margin);
  const top = above >= margin && above <= bottomLimit ? above : Math.min(Math.max(margin, below), bottomLimit);
  panel.style.left = `${Math.min(Math.max(leftEdge, rect.left), rightEdge - width)}px`;
  panel.style.top = `${top}px`;
  return true;
}

let disposeRenderer;

export function onLoad(pi) {
  const disposeStyle = pi.ui.injectStyle(CSS);
  let closeDetails = null;
  let tooltip = null;
  let tooltipTimer;

  function hideTooltip() {
    clearTimeout(tooltipTimer);
    tooltip?.close();
    tooltip = null;
  }

  function showTooltip(anchor, text) {
    hideTooltip();
    if (!anchor || closeDetails) return;
    tooltipTimer = setTimeout(() => {
      if (!anchor.isConnected) return;
      tooltip = pi.ui.openLayer();
      const tip = document.createElement("span");
      tip.className = "ui-tooltip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = text;
      tooltip.element.append(tip);
      const rect = anchor.getBoundingClientRect();
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.max(half + 8, Math.min(window.innerWidth - half - 8, rect.left + rect.width / 2))}px`;
      tip.style.top = `${rect.top - 6}px`;
    }, 300);
  }

  function closeAll() {
    hideTooltip();
    closeDetails?.();
  }

  function showDetails(data, anchor, onRefresh) {
    closeAll();
    const layer = pi.ui.openLayer();
    const pane = anchor.closest?.(".main-pane");
    let observer;
    closeDetails = () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      observer?.disconnect();
      layer.close();
      closeDetails = null;
    };
    const panel = document.createElement("div");
    panel.className = "quota-ring-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "订阅额度详情");

    const title = document.createElement("h4");
    const label = document.createElement("span");
    label.textContent = "订阅额度详情";
    title.append(label);
    const ring = data?.ring;
    if (ring) {
      const context = document.createElement("span");
      context.className = "qrp-context";
      context.textContent = `${ring.accountLabel || ""} · ${ring.label || ""}`.replace(/^ · | · $/g, "");
      title.append(context);
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "qrp-refresh";
    refresh.textContent = "刷新";
    refresh.setAttribute("aria-label", "刷新订阅额度");
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      try { await onRefresh?.(true); }
      finally {
        if (refresh.isConnected) refresh.disabled = false;
      }
    });
    title.append(refresh);
    panel.append(title);

    // 详情显示全部订阅。
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    if (!accounts.length) {
      const empty = document.createElement("p");
      empty.className = "qrp-empty";
      empty.textContent = "暂无已登录并可读到额度的订阅账号。可在「订阅额度 → 管理账号」中填写 API Key。";
      panel.append(empty);
    } else {
      for (const account of accounts) {
        const section = document.createElement("section");
        section.className = "qrp-account";
        const name = document.createElement("div");
        name.className = "qrp-name";
        name.textContent = typeof account.label === "string" ? account.label : "订阅账号";
        section.append(name);
        const windows = Array.isArray(account.windows) ? account.windows : [];
        for (const window of windows) {
          const row = document.createElement("div");
          row.className = "qrp-row";
          const left = document.createElement("span");
          left.className = "qrp-label";
          left.textContent = typeof window.label === "string" ? window.label : "额度窗口";
          const reset = resetText(window.resetsAt);
          if (reset) {
            const hint = document.createElement("span");
            hint.className = "qrp-reset";
            hint.textContent = reset;
            left.append(hint);
          }
          const value = document.createElement("span");
          value.className = "qrp-val";
          value.textContent = `剩余 ${clamp(window.remaining)}%`;
          row.append(left, value);
          section.append(row);
        }
        panel.append(section);
      }
    }

    const foot = document.createElement("div");
    foot.className = "qrp-foot";
    foot.textContent = "数据每 60 秒更新";
    panel.append(foot);
    layer.element.append(panel);
    const reposition = () => {
      if (anchor.isConnected === false || !placePanel(panel, anchor, pane)) closeDetails?.();
    };
    const onOutside = (event) => { if (!panel.contains(event.target) && !anchor.contains(event.target)) closeDetails?.(); };
    const onKeyDown = (event) => { if (event.key === "Escape") closeDetails?.(); };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    if (pane && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(reposition);
      observer.observe(pane);
    }
    reposition();
  }

  function QuotaRing() {
    const [data, setData] = React.useState(null);
    const controls = React.useRef({ button: null, refresh: null });

    React.useEffect(() => {
      const toolbar = controls.current.button?.closest(".composer-toolbar");
      let active = true;
      let modelLabel;
      let version = 0;
      let delay;
      const refresh = async (force = false) => {
        const selected = toolbar?.querySelector(".composer-model-thinking-model")?.textContent?.trim() || "";
        const request = ++version;
        try {
          const result = await pi.dispatch("plugin.call", { method: "quota.ring", args: { modelLabel: selected, force } });
          if (active && request === version && result?.ok) {
            if (result.enabled === false) closeAll();
            setData(result);
          }
        } catch { /* Keep the composer usable on request failure. */ }
      };
      const sync = (force = false) => {
        const selected = toolbar?.querySelector(".composer-model-thinking-model")?.textContent?.trim() || "";
        if (!force && selected === modelLabel) return;
        clearTimeout(delay);
        const changed = selected !== modelLabel;
        controls.current.refresh = refresh;
        modelLabel = selected;
        if (changed) {
          hideTooltip();
          setData((previous) => previous ? { ...previous, ring: null } : null);
        }
        if (force) void refresh(force);
        else delay = setTimeout(() => void refresh(), 180);
      };
      const observer = toolbar && typeof MutationObserver === "function" ? new MutationObserver(() => sync()) : null;
      observer?.observe(toolbar, { childList: true, characterData: true, subtree: true });
      sync(true);
      const refreshOnFocus = () => sync(true);
      window.addEventListener("focus", refreshOnFocus);
      const timer = setInterval(refreshOnFocus, POLL_MS);
      return () => {
        active = false;
        observer?.disconnect();
        clearTimeout(delay);
        clearInterval(timer);
        window.removeEventListener("focus", refreshOnFocus);
        controls.current.refresh = null;
        closeAll();
      };
    }, []);
    const first = data?.ring;
    const known = Number.isFinite(first?.remaining);
    const remaining = known ? clamp(first.remaining) : 0;
    const percent = known ? `${remaining}%` : "—";
    const offset = CIRCUMFERENCE * (1 - remaining / 100);
    const reset = resetText(first?.resetsAt);
    const hint = known ? `${first.label || "订阅"}剩余${percent}，${!reset ? "重置时间未知" : reset === "即将重置" ? reset : `${reset}重置`}` : "当前模型暂无可用额度";
    return React.createElement(
      "button",
      {
        type: "button",
        className: "quota-ring-btn",
        hidden: data?.enabled === false,
        "data-level": known ? level(remaining) : "unknown",
        "aria-label": `${first?.accountLabel ? `${first.accountLabel}：` : ""}${hint}（点击查看全部订阅）`,
        "aria-haspopup": "dialog",
        ref: (el) => { controls.current.button = el; },
        onPointerEnter: (event) => showTooltip(event.currentTarget, hint),
        onPointerLeave: hideTooltip,
        onFocus: (event) => showTooltip(event.currentTarget, hint),
        onBlur: hideTooltip,
        onClick: (event) => {
          if (closeDetails) closeDetails();
          else showDetails(data, event.currentTarget, (force) => controls.current.refresh?.(force));
        },
      },
      React.createElement(
        "svg",
        { className: "quota-ring-svg", viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("circle", { className: "quota-ring-track", cx: 12, cy: 12, r: RADIUS }),
        React.createElement("circle", {
          className: "quota-ring-progress",
          cx: 12,
          cy: 12,
          r: RADIUS,
          strokeDasharray: CIRCUMFERENCE,
          strokeDashoffset: offset,
        }),
      ),
      React.createElement("span", { className: "quota-ring-value" }, percent),
    );
  }

  const disposeSlot = pi.slots.register({
    slot: "composerControl",
    positions: ["right"],
    component: QuotaRing,
  });

  disposeRenderer = () => {
    closeAll();
    disposeSlot();
    disposeStyle();
  };
  return onUnload;
}

export function onUnload() {
  const dispose = disposeRenderer;
  disposeRenderer = null;
  dispose?.();
}
