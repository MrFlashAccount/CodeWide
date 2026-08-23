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
        const post = (type, message) => window.ReactNativeWebView.postMessage(JSON.stringify({type, message}));
        const describe = (value) => {
          if (value instanceof Error) return value.stack || value.message;
          if (typeof value === "string") return value;
          try { return JSON.stringify(value); } catch { return String(value); }
        };
        let parserError = null;
        const originalLog = console.log.bind(console);
        const originalError = console.error.bind(console);
        console.log = (...args) => {
          originalLog(...args);
          if (args[0] === "Failed to load format") {
            parserError = args.slice(1).map(describe).join(" ") || "Speedscope rejected the profile";
            post("speedscope-error", parserError);
          }
        };
        console.error = (...args) => {
          originalError(...args);
          const message = args.map(describe).join(" ");
          if (message.includes("Failed to create WebGL context")) {
            parserError = message;
            post("speedscope-error", message);
          }
        };
        window.addEventListener("error", (event) => {
          parserError = describe(event.error || event.message);
          post("speedscope-error", parserError);
        }, {once: true});
        window.addEventListener("unhandledrejection", (event) => {
          parserError = describe(event.reason);
          post("speedscope-error", parserError);
        }, {once: true});
        const loader = window.speedscope && window.speedscope.loadFileFromBase64;
        if (typeof loader !== "function") {
          post("speedscope-error", "Speedscope loader is unavailable");
          return;
        }
        const initialTitle = document.title;
        try {
          loader(${JSON.stringify(fileName)}, ${JSON.stringify(base64Profile)});
        } catch (cause) {
          parserError = describe(cause);
          post("speedscope-error", parserError);
          return;
        }
        const startedAt = Date.now();
        const check = window.setInterval(() => {
          if (parserError !== null) {
            window.clearInterval(check);
            return;
          }
          if (document.title !== initialTitle && document.title.endsWith(" - speedscope")) {
            window.clearInterval(check);
            post("speedscope-profile-loaded");
            return;
          }
          if (document.body?.innerText.includes("Something went wrong")) {
            window.clearInterval(check);
            post("speedscope-error", "Speedscope rejected the profile without exposing a parser error");
            return;
          }
          if (Date.now() - startedAt > 10000) {
            window.clearInterval(check);
            post("speedscope-error", "Speedscope did not finish loading the profile within 10 seconds");
          }
        }, 50);
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
