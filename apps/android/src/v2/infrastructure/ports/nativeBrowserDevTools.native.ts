import { NativeModules, Platform } from "react-native";

import type {
  BrowserDevToolsCapability,
  BrowserDevToolsEndpoint,
  BrowserTrace,
} from "../../application/ports/browserDevTools";

interface NativeBrowserBridge {
  startBrowserDevToolsBridge?(): Promise<BrowserDevToolsEndpoint>;
  startBrowserTracing?(): Promise<void>;
  stopBrowserDevToolsBridge?(): void;
  stopBrowserTracing?(): Promise<BrowserTrace>;
}

const TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

export function createNativeBrowserDevTools(): BrowserDevToolsCapability {
  // WHY: React Native exposes native modules through an untyped runtime registry.
  const bridge = NativeModules["CodeWideNative"] as NativeBrowserBridge | undefined;
  const requireBridge = (): NativeBrowserBridge => {
    if (bridge === undefined || Platform.OS !== "android") {
      throw new Error("Chromium DevTools are available on Android only");
    }
    return bridge;
  };
  return {
    async start() {
      const method = requireBridge().startBrowserDevToolsBridge;
      if (method === undefined)
        throw new Error("This app build does not include Chromium DevTools");
      return parseEndpoint(await method.call(bridge));
    },
    async startTracing() {
      const method = requireBridge().startBrowserTracing;
      if (method === undefined) throw new Error("Native browser tracing is unavailable");
      await method.call(bridge);
    },
    stop() {
      requireBridge().stopBrowserDevToolsBridge?.call(bridge);
    },
    async stopTracing() {
      const method = requireBridge().stopBrowserTracing;
      if (method === undefined) throw new Error("Native browser tracing is unavailable");
      return parseTrace(await method.call(bridge));
    },
  };
}

function parseEndpoint(value: unknown): BrowserDevToolsEndpoint {
  if (value === null || typeof value !== "object") {
    throw new Error("Native Chromium DevTools bridge returned an invalid endpoint");
  }
  const host = Reflect.get(value, "host");
  const port = Reflect.get(value, "port");
  const token = Reflect.get(value, "token");
  const tracingSupported = Reflect.get(value, "tracingSupported");
  if (
    host !== "127.0.0.1" ||
    !Number.isSafeInteger(port) ||
    typeof port !== "number" ||
    port < 1 ||
    port > 65_535 ||
    typeof token !== "string" ||
    !TOKEN_PATTERN.test(token) ||
    typeof tracingSupported !== "boolean"
  ) {
    throw new Error("Native Chromium DevTools bridge returned an invalid endpoint");
  }
  return { host, port, token, tracingSupported };
}

function parseTrace(value: unknown): BrowserTrace {
  if (value === null || typeof value !== "object") {
    throw new Error("Native browser trace result is invalid");
  }
  const path = Reflect.get(value, "path");
  const size = Reflect.get(value, "size");
  if (typeof path !== "string" || path === "" || typeof size !== "number" || size < 0) {
    throw new Error("Native browser trace result is invalid");
  }
  return { path, size };
}
