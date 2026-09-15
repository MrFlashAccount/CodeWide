function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Captures the already-discovered WebView target through the existing local CDP bridge. */
export function captureBrowserScreenshot(websocketUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    let settled = false;
    const close = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      if (socket.readyState < WebSocket.CLOSING) socket.close();
      return true;
    };
    const fail = (error: Error): void => {
      if (close()) reject(error);
    };
    const succeed = (data: string): void => {
      if (close()) resolve(data);
    };
    const timer = setTimeout(() => fail(new Error("Screenshot capture timed out")), 5000);
    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify({
            id: 1,
            method: "Page.captureScreenshot",
            params: { format: "png", captureBeyondViewport: false, fromSurface: true },
          }),
        );
      } catch {
        fail(new Error("Screenshot request failed"));
      }
    };
    socket.onmessage = (event) => {
      try {
        const response: unknown = JSON.parse(String(event.data));
        if (!isRecord(response) || response.id !== 1) return;
        if (
          !isRecord(response.result) ||
          typeof response.result.data !== "string" ||
          response.result.data.length === 0 ||
          response.result.data.length > 32 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]+={0,2}$/u.test(response.result.data)
        ) {
          fail(new Error("Browser did not return a screenshot"));
          return;
        }
        succeed(response.result.data);
      } catch {
        fail(new Error("Invalid screenshot response"));
      }
    };
    socket.onerror = () => fail(new Error("Screenshot connection failed"));
    socket.onclose = () => fail(new Error("Screenshot connection closed"));
  });
}
