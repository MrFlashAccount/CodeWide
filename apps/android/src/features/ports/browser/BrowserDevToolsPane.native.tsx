import { ActivityIndicator, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "../../../theme";
import { DevToolsErrorBoundary, DevToolsFailurePanel } from "../../../ui/DevToolsErrorBoundary";
import { AppText as Text } from "../../../ui/Typography";
import type { useBrowserDevTools } from "./browserDevTools";
import type { useBrowserPaneLayout } from "./browserPaneLayout";
import { DEVTOOLS_BOOTSTRAP, DEVTOOLS_HEALTH_PROBE } from "./devToolsBootstrap";
import { redactDevToolsUrl } from "./devToolsMessage";
import { browserLocation } from "./devToolsTarget";
import { styles } from "./InternalBrowser.styles";

/** Renders the retained native DevTools pane; the browser hooks own its session and lifecycle. */
export function renderBrowserDevToolsPane(
  devTools: ReturnType<typeof useBrowserDevTools>,
  navigationUrl: string,
  onError: ((description: string) => void) | undefined,
  verticalDock: boolean,
  dividerPanResponder: ReturnType<typeof useBrowserPaneLayout>["dividerPanResponder"],
) {
  const devToolsUrl = devTools.devToolsUrl;
  if (devToolsUrl === null) {
    return null;
  }
  return (
    <>
      <View
        accessibilityLabel="Resize browser and DevTools panes"
        accessibilityRole="adjustable"
        style={[
          styles.divider,
          verticalDock ? styles.dividerVertical : styles.dividerHorizontal,
          devTools.devToolsDockSide === "undocked" && styles.dividerHidden,
        ]}
        {...dividerPanResponder.panHandlers}
      >
        <View
          style={[
            styles.dividerHandle,
            verticalDock ? styles.dividerHandleVertical : styles.dividerHandleHorizontal,
          ]}
        />
      </View>
      <DevToolsErrorBoundary
        context={`Target: ${browserLocation(navigationUrl)}\nFrontend: ${redactDevToolsUrl(devToolsUrl)}`}
        onClose={devTools.closeDevTools}
        onFailure={(failure) => onError?.(`Chromium DevTools: ${failure.message}`)}
        onRetry={devTools.retryDevTools}
        resetKey={`${devToolsUrl}:${String(devTools.devToolsRevision)}`}
      >
        <View style={styles.devToolsPane}>
          <WebView
            domStorageEnabled
            injectedJavaScript={DEVTOOLS_HEALTH_PROBE}
            injectedJavaScriptBeforeContentLoaded={DEVTOOLS_BOOTSTRAP}
            javaScriptEnabled
            key={`${devToolsUrl}:${String(devTools.devToolsRevision)}`}
            onError={(event) => {
              devTools.setDevToolsDocumentLoading(false);
              devTools.captureDevToolsFailure(
                "load",
                event.nativeEvent.description,
                `Code: ${String(event.nativeEvent.code)}`,
              );
              onError?.(`Chromium DevTools: ${event.nativeEvent.description}`);
            }}
            onHttpError={(event) => {
              const description = `frontend returned HTTP ${String(event.nativeEvent.statusCode)}`;
              devTools.setDevToolsDocumentLoading(false);
              devTools.captureDevToolsFailure("load", description);
              onError?.(`Chromium DevTools: ${description}`);
            }}
            onLoadStart={() => {
              devTools.setDevToolsDocumentLoading(true);
              devTools.setDevToolsFailure(null);
            }}
            onMessage={devTools.handleDevToolsMessage}
            onRenderProcessGone={(event) => {
              const description = event.nativeEvent.didCrash
                ? "Android WebView renderer crashed"
                : "Android stopped the WebView renderer";
              devTools.setDevToolsDocumentLoading(false);
              devTools.captureDevToolsFailure(
                "renderer",
                description,
                `didCrash: ${String(event.nativeEvent.didCrash)}`,
              );
              onError?.(`Chromium DevTools: ${description}`);
            }}
            originWhitelist={["http://127.0.0.1:*"]}
            ref={devTools.devToolsWebView}
            setSupportMultipleWindows={false}
            source={{ uri: devToolsUrl }}
            style={styles.devTools}
            testID="chromium-devtools-webview"
          />
          {devTools.devToolsDocumentLoading && (
            <View pointerEvents="none" style={styles.devToolsLoading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.devToolsStatus}>Loading Chromium DevTools…</Text>
            </View>
          )}
          {devTools.devToolsFailure !== null && (
            <View style={styles.devToolsError}>
              <DevToolsFailurePanel
                failure={devTools.devToolsFailure}
                onClose={devTools.closeDevTools}
                onRetry={devTools.retryDevTools}
              />
            </View>
          )}
        </View>
      </DevToolsErrorBoundary>
    </>
  );
}
