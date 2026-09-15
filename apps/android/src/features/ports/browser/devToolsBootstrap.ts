export const DEVTOOLS_BOOTSTRAP = `
  (() => {
    const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    try {
      const defaultAppliedKey = "codewideDockDefaultV1";
      if (window.localStorage.getItem(defaultAppliedKey) !== "applied") {
        window.localStorage.setItem("currentDockState", JSON.stringify("bottom"));
        window.localStorage.setItem("lastDockState", JSON.stringify("bottom"));
        window.localStorage.setItem(defaultAppliedKey, "applied");
      }
    } catch (_) {}

    let lastDockSide = "";
    let collapsedInternalPaneForSide = "";
    const collapseDuplicateInspectedPage = (side) => {
      if (collapsedInternalPaneForSide === side) return;
      try {
        const advancedApp = window.Emulation?.AdvancedApp?.instance?.();
        const split = advancedApp?.rootSplitWidget;
        if (typeof split?.hideMain !== "function") return;
        split.hideMain();
        collapsedInternalPaneForSide = side;
      } catch (_) {}
    };
    const reportDockSide = () => {
      let side = "bottom";
      try {
        const stored = JSON.parse(window.localStorage.getItem("currentDockState") || '"bottom"');
        if (["bottom", "left", "right", "undocked"].includes(stored)) side = stored;
      } catch (_) {}
      collapseDuplicateInspectedPage(side);
      if (side !== lastDockSide) {
        lastDockSide = side;
        post({ source: "codewide-devtools-dock", side });
      }
    };
    reportDockSide();
    window.setInterval(reportDockSide, 100);

    const NativeWebSocket = window.WebSocket;
    function CodeWideWebSocket(url, protocols) {
      const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      socket.addEventListener("open", () => post({ source: "codewide-devtools-transport", event: "open", code: 0, reason: "" }));
      socket.addEventListener("error", () => post({ source: "codewide-devtools-transport", event: "error", code: 0, reason: "" }));
      socket.addEventListener("close", (event) => post({
        source: "codewide-devtools-transport",
        event: "close",
        code: event.code,
        reason: event.reason || "",
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
    window.addEventListener("error", (event) => { lastError = event.message || "DevTools frontend script failed"; });
    window.addEventListener("unhandledrejection", (event) => {
      lastError = event.reason instanceof Error ? event.reason.message : String(event.reason || "DevTools frontend promise failed");
    });
    const probe = () => {
      if (document.body && document.body.childElementCount > 0) {
        post("ready");
        return;
      }
      attempts += 1;
      if (attempts >= 40) {
        post("error", lastError || "DevTools frontend stayed empty for 10 seconds");
        return;
      }
      window.setTimeout(probe, 250);
    };
    window.setTimeout(probe, 250);
  })();
  true;
`;
