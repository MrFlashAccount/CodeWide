import type { WebView } from "react-native-webview";

import type { BrowserDevToolsEndpoint } from "../../application/ports/browserDevTools";

export interface DevToolsTarget {
  description?: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface InspectablePageMarker {
  apply(): void;
  id: string;
  restore(): void;
}

let nextMarker = 0;

export async function findInspectablePage(
  endpoint: BrowserDevToolsEndpoint,
  pageUrl: string,
  marker: InspectablePageMarker,
): Promise<DevToolsTarget> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      marker.apply();
      await delay(50);
      const response = await fetch(discoveryUrl(endpoint));
      if (!response.ok) throw new Error(`DevTools discovery returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error("DevTools discovery returned invalid targets");
      const targets = payload.flatMap((value) => {
        const target = parseDevToolsTarget(value);
        return target === null || target.type !== "page" || isBundledDevToolsUrl(target.url)
          ? []
          : [target];
      });
      const exact = await findBestTarget(endpoint, targets, pageUrl, marker.id);
      if (exact !== null) return exact;
      lastError = new Error(`No inspectable WebView owns ${browserLocation(pageUrl)}`);
    } catch (cause) {
      lastError = cause;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error("No inspectable WebView is available");
}

async function findBestTarget(
  endpoint: BrowserDevToolsEndpoint,
  targets: DevToolsTarget[],
  pageUrl: string,
  marker: string,
): Promise<DevToolsTarget | null> {
  const matching = targets.filter((target) => samePageUrl(target.url, pageUrl));
  const matchingIds = new Set(matching.map((target) => target.id));
  const remaining = targets.filter((target) => !matchingIds.has(target.id));
  for (const candidates of [matching, remaining]) {
    const exact = await findMarkedTarget(endpoint, candidates, marker);
    if (exact !== null) return exact;
  }
  return null;
}

async function findMarkedTarget(
  endpoint: BrowserDevToolsEndpoint,
  candidates: DevToolsTarget[],
  marker: string,
): Promise<DevToolsTarget | null> {
  const probes = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      matched: await targetContainsMarker(endpoint, candidate, marker),
    })),
  );
  return probes.find((probe) => probe.matched)?.candidate ?? null;
}

export function chromiumDevToolsUrl(
  endpoint: BrowserDevToolsEndpoint,
  target: DevToolsTarget,
): string {
  const websocket = proxiedWebSocketUrl(endpoint, target).replace(/^ws:\/\//u, "");
  const query = new URLSearchParams({ can_dock: "true", ws: websocket });
  return `http://${endpoint.host}:${endpoint.port}/browser-devtools/${endpoint.token}/front_end/inspector.html?${query.toString()}`;
}

export function markInspectablePage(target: WebView | null): InspectablePageMarker {
  nextMarker += 1;
  const id = `__codewide_devtools_target_${Date.now().toString(36)}_${nextMarker.toString(36)}`;
  if (target === null) return { apply: () => undefined, id, restore: () => undefined };
  return {
    apply() {
      try {
        target.injectJavaScript(
          `globalThis.__codewideDevToolsTargetMarker = ${JSON.stringify(id)}; true;`,
        );
      } catch {
        // Discovery retries and reports the missing exact target.
      }
    },
    id,
    restore() {
      try {
        target.injectJavaScript(
          `if (globalThis.__codewideDevToolsTargetMarker === ${JSON.stringify(id)}) delete globalThis.__codewideDevToolsTargetMarker; true;`,
        );
      } catch {
        // The inspected WebView can disappear while discovery is in flight.
      }
    },
  };
}

function browserLocation(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function discoveryUrl(endpoint: BrowserDevToolsEndpoint): string {
  return `http://${endpoint.host}:${endpoint.port}/json/list?codewide_token=${endpoint.token}`;
}

function proxiedWebSocketUrl(endpoint: BrowserDevToolsEndpoint, target: DevToolsTarget): string {
  const discovered = new URL(target.webSocketDebuggerUrl);
  if (discovered.protocol !== "ws:" && discovered.protocol !== "wss:") {
    throw new Error("DevTools target returned an invalid WebSocket URL");
  }
  const separator = discovered.search === "" ? "?" : "&";
  return `ws://${endpoint.host}:${endpoint.port}${discovered.pathname}${discovered.search}${separator}codewide_token=${encodeURIComponent(endpoint.token)}`;
}

function parseDevToolsTarget(value: unknown): DevToolsTarget | null {
  if (value === null || typeof value !== "object") return null;
  const id = Reflect.get(value, "id");
  const type = Reflect.get(value, "type");
  const title = Reflect.get(value, "title");
  const url = Reflect.get(value, "url");
  const webSocketDebuggerUrl = Reflect.get(value, "webSocketDebuggerUrl");
  const description = Reflect.get(value, "description");
  if (
    typeof id !== "string" ||
    typeof type !== "string" ||
    typeof title !== "string" ||
    typeof url !== "string" ||
    typeof webSocketDebuggerUrl !== "string" ||
    !(description === undefined || typeof description === "string")
  ) {
    return null;
  }
  return description === undefined
    ? { id, title, type, url, webSocketDebuggerUrl }
    : { description, id, title, type, url, webSocketDebuggerUrl };
}

function targetContainsMarker(
  endpoint: BrowserDevToolsEndpoint,
  target: DevToolsTarget,
  marker: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (matched: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket !== null && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, "probe_complete");
      }
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
      socket.onmessage = (event) => finish(markerResponse(event.data) === marker);
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

function markerResponse(raw: unknown): unknown {
  try {
    const value: unknown = JSON.parse(String(raw));
    if (value === null || typeof value !== "object" || Reflect.get(value, "id") !== 1) return null;
    const result = Reflect.get(value, "result");
    if (result === null || typeof result !== "object") return null;
    const inner = Reflect.get(result, "result");
    return inner === null || typeof inner !== "object" ? null : Reflect.get(inner, "value");
  } catch {
    return null;
  }
}

function isBundledDevToolsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "127.0.0.1" && url.pathname.startsWith("/browser-devtools/");
  } catch {
    return false;
  }
}

function samePageUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.origin === rightUrl.origin &&
      trimTrailingSlash(leftUrl.pathname) === trimTrailingSlash(rightUrl.pathname)
    );
  } catch {
    return left === right;
  }
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/$/u, "") : value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
