import { useState, useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { WebViewErrorEvent } from "react-native-webview/lib/WebViewTypes";
import { WebView } from "react-native-webview";

import { useEvent } from "../../../react/useEvent";
import { isolatedPreviewHtml } from "../../application/preview/isolatedHtml";
import type { WebPreviewCapabilityProps } from "../../features/attachments/previewCapabilities";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

const SAFE_ORIGINS = ["about:blank"];

interface WebNavigationRequest {
  url: string;
}

export function NativeWebPreview(props: WebPreviewCapabilityProps): React.JSX.Element {
  const { html, title } = props;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [retrying, startRetry] = useTransition();
  const accessibilityState = { busy: retrying, disabled: retrying };
  const source = { baseUrl: "about:blank", html: isolatedPreviewHtml(html) };
  const fail = useEvent((event: WebViewErrorEvent): void => {
    setLoading(false);
    setError(
      event.nativeEvent.description === ""
        ? "Could not render this attachment"
        : event.nativeEvent.description,
    );
  });
  const finishedLoading = useEvent(() => setLoading(false));
  const startedLoading = useEvent(() => setLoading(true));
  const denyNavigation = useEvent((request: WebNavigationRequest) => request.url === "about:blank");
  const retry = useEvent((): void => {
    if (retrying) return;
    startRetry(() => {
      setError(null);
      setLoading(true);
      setRevision((current) => current + 1);
    });
  });
  return (
    <View accessibilityLabel={`HTML preview: ${title}`} style={styles.root}>
      <WebView
        key={revision}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        javaScriptEnabled={false}
        mixedContentMode="never"
        onError={fail}
        onLoadEnd={finishedLoading}
        onLoadStart={startedLoading}
        onShouldStartLoadWithRequest={denyNavigation}
        originWhitelist={SAFE_ORIGINS}
        setSupportMultipleWindows={false}
        source={source}
        style={styles.webView}
      />
      {loading && error === null ? (
        <View accessibilityLabel="Loading attachment" pointerEvents="none" style={styles.overlay}>
          <ShimmerText text="Opening attachment…" />
        </View>
      ) : null}
      {error === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.overlay}>
          <Text style={styles.error}>{error}</Text>
          <Pressable
            accessibilityLabel="Retry attachment preview"
            accessibilityRole="button"
            accessibilityState={accessibilityState}
            disabled={retrying}
            onPress={retry}
            style={styles.retry}
          >
            {retrying ? (
              <ShimmerText text="Retrying…" />
            ) : (
              <Text style={styles.retryText}>Retry</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.text, ...typeScale.body, maxWidth: "80%", textAlign: "center" },
  overlay: {
    alignItems: "center",
    backgroundColor: colors.scrim,
    bottom: 0,
    gap: spacing.sm,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  retry: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  retryText: { color: colors.text, ...typeScale.label },
  root: { backgroundColor: colors.background, flex: 1 },
  webView: { backgroundColor: colors.background, flex: 1 },
});
