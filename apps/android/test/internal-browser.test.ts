import { readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceObjectDeclaration } from "./source-contract";

const browser = readFileSync(
  new URL("../src/features/ports/browser/InternalBrowser.native.tsx", import.meta.url),
  "utf8",
);
const devToolsBoundary = readFileSync(
  new URL("../src/ui/DevToolsErrorBoundary.tsx", import.meta.url),
  "utf8",
);
const screen = readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8");
const portForwarding = readFileSync(
  new URL("../src/features/ports/PortForwardingManager.tsx", import.meta.url),
  "utf8",
);
const transport = readFileSync(
  new URL("../src/native/native-transport.native.ts", import.meta.url),
  "utf8",
);
const nativeModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const nativeBridge = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/BrowserDevToolsBridge.kt",
    import.meta.url,
  ),
  "utf8",
);

const ownerBrowserDevTools = readFileSync(
  new URL("../src/features/ports/browser/browserDevTools.ts", import.meta.url),
  "utf8",
);
const ownerBrowserBack = readFileSync(
  new URL("../src/features/ports/browser/browserBack.ts", import.meta.url),
  "utf8",
);
const ownerLocalhostPreview = readFileSync(
  new URL("../src/features/ports/LocalhostPreview.tsx", import.meta.url),
  "utf8",
);
const ownerForwardingRow = readFileSync(
  new URL("../src/features/ports/ForwardingRow.tsx", import.meta.url),
  "utf8",
);
const ownerForwardedLoopbackBrowser = readFileSync(
  new URL("../src/features/ports/ForwardedLoopbackBrowser.tsx", import.meta.url),
  "utf8",
);
const ownerBrowserNavigation = readFileSync(
  new URL("../src/features/ports/browserNavigation.ts", import.meta.url),
  "utf8",
);
const ownerDevToolsTarget = readFileSync(
  new URL("../src/features/ports/browser/devToolsTarget.ts", import.meta.url),
  "utf8",
);
const ownerDevToolsBootstrap = readFileSync(
  new URL("../src/features/ports/browser/devToolsBootstrap.ts", import.meta.url),
  "utf8",
);
const ownerInternalBrowserStyles = readFileSync(
  new URL("../src/features/ports/browser/InternalBrowser.styles.ts", import.meta.url),
  "utf8",
);

const ownerBrowserDevToolsPaneNative = readFileSync(
  new URL("../src/features/ports/browser/BrowserDevToolsPane.native.tsx", import.meta.url),
  "utf8",
);

describe("internal browser", () => {
  it("owns navigation and Chromium developer tools independently of localhost tunnels", () => {
    expect(browser).toContain('originWhitelist = ["http://*", "https://*"]');
    expect(browser).toContain(
      'accessibilityLabel={devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools"}',
    );
    expect(ownerBrowserDevTools).toContain("startNativeBrowserDevToolsBridge()");
    expect(ownerBrowserBack).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(ownerBrowserBack).toContain("if (devToolsUrl !== null) closeDevTools()");
    expect(ownerBrowserBack).toContain("else if (canGoBack) webView.current?.goBack()");
    expect(ownerBrowserBack).toContain("else header.onClose()");
    expect(ownerBrowserDevTools).toContain("if (bridgeStarted.current)");
    expect(ownerBrowserDevToolsPaneNative).toContain('testID="chromium-devtools-webview"');
    expect(browser).not.toContain("startNativeBrowserTracing()");
    expect(browser).not.toContain("webviewDebuggingEnabled");
    expect(browser).not.toContain("TunnelPreview");
    expect(browser).not.toContain("localhost");
  });

  it("uses the shared browser surface for the current localhost preview", () => {
    expect(ownerLocalhostPreview).toContain("<InternalBrowser");
    expect(ownerLocalhostPreview).toContain("url={tunnel.url}");
    expect(ownerLocalhostPreview).toContain("headers={{ Authorization: tunnel.authorization }}");
    expect(ownerLocalhostPreview).toContain("!embedded && tunnel === null");
    expect(ownerLocalhostPreview).toContain('title: "Localhost preview"');
  });

  it("opens live phone-local forwards inside the app", () => {
    expect(portForwarding).not.toContain("<InternalBrowser");
    expect(ownerForwardingRow).toContain("onPress={live ? props.onOpen : props.onEdit}");
    expect(portForwarding).toContain("props.onOpen(entry.profile)");
    expect(portForwarding).not.toContain("Linking.openURL");
    expect(ownerForwardedLoopbackBrowser).toContain('testID="forwarded-loopback-browser"');
    expect(ownerBrowserNavigation).toContain("setLoopbackBrowser({");
    expect(ownerForwardedLoopbackBrowser).toContain(
      'header={{ title, closeLabel: "Close browser", onClose }}',
    );
    expect(screen).not.toContain("Linking.openURL(forwardedLoopbackUrl");
  });

  it("merges fullscreen identity and browser navigation into one toolbar", () => {
    expect(browser).toContain("header?: InternalBrowserHeader");
    expect(browser).toContain("accessibilityLabel={header.closeLabel}");
    expect(browser).toContain('<Ionicons name="close"');
    expect(browser).toContain('<BrowserButton\n            label="Back"');
    expect(browser).toContain('<BrowserButton\n              label="Reload"');
    expect(browser).toContain("<BrowserAddressBar");
    expect(browser).toContain("onEditingChange={setAddressEditing}");
    expect(browser).not.toContain("locationTitle");
    expect(ownerForwardedLoopbackBrowser).not.toContain("styles.previewHeader");
  });

  it("bundles Chromium DevTools and connects it to authenticated native CDP", () => {
    const asset = new URL(
      "../android/app/src/main/assets/browser-devtools/front_end/inspector.html",
      import.meta.url,
    );
    expect(statSync(asset).size).toBeGreaterThan(500);
    expect(transport).toContain("startNativeBrowserDevToolsBridge");
    expect(nativeModule).toContain("browserDevTools.start()");
    expect(nativeBridge).toContain("LocalSocketAddress.Namespace.ABSTRACT");
    expect(nativeBridge).toContain('"codewide_token"');
    expect(nativeBridge).toContain("BrowserDevToolsAssetRequest.resolve");
    expect(nativeBridge).toContain("setWebContentsDebuggingEnabledOnUiThread");
    expect(nativeBridge).toContain("context.runOnUiQueueThread");
    expect(ownerDevToolsTarget).toContain(
      "/browser-devtools/${endpoint.token}/front_end/inspector.html",
    );
    expect(ownerBrowserDevToolsPaneNative).toContain("DEVTOOLS_HEALTH_PROBE");
    expect(ownerBrowserDevTools).toContain("markInspectablePage(webView.current)");
    expect(ownerDevToolsTarget).toContain('method: "Runtime.evaluate"');
    expect(ownerDevToolsTarget).toContain(
      'expression: "globalThis.__codewideDevToolsTargetMarker || null"',
    );
    expect(ownerDevToolsTarget).toContain("targetContainsMarker(endpoint, candidate, marker.id)");
    expect(ownerDevToolsTarget).not.toContain("selectVisibleTarget");
    expect(ownerDevToolsTarget).not.toContain("targetVisibilityScore");
    expect(ownerDevToolsTarget).toContain("target.webSocketDebuggerUrl");
    expect(ownerDevToolsTarget).not.toContain("/devtools/page/${encodeURIComponent(targetId)}");
    expect(ownerBrowserDevToolsPaneNative).toContain(
      "injectedJavaScriptBeforeContentLoaded={DEVTOOLS_BOOTSTRAP}",
    );
    expect(ownerDevToolsBootstrap).toContain(
      'window.localStorage.setItem("currentDockState", JSON.stringify("bottom"))',
    );
    expect(ownerDevToolsBootstrap).toContain('source: "codewide-devtools-dock"');
    expect(ownerDevToolsBootstrap).toContain("collapseDuplicateInspectedPage(side)");
    expect(ownerDevToolsBootstrap).toContain("advancedApp?.rootSplitWidget");
    expect(ownerDevToolsBootstrap).toContain("split.hideMain()");
    expect(browser).toContain("styles.contentRowReverse");
    expect(ownerBrowserDevToolsPaneNative).toContain("styles.dividerVertical");
    const undockedTargetPane = sourceObjectDeclaration(
      ownerInternalBrowserStyles,
      "targetPaneUndocked",
    );
    expect(undockedTargetPane).toContain('position: "absolute"');
    expect(undockedTargetPane).toContain("width: 1");
    expect(undockedTargetPane).toContain("height: 1");
    expect(undockedTargetPane).toContain("opacity: 0");
    expect(ownerBrowserDevToolsPaneNative).toContain("<DevToolsErrorBoundary");
    expect(ownerBrowserDevToolsPaneNative).toContain("onRenderProcessGone=");
    expect(ownerBrowserDevToolsPaneNative).toContain("event.nativeEvent.didCrash");
    expect(ownerBrowserDevToolsPaneNative).toContain("<DevToolsFailurePanel");
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
