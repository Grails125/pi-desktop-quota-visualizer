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
.quota-ring-btn:focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px}
.quota-ring-svg{width:17px;height:17px;overflow:visible;transform:rotate(-90deg)}
.quota-ring-track,.quota-ring-progress{fill:none;stroke-width:2.5px}
.quota-ring-track{stroke:var(--ds-text-primary);opacity:.14}
.quota-ring-progress{stroke:currentColor;stroke-linecap:round;transition:stroke-dashoffset var(--motion-duration-normal,200ms) var(--motion-ease-out,ease)}
.quota-ring-value{font-size:var(--text-xs,11px);font-weight:var(--font-weight-semibold,600);line-height:var(--leading-compact,1.2);font-variant-numeric:tabular-nums;white-space:nowrap}
.quota-ring-btn[data-level="ok"]{color:var(--ds-success,#3fb950)}
.quota-ring-btn[data-level="warn"]{color:var(--ds-warning,#d29922)}
.quota-ring-btn[data-level="low"]{color:var(--ds-danger,#f85149)}
.quota-ring-panel{position:fixed;left:0;top:0;width:340px;max-width:calc(100vw - 24px);max-height:min(60vh,520px);
  overflow-y:auto;box-sizing:border-box;padding:16px;border-radius:var(--radius-md-plus,10px);
  border:1px solid var(--ds-border-default);background:var(--ds-bg-elevated-opaque,var(--ds-bg-elevated,#1e1e1e));
  color:var(--ds-text-primary);box-shadow:var(--ds-shadow-dialog,0 8px 28px rgba(0,0,0,.4));
  font-size:var(--text-xs,12px);line-height:var(--leading-body,1.5);z-index:1;text-align:left}
.quota-ring-panel h4{margin:0 0 12px;font-size:var(--text-base,13px);display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.quota-ring-panel .qrp-context{color:var(--ds-text-secondary);font-size:var(--text-xxs,10px);font-weight:var(--font-weight-normal,400)}
.quota-ring-panel button.qrp-close{border:0;background:transparent;color:var(--ds-text-secondary);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;border-radius:6px}
.quota-ring-panel button.qrp-close:hover{background:var(--ds-bg-hover);color:var(--ds-text-primary)}
.qrp-account{margin:0 0 12px;padding-top:10px;border-top:1px solid var(--ds-border-default)}
.qrp-account:first-of-type{border-top:0;padding-top:0}
.qrp-name{font-weight:var(--font-weight-semibold,600);margin-bottom:6px;word-break:break-word}
.qrp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0}
.qrp-row .qrp-label{color:var(--ds-text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qrp-row .qrp-val{font-variant-numeric:tabular-nums;font-weight:var(--font-weight-semibold,600);flex:none}
.qrp-reset{color:var(--ds-text-tertiary,var(--ds-text-secondary));font-size:var(--text-xxs,10px);margin-left:6px}
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

/** 像上下文浮窗一样，把面板锚定在圆环按钮上方（空间不足时改到下方），并限制在视口内。 */
function placePanel(panel, anchorRect) {
  const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
  const width = Math.min(PANEL_WIDTH, Math.max(200, vw - 24));
  panel.style.width = `${width}px`;
  const height = panel.offsetHeight || Math.min(vh * 0.6, 320);
  if (anchorRect) {
    // 右边缘与圆环右边缘对齐，再向左展开，避免遮住右侧的上下文圆环。
    let left = anchorRect.right - width;
    left = Math.max(8, Math.min(left, vw - width - 8));
    let top = anchorRect.top - height - 8; // 默认浮在圆环上方
    if (top < 8) top = Math.min(anchorRect.bottom + 8, Math.max(8, vh - height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  } else {
    panel.style.left = `${Math.max(8, vw - width - 8)}px`;
    panel.style.top = `${Math.max(8, vh - height - 100)}px`;
  }
}

export function onLoad(pi) {
  const disposeStyle = pi.ui.injectStyle(CSS);
  const layers = new Set();
  let buttonEl = null;

  function closeAll() {
    for (const layer of layers) layer.close();
    layers.clear();
  }

  function showDetails(data, anchorRect) {
    closeAll();
    const layer = pi.ui.openLayer();
    layers.add(layer);
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
    const close = document.createElement("button");
    close.type = "button";
    close.className = "qrp-close";
    close.setAttribute("aria-label", "关闭");
    close.textContent = "×";
    close.addEventListener("click", () => {
      layer.close();
      layers.delete(layer);
    });
    title.append(close);
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
    foot.textContent = "圆环显示当前模型订阅的第一档额度 · 数据每 60 秒更新";
    panel.append(foot);

    layer.element.append(panel);
    placePanel(panel, anchorRect || buttonEl?.getBoundingClientRect?.());
    const onOutside = (event) => {
      if (!panel.contains(event.target)) {
        layer.close();
        layers.delete(layer);
        document.removeEventListener("pointerdown", onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  }

  function QuotaRing() {
    const [data, setData] = React.useState(null);

    React.useEffect(() => {
      let active = true;
      const refresh = async () => {
        try {
          const result = await pi.dispatch("plugin.call", { method: "quota.ring", args: {} });
          if (active && result?.ok) setData(result);
        } catch {
          /* 额度读取失败时隐藏圆环，不打扰对话 */
        }
      };
      void refresh();
      const timer = setInterval(() => void refresh(), POLL_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, []);

    // 圆环取第一档（主进程已按当前模型订阅选好），没有可用窗口则隐藏。
    const first = data?.ring ?? null;
    if (!first || typeof first.remaining !== "number") return null;

    const remaining = clamp(first.remaining);
    const percent = Math.round(remaining);
    const offset = CIRCUMFERENCE * (1 - remaining / 100);
    const title = `${first.accountLabel || "订阅"} · ${first.label || "额度"}：剩余 ${percent}%（点击查看全部订阅）`;
    return React.createElement(
      "button",
      {
        type: "button",
        className: "quota-ring-btn",
        "data-level": level(remaining),
        title,
        "aria-label": title,
        ref: (el) => { buttonEl = el; },
        onClick: (event) => showDetails(data, event?.currentTarget?.getBoundingClientRect?.()),
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
      React.createElement("span", { className: "quota-ring-value" }, `${percent}%`),
    );
  }

  const disposeSlot = pi.slots.register({
    slot: "composerControl",
    positions: ["right"],
    component: QuotaRing,
  });

  return () => {
    closeAll();
    disposeSlot();
    disposeStyle();
  };
}

export function onUnload() {
  /* 所有注册与样式已由 onLoad 返回的 disposer 清理 */
}
