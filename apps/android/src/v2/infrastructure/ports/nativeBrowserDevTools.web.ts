import type { BrowserDevToolsCapability } from "../../application/ports/browserDevTools";

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("Chromium DevTools are available on Android only"));

export function createNativeBrowserDevTools(): BrowserDevToolsCapability {
  return {
    start: unavailable,
    startTracing: unavailable,
    stop: () => undefined,
    stopTracing: unavailable,
  };
}
