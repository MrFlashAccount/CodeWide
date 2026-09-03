import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

export interface SpeedscopeProfileViewerProps {
  content: string;
  fileName: string;
  onClose(): void;
  title: string;
}

type ViewerStatus = "error" | "loading" | "ready" | "waiting";

interface ViewerMessage {
  message?: string;
  type?: string;
}

const SPEEDSCOPE_SOURCE = {
  uri: "file:///android_asset/speedscope/index.html#localProfilePath=android_asset%2Fspeedscope%2Fcodewide-loader.js&view=time-ordered",
};
const SPEEDSCOPE_ORIGIN_WHITELIST = ["file://*"];

export function SpeedscopeProfileViewer(props: SpeedscopeProfileViewerProps): React.JSX.Element {
  const { content, fileName, onClose, title } = props;
  const webView = useRef<WebView>(null);
  const base64Profile = utf8Base64(content);
  const [status, setStatus] = useState<ViewerStatus>("waiting");
  const [error, setError] = useState<string | null>(null);
  const loadProfile = useEvent(() => {
    setStatus("loading");
    webView.current?.injectJavaScript(profileLoaderScript(fileName, base64Profile));
  });
  const handleMessage = useEvent((event: WebViewMessageEvent) => {
    const message = parseViewerMessage(event.nativeEvent.data);
    if (message === null) return;
    if (message.type === "speedscope-ready") loadProfile();
    if (message.type === "speedscope-profile-loaded") setStatus("ready");
    if (message.type === "speedscope-error") {
      setStatus("error");
      setError(message.message ?? "Speedscope failed to load the profile");
    }
  });
  const handleError = useEvent(() => {
    setStatus("error");
    setError("Speedscope WebView failed to load");
  });
  const handleRendererLoss = useEvent(() => {
    setStatus("error");
    setError("Android stopped the Speedscope renderer");
  });
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close performance profile"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.closeButton}
        >
          <PresentationIcon color={colors.text} name="close" size={typeScale.heading.fontSize} />
        </Pressable>
        <View style={styles.titleBlock}>
          <ProductText numberOfLines={1} weight="semibold">
            {title}
          </ProductText>
          <ProductText numberOfLines={1} tone="muted">
            Speedscope · local profile viewer
          </ProductText>
        </View>
        {status === "waiting" || status === "loading" ? (
          <ShimmerText style={styles.loading} text="Loading" />
        ) : null}
      </View>
      {error === null ? null : (
        <ProductText accessibilityRole="alert" style={styles.error} tone="danger">
          {error}
        </ProductText>
      )}
      <WebView
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled
        javaScriptEnabled
        onError={handleError}
        onMessage={handleMessage}
        onRenderProcessGone={handleRendererLoss}
        originWhitelist={SPEEDSCOPE_ORIGIN_WHITELIST}
        ref={webView}
        setSupportMultipleWindows={false}
        source={SPEEDSCOPE_SOURCE}
        style={styles.webView}
      />
    </View>
  );
}

function parseViewerMessage(value: string): ViewerMessage | null {
  try {
    return JSON.parse(value) as ViewerMessage;
  } catch {
    return null;
  }
}

function profileLoaderScript(fileName: string, content: string): string {
  return `(() => {
    const post = (type, message) => window.ReactNativeWebView.postMessage(JSON.stringify({type, message}));
    const loader = window.speedscope && window.speedscope.loadFileFromBase64;
    if (typeof loader !== "function") { post("speedscope-error", "Speedscope loader is unavailable"); return; }
    try { loader(${JSON.stringify(fileName)}, ${JSON.stringify(content)}); }
    catch (cause) { post("speedscope-error", String(cause)); return; }
    const initialTitle = document.title;
    const startedAt = Date.now();
    const check = window.setInterval(() => {
      if (document.title !== initialTitle && document.title.endsWith(" - speedscope")) {
        window.clearInterval(check); post("speedscope-profile-loaded"); return;
      }
      if (Date.now() - startedAt > 10000) {
        window.clearInterval(check); post("speedscope-error", "Speedscope did not finish loading within 10 seconds");
      }
    }, 50);
  })(); true;`;
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCodePoint(...bytes.subarray(offset, offset + 32_768)));
  }
  return btoa(chunks.join(""));
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  error: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget + spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  loading: { ...typeScale.caption },
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0, minWidth: 0 },
  titleBlock: { flex: 1, minWidth: 0 },
  webView: { backgroundColor: colors.background, flex: 1 },
});
