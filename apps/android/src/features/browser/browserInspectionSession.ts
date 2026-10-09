import type { WebView } from "react-native-webview";
import type { NativeBrowserDevToolsBridge } from "../../native/native-transport";
import { captureBrowserScreenshot } from "./capture-screenshot";
import {
  findInspectablePage,
  markInspectablePage,
  proxiedWebSocketUrl,
  type DevToolsTarget,
} from "./devToolsTarget";
import { retainBrowserDevToolsBridge } from "./devToolsLease";

type InspectionResult =
  | { readonly status: "cancelled" }
  | { readonly cause: unknown; readonly status: "failed" }
  | {
      readonly endpoint: NativeBrowserDevToolsBridge;
      readonly status: "ready";
      readonly target: DevToolsTarget;
    };

/** Owns inspection leases and fences delayed native work to the active page lifetime. */
export class BrowserInspectionSession {
  #active = true;
  #generation = 0;
  #lease: ReturnType<typeof retainBrowserDevToolsBridge> | null = null;

  /** Invalidates every pending inspection when this page leaves the foreground. */
  setActive(active: boolean): void {
    this.#active = active;
    if (!active) {
      this.close();
    }
  }

  /** Reports whether this retained page may present inspection or feedback results. */
  isActive(): boolean {
    return this.#active;
  }

  /** Releases this inspector without stopping another tab's shared bridge. */
  close(): void {
    this.#generation += 1;
    this.#lease?.release();
    this.#lease = null;
  }

  /** Resolves the actual marked target, discarding results after close or selection change. */
  async open(webView: WebView | null, url: string): Promise<InspectionResult> {
    if (!this.#active) {
      return { status: "cancelled" };
    }
    const revision = ++this.#generation;
    const lease = retainBrowserDevToolsBridge();
    this.#lease?.release();
    this.#lease = lease;
    try {
      const endpoint = await lease.endpoint;
      if (!this.#current(revision)) {
        lease.release();
        return { status: "cancelled" };
      }
      const target = await this.#target(endpoint, webView, url);
      if (!this.#current(revision)) {
        lease.release();
        return { status: "cancelled" };
      }
      return { endpoint, status: "ready", target };
    } catch (error) {
      lease.release();
      return this.#current(revision) ? { cause: error, status: "failed" } : { status: "cancelled" };
    }
  }

  /** Captures only this page and releases transient bridge retention on every outcome. */
  async capture(webView: WebView | null, url: string): Promise<string | null> {
    if (!this.#active) {
      return null;
    }
    const revision = this.#generation;
    const lease = retainBrowserDevToolsBridge();
    try {
      const endpoint = await lease.endpoint;
      if (!this.#current(revision)) {
        return null;
      }
      const target = await this.#target(endpoint, webView, url);
      if (!this.#current(revision)) {
        return null;
      }
      const screenshot = await captureBrowserScreenshot(proxiedWebSocketUrl(endpoint, target));
      return this.#current(revision) ? screenshot : null;
    } finally {
      lease.release();
    }
  }

  #current(revision: number): boolean {
    return this.#active && revision === this.#generation;
  }

  async #target(
    endpoint: NativeBrowserDevToolsBridge,
    webView: WebView | null,
    url: string,
  ): Promise<DevToolsTarget> {
    const marker = markInspectablePage(webView);
    marker.apply();
    return findInspectablePage(endpoint, url, marker).finally(marker.restore);
  }
}
