import { readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

const browser = readFileSync(new URL("../src/ui/InternalBrowser.native.tsx", import.meta.url), "utf8");
const devToolsBoundary = readFileSync(new URL("../src/ui/DevToolsErrorBoundary.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const portForwarding = readFileSync(new URL("../src/ui/PortForwardingManager.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../src/native/native-transport.native.ts", import.meta.url), "utf8");
const nativeModule = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt", import.meta.url),
  "utf8",
);
const nativeBridge = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/BrowserDevToolsBridge.kt", import.meta.url),
  "utf8",
);

describe("internal browser", () => {
  it("owns navigation and Chromium developer tools independently of localhost tunnels", () => {
    expect(browser).toContain('originWhitelist = ["http://*", "https://*"]');
    expect(browser).toContain('accessibilityLabel={devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools"}');
    expect(browser).toContain("startNativeBrowserDevToolsBridge()");
    expect(browser).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(browser).toContain("if (devToolsUrl !== null) closeDevTools()");
    expect(browser).toContain("else if (navigation.canGoBack) webView.current?.goBack()");
    expect(browser).toContain("else header.onClose()");
    expect(browser).toContain("if (bridgeStarted.current)");
    expect(browser).toContain('testID="chromium-devtools-webview"');
    expect(browser).toContain("startNativeBrowserTracing()");
    expect(browser).not.toContain("webviewDebuggingEnabled");
    expect(browser).not.toContain("TunnelPreview");
    expect(browser).not.toContain("localhost");
  });

  it("uses the shared browser surface for the current localhost preview", () => {
    expect(screen).toContain("<InternalBrowser");
    expect(screen).toContain("url={tunnel.url}");
    expect(screen).toContain("headers={{ Authorization: tunnel.authorization }}");
    expect(screen).toContain("!embedded && tunnel === null");
    expect(screen).toContain('title: "Localhost preview"');
  });

  it("opens live phone-local forwards inside the app", () => {
    expect(portForwarding).not.toContain('<InternalBrowser');
    expect(portForwarding).toContain("onPress={live ? props.onOpen : props.onEdit}");
    expect(portForwarding).toContain("props.onOpen(entry.profile)");
    expect(portForwarding).not.toContain("Linking.openURL");
    expect(screen).toContain('testID="forwarded-loopback-browser"');
    expect(screen).toContain("setLoopbackBrowser({");
    expect(screen).toContain('header={{ title, closeLabel: "Back to conversation", closeIcon: "arrow-back", onClose }}');
    expect(screen).not.toContain("Linking.openURL(forwardedLoopbackUrl");
  });

  it("merges fullscreen identity and browser navigation into one toolbar", () => {
    expect(browser).toContain("header?: InternalBrowserHeader");
    expect(browser).toContain("accessibilityLabel={header.closeLabel}");
    expect(browser).toContain("<BrowserButton label=\"Back\"");
    expect(browser).toContain("<BrowserButton label=\"Reload\"");
    const forwardedBrowser = screen.slice(screen.indexOf("function ForwardedLoopbackBrowser"), screen.indexOf("function ServerRail"));
    expect(forwardedBrowser).not.toContain("styles.previewHeader");
  });

  it("bundles Chromium DevTools and connects it to authenticated native CDP", () => {
    const asset = new URL("../android/app/src/main/assets/browser-devtools/front_end/inspector.html", import.meta.url);
    expect(statSync(asset).size).toBeGreaterThan(500);
    expect(transport).toContain("startNativeBrowserDevToolsBridge");
    expect(nativeModule).toContain("browserDevTools.start()");
    expect(nativeBridge).toContain("LocalSocketAddress.Namespace.ABSTRACT");
    expect(nativeBridge).toContain('"codewide_token"');
    expect(nativeBridge).toContain("BrowserDevToolsAssetRequest.resolve");
    expect(nativeBridge).toContain("setWebContentsDebuggingEnabledOnUiThread");
    expect(nativeBridge).toContain("context.runOnUiQueueThread");
    expect(browser).toContain("/browser-devtools/${endpoint.token}/front_end/inspector.html");
    expect(browser).toContain("DEVTOOLS_HEALTH_PROBE");
    expect(browser).toContain("markInspectablePage(webView.current)");
    expect(browser).toContain("candidate.title === marker");
    expect(browser).toContain("target.webSocketDebuggerUrl");
    expect(browser).not.toContain("/devtools/page/${encodeURIComponent(targetId)}");
    expect(browser).toContain('injectedJavaScriptBeforeContentLoaded={DEVTOOLS_BOOTSTRAP}');
    expect(browser).toContain('window.localStorage.setItem("currentDockState", JSON.stringify("bottom"))');
    expect(browser).toContain('source: "codewide-devtools-dock"');
    expect(browser).toContain("styles.contentRowReverse");
    expect(browser).toContain("styles.dividerVertical");
    expect(browser).toContain('targetPaneUndocked: { position: "absolute", width: 1, height: 1, opacity: 0 }');
    expect(browser).toContain("<DevToolsErrorBoundary");
    expect(browser).toContain("onRenderProcessGone=");
    expect(browser).toContain("event.nativeEvent.didCrash");
    expect(browser).toContain("<DevToolsFailurePanel");
    expect(devToolsBoundary).toContain("componentDidCatch(error: Error, info: ErrorInfo)");
    expect(devToolsBoundary).toContain('testID="chromium-devtools-error-boundary"');
    expect(devToolsBoundary).toContain("Copy error");
    expect(devToolsBoundary).toContain("React component stack:");
    expect(browser).not.toContain("file:///android_asset/browser-devtools/");
    expect(browser).not.toContain("allowUniversalAccessFromFileURLs");
    expect(nativeBridge).toContain("TracingController.getInstance()");
    expect(browser).not.toContain("eruda");
  });
});
