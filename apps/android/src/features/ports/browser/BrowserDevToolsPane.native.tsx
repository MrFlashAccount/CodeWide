import { ActivityIndicator, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "../../../theme";
import { DevToolsErrorBoundary, DevToolsFailurePanel } from "../../../ui/DevToolsErrorBoundary";
import { AppText as Text } from "../../../ui/Typography";
import { useBrowserDevTools } from "./browserDevTools";
import { useBrowserPaneLayout } from "./browserPaneLayout";
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
  if (devToolsUrl === null) return null;
  return (
    <>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Resize browser and DevTools panes"
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
        resetKey={`${devToolsUrl}:${devTools.devToolsRevision}`}
        context={`Target: ${browserLocation(navigationUrl)}\nFrontend: ${redactDevToolsUrl(devToolsUrl)}`}
        onFailure={(failure) => onError?.(`Chromium DevTools: ${failure.message}`)}
        onRetry={devTools.retryDevTools}
        onClose={devTools.closeDevTools}
      >
        <View style={styles.devToolsPane}>
          <WebView
            key={`${devToolsUrl}:${devTools.devToolsRevision}`}
            ref={devTools.devToolsWebView}
            testID="chromium-devtools-webview"
            style={styles.devTools}
            source={{ uri: devToolsUrl }}
            originWhitelist={["http://127.0.0.1:*"]}
            javaScriptEnabled
            domStorageEnabled
            injectedJavaScriptBeforeContentLoaded={DEVTOOLS_BOOTSTRAP}
            injectedJavaScript={DEVTOOLS_HEALTH_PROBE}
            setSupportMultipleWindows={false}
            onLoadStart={() => {
              devTools.setDevToolsDocumentLoading(true);
              devTools.setDevToolsFailure(null);
            }}
            onMessage={devTools.handleDevToolsMessage}
            onHttpError={(event) => {
              const description = `frontend returned HTTP ${event.nativeEvent.statusCode}`;
              devTools.setDevToolsDocumentLoading(false);
              devTools.captureDevToolsFailure("load", description);
              onError?.(`Chromium DevTools: ${description}`);
            }}
            onError={(event) => {
              devTools.setDevToolsDocumentLoading(false);
              devTools.captureDevToolsFailure(
                "load",
                event.nativeEvent.description,
                `Code: ${event.nativeEvent.code}`,
              );
              onError?.(`Chromium DevTools: ${event.nativeEvent.description}`);
            }}
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
                onRetry={devTools.retryDevTools}
                onClose={devTools.closeDevTools}
              />
            </View>
          )}
        </View>
      </DevToolsErrorBoundary>
    </>
  );
}
