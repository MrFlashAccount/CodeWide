import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { colors, spacing, touchTarget, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

const SPEEDSCOPE_URL = "file:///android_asset/speedscope/index.html#localProfilePath=android_asset%2Fspeedscope%2Fcodewide-loader.js&view=time-ordered";

export function SpeedscopeProfileViewer({ title, fileName, content, onClose }: {
  title: string;
  fileName: string;
  content: string;
  onClose(): void;
}) {
  const webView = useRef<WebView>(null);
  const base64Profile = useMemo(() => utf8Base64(content), [content]);
  const [status, setStatus] = useState<"waiting" | "loading" | "ready" | "error">("waiting");
  const [error, setError] = useState<string | null>(null);

  const loadProfile = () => {
    setStatus("loading");
    webView.current?.injectJavaScript(`
      (() => {
        const loader = window.speedscope && window.speedscope.loadFileFromBase64;
        if (typeof loader !== "function") {
          window.ReactNativeWebView.postMessage(JSON.stringify({type:"speedscope-error",message:"Speedscope loader is unavailable"}));
          return;
        }
        loader(${JSON.stringify(fileName)}, ${JSON.stringify(base64Profile)});
        window.ReactNativeWebView.postMessage(JSON.stringify({type:"speedscope-profile-loaded"}));
      })();
      true;
    `);
  };

  const handleMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    let message: { type?: string; message?: string };
    try {
      message = JSON.parse(nativeEvent.data) as { type?: string; message?: string };
    } catch {
      return;
    }
    if (message.type === "speedscope-ready") loadProfile();
    if (message.type === "speedscope-profile-loaded") setStatus("ready");
    if (message.type === "speedscope-error") {
      setStatus("error");
      setError(message.message ?? "Speedscope failed to load the profile");
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close performance profile" onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>Speedscope · local profile viewer</Text>
        </View>
        {(status === "waiting" || status === "loading") && <ActivityIndicator color={colors.textMuted} />}
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <WebView
        ref={webView}
        source={{ uri: SPEEDSCOPE_URL }}
        originWhitelist={["file://*"]}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        onError={({ nativeEvent }) => {
          setStatus("error");
          setError(nativeEvent.description || "Speedscope WebView failed to load");
        }}
        onRenderProcessGone={() => {
          setStatus("error");
          setError("Android stopped the Speedscope renderer");
        }}
        style={styles.webView}
      />
    </View>
  );
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 32_768;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  closeButton: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center" },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { ...typeScale.titleMedium, color: colors.text },
  subtitle: { ...typeScale.labelMedium, color: colors.textMuted },
  error: { color: colors.red, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  webView: { flex: 1, backgroundColor: colors.background },
});
