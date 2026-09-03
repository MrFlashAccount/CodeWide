import { Pressable, StyleSheet, View, type GestureResponderHandlers } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import { ProductText as Text } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
interface BrowserDevToolsPaneProps {
  closeDevTools(): void;
  devToolsBootstrap: string;
  devToolsDocumentLoading: boolean;
  devToolsError: string | null;
  devToolsUrl: string;
  dividerHandlers: GestureResponderHandlers;
  healthProbe: string;
  onDevToolsError(message: string): void;
  onDevToolsLoadStart(): void;
  onDevToolsMessage(event: WebViewMessageEvent): void;
  onRendererGone(didCrash: boolean): void;
  retryDevTools(): void;
  setDevToolsRef(value: WebView | null): void;
  vertical: boolean;
}

export function BrowserDevToolsPane(props: BrowserDevToolsPaneProps): React.JSX.Element {
  const {
    closeDevTools,
    devToolsBootstrap,
    devToolsDocumentLoading,
    devToolsError,
    devToolsUrl,
    dividerHandlers,
    healthProbe,
    onDevToolsError,
    onDevToolsLoadStart,
    onDevToolsMessage,
    onRendererGone,
    retryDevTools,
    setDevToolsRef,
    vertical,
  } = props;
  const webViewError = useEvent((event: BrowserErrorEvent) => {
    onDevToolsError(event.nativeEvent.description);
  });
  const webViewHttpError = useEvent((event: BrowserHttpErrorEvent) => {
    onDevToolsError(`DevTools returned HTTP ${event.nativeEvent.statusCode}`);
  });
  const rendererGone = useEvent((event: BrowserRendererGoneEvent) => {
    onRendererGone(event.nativeEvent.didCrash);
  });
  return (
    <>
      <View
        accessibilityLabel="Resize browser and DevTools panes"
        accessibilityRole="adjustable"
        style={[styles.divider, vertical ? styles.dividerVertical : styles.dividerHorizontal]}
        {...dividerHandlers}
      >
        <View style={[styles.handle, vertical ? styles.handleVertical : styles.handleHorizontal]} />
      </View>
      <View style={styles.pane}>
        <WebView
          ref={setDevToolsRef}
          domStorageEnabled
          injectedJavaScript={healthProbe}
          injectedJavaScriptBeforeContentLoaded={devToolsBootstrap}
          javaScriptEnabled
          onError={webViewError}
          onHttpError={webViewHttpError}
          onLoadStart={onDevToolsLoadStart}
          onMessage={onDevToolsMessage}
          onRenderProcessGone={rendererGone}
          originWhitelist={["http://127.0.0.1:*"]}
          setSupportMultipleWindows={false}
          source={{ uri: devToolsUrl }}
          style={styles.webView}
          testID="chromium-devtools-webview"
        />
        {devToolsDocumentLoading && devToolsError === null ? (
          <ShimmerText containerStyle={styles.loading} text="Loading Chromium DevTools…" />
        ) : devToolsError === null ? null : (
          <View style={styles.errorPanel} testID="chromium-devtools-error-boundary">
            <Text style={styles.errorTitle}>Chromium DevTools unavailable</Text>
            <Text selectable style={styles.errorMessage}>
              {devToolsError}
            </Text>
            <View style={styles.actions}>
              <Pressable accessibilityLabel="Retry Chromium DevTools" onPress={retryDevTools}>
                <Text style={styles.action}>Retry</Text>
              </Pressable>
              <Pressable accessibilityLabel="Close Chromium DevTools" onPress={closeDevTools}>
                <Text style={styles.action}>Close</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </>
  );
}

interface BrowserErrorEvent {
  nativeEvent: { description: string };
}

interface BrowserHttpErrorEvent {
  nativeEvent: { statusCode: number };
}

interface BrowserRendererGoneEvent {
  nativeEvent: { didCrash: boolean };
}

const styles = StyleSheet.create({
  action: { color: colors.accent, ...typeScale.label },
  actions: { flexDirection: "row", gap: spacing.md },
  divider: { alignItems: "center", flexShrink: 0, justifyContent: "center" },
  dividerHorizontal: { height: 10, width: "100%" },
  dividerVertical: { height: "100%", width: 10 },
  errorMessage: { color: colors.textMuted, ...typeScale.label },
  errorPanel: {
    backgroundColor: colors.surface,
    gap: spacing.sm,
    left: spacing.md,
    padding: spacing.md,
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
  },
  errorTitle: { color: colors.text, ...typeScale.body },
  handle: { backgroundColor: colors.border, borderRadius: 1 },
  handleHorizontal: { height: 2, width: 48 },
  handleVertical: { height: 48, width: 2 },
  loading: { alignSelf: "center", position: "absolute", top: "48%" },
  pane: { flex: 1, minHeight: 0, minWidth: 0 },
  webView: { backgroundColor: colors.background, flex: 1 },
});
