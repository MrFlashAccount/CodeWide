import { WebView } from "react-native-webview";
import type { NativeBrowserDevToolsBridge } from "../../../native/native-transport";

export type DevToolsTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  description?: string;
};

export type InspectablePageMarker = { id: string; apply(): void; restore(): void };

export async function findInspectablePage(
  endpoint: NativeBrowserDevToolsBridge,
  pageUrl: string,
  marker: InspectablePageMarker,
): Promise<DevToolsTarget> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      marker.apply();
      await delay(50);
      const response = await fetch(
        `http://${endpoint.host}:${endpoint.port}/json/list?codewide_token=${endpoint.token}`,
      );
      if (!response.ok) throw new Error(`DevTools discovery returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload))
        throw new Error("DevTools discovery returned an invalid target list");
      const targets = payload
        .filter(isDevToolsTarget)
        .filter((target) => target.type === "page" && !isBundledDevToolsUrl(target.url));
      const urlMatches = targets.filter((candidate) => samePageUrl(candidate.url, pageUrl));
      const otherTargets = targets.filter((candidate) => !urlMatches.includes(candidate));
      for (const candidates of [urlMatches, otherTargets]) {
        const probes = await Promise.all(
          candidates.map(async (candidate) => ({
            candidate,
            matched: await targetContainsMarker(endpoint, candidate, marker.id),
          })),
        );
        const exact = probes.find((probe) => probe.matched);
        if (exact !== undefined) return exact.candidate;
      }
      lastError = new Error(
        `No CDP target owns the browser WebView at ${browserLocation(pageUrl)} (${targets.length} targets probed)`,
      );
    } catch (cause) {
      lastError = cause;
    }
    await delay(100);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No inspectable WebView target is available");
}

export function chromiumDevToolsUrl(
  endpoint: NativeBrowserDevToolsBridge,
  target: DevToolsTarget,
): string {
  const websocket = proxiedWebSocketUrl(endpoint, target).replace(/^ws:\/\//u, "");
  const query = new URLSearchParams({ ws: websocket, can_dock: "true" });
  return `http://${endpoint.host}:${endpoint.port}/browser-devtools/${endpoint.token}/front_end/inspector.html?${query.toString()}`;
}

export function proxiedWebSocketUrl(
  endpoint: NativeBrowserDevToolsBridge,
  target: DevToolsTarget,
): string {
  const discoveredSocket = new URL(target.webSocketDebuggerUrl);
  if (discoveredSocket.protocol !== "ws:" && discoveredSocket.protocol !== "wss:") {
    throw new Error("DevTools target returned an invalid WebSocket URL");
  }
  const path = `${discoveredSocket.pathname}${discoveredSocket.search}`;
  const separator = discoveredSocket.search.length > 0 ? "&" : "?";
  return `ws://${endpoint.host}:${endpoint.port}${path}${separator}codewide_token=${encodeURIComponent(endpoint.token)}`;
}

export function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "type" in value &&
    typeof value.type === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "webSocketDebuggerUrl" in value &&
    typeof value.webSocketDebuggerUrl === "string" &&
    (!("description" in value) ||
      value.description === undefined ||
      typeof value.description === "string")
  );
}

export function targetContainsMarker(
  endpoint: NativeBrowserDevToolsBridge,
  target: DevToolsTarget,
  marker: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (matched: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket !== null && socket.readyState < WebSocket.CLOSING)
        socket.close(1000, "probe complete");
      resolve(matched);
    };
    const timeout = setTimeout(() => finish(false), 750);
    try {
      socket = new WebSocket(proxiedWebSocketUrl(endpoint, target));
      socket.onopen = () => {
        socket?.send(
          JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: {
              expression: "globalThis.__codewideDevToolsTargetMarker || null",
              returnByValue: true,
            },
          }),
        );
      };
      socket.onmessage = (event) => {
        try {
          const response: unknown = JSON.parse(String(event.data));
          if (
            response === null ||
            typeof response !== "object" ||
            !("id" in response) ||
            response.id !== 1
          )
            return;
          const result = "result" in response ? response.result : null;
          const nested =
            result !== null && typeof result === "object" && "result" in result
              ? result.result
              : null;
          const value =
            nested !== null && typeof nested === "object" && "value" in nested
              ? nested.value
              : undefined;
          finish(value === marker);
        } catch {
          finish(false);
        }
      };
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

export function markInspectablePage(target: WebView | null): InspectablePageMarker {
  const id = `__codewide_devtools_target_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  if (target === null) return { id, apply() {}, restore() {} };
  return {
    id,
    apply() {
      try {
        target.injectJavaScript(`
          globalThis.__codewideDevToolsTargetMarker = ${JSON.stringify(id)};
          true;
        `);
      } catch {
        // Discovery retries before reporting that no exact target was found.
      }
    },
    restore() {
      try {
        target.injectJavaScript(`
          if (globalThis.__codewideDevToolsTargetMarker === ${JSON.stringify(id)}) {
            delete globalThis.__codewideDevToolsTargetMarker;
          }
          true;
        `);
      } catch {
        // The inspected WebView may have been closed while discovery was in flight.
      }
    },
  };
}

export function isBundledDevToolsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" && parsed.pathname.startsWith("/browser-devtools/");
  } catch {
    return false;
  }
}

export function samePageUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.origin === rightUrl.origin &&
      normalizePath(leftUrl.pathname) === normalizePath(rightUrl.pathname)
    );
  } catch {
    return left === right;
  }
}

export function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/$/u, "") : path;
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function browserLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}
