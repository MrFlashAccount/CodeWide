import type { DevToolsDockSide } from "../../application/ports/browserDevTools";

export type DevToolsDocumentMessage =
  | { side: DevToolsDockSide; source: "dock" }
  | DevToolsTransportMessage
  | { message: string | null; source: "health"; state: "error" | "ready" };

interface DevToolsTransportMessage {
  code: number | null;
  event: "close" | "error" | "open";
  reason: string | null;
  source: "transport";
}

export const DEVTOOLS_BOOTSTRAP = `
(() => {
  const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  try {
    const key = "codewideDockDefaultV2";
    if (window.localStorage.getItem(key) !== "applied") {
      window.localStorage.setItem("currentDockState", JSON.stringify("bottom"));
      window.localStorage.setItem("lastDockState", JSON.stringify("bottom"));
      window.localStorage.setItem(key, "applied");
    }
  } catch (_) {}
  let previous = "";
  let collapsed = "";
  const report = () => {
    let side = "bottom";
    try {
      const stored = JSON.parse(window.localStorage.getItem("currentDockState") || '"bottom"');
      if (["bottom", "left", "right", "undocked"].includes(stored)) side = stored;
    } catch (_) {}
    if (collapsed !== side) {
      try {
        const split = window.Emulation?.AdvancedApp?.instance?.()?.rootSplitWidget;
        if (typeof split?.hideMain === "function") split.hideMain();
      } catch (_) {}
      collapsed = side;
    }
    if (previous !== side) post({ source: "codewide-devtools-dock", side });
    previous = side;
  };
  report();
  window.setInterval(report, 100);
  const NativeWebSocket = window.WebSocket;
  function CodeWideWebSocket(url, protocols) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    socket.addEventListener("open", () => post({ source: "codewide-devtools-transport", event: "open" }));
    socket.addEventListener("error", () => post({ source: "codewide-devtools-transport", event: "error" }));
    socket.addEventListener("close", (event) => post({
      source: "codewide-devtools-transport",
      event: "close",
      code: event.code,
      reason: event.reason,
    }));
    return socket;
  }
  CodeWideWebSocket.prototype = NativeWebSocket.prototype;
  try { Object.setPrototypeOf(CodeWideWebSocket, NativeWebSocket); } catch (_) {}
  window.WebSocket = CodeWideWebSocket;
})();
true;
`;

export const DEVTOOLS_HEALTH_PROBE = `
(() => {
  let attempts = 0;
  let lastError = "";
  const post = (state, message) => window.ReactNativeWebView.postMessage(JSON.stringify({
    source: "codewide-devtools-health",
    state,
    ...(message ? { message } : {}),
  }));
  window.addEventListener("error", (event) => { lastError = event.message || "DevTools script failed"; });
  window.addEventListener("unhandledrejection", (event) => {
    lastError = event.reason instanceof Error ? event.reason.message : String(event.reason || "DevTools promise failed");
  });
  const probe = () => {
    if (document.body && document.body.childElementCount > 0) return post("ready");
    attempts += 1;
    if (attempts >= 40) return post("error", lastError || "DevTools stayed empty for 10 seconds");
    window.setTimeout(probe, 250);
  };
  window.setTimeout(probe, 250);
})();
true;
`;

export function parseDevToolsDocumentMessage(value: string): DevToolsDocumentMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    const source = Reflect.get(parsed, "source");
    if (source === "codewide-devtools-dock") {
      const side = Reflect.get(parsed, "side");
      return isDockSide(side) ? { side, source: "dock" } : null;
    }
    if (source === "codewide-devtools-transport") {
      const event = Reflect.get(parsed, "event");
      const code = Reflect.get(parsed, "code");
      const reason = Reflect.get(parsed, "reason");
      return event === "open" || event === "close" || event === "error"
        ? {
            code: typeof code === "number" && Number.isSafeInteger(code) ? code : null,
            event,
            reason: typeof reason === "string" && reason.length <= 256 ? reason : null,
            source: "transport",
          }
        : null;
    }
    if (source !== "codewide-devtools-health") return null;
    const state = Reflect.get(parsed, "state");
    const message = Reflect.get(parsed, "message");
    return state === "ready" || state === "error"
      ? { message: typeof message === "string" ? message : null, source: "health", state }
      : null;
  } catch {
    return null;
  }
}

function isDockSide(value: unknown): value is DevToolsDockSide {
  return value === "bottom" || value === "left" || value === "right" || value === "undocked";
}
