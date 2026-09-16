import { fromByteArray } from "base64-js";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { unknownRecord } from "../data/unknownRecord";
import { colors, spacing, touchTarget, typeScale, iconSize, layoutSize } from "../theme";
import { AppText as Text } from "./Typography";

const SPEEDSCOPE_URL =
  "file:///android_asset/speedscope/index.html#localProfilePath=android_asset%2Fspeedscope%2Fcodewide-loader.js&view=time-ordered";

export function SpeedscopeProfileViewer({
  content,
  fileName,
  onClose,
  title,
}: {
  content: string;
  fileName: string;
  onClose: () => void;
  title: string;
}) {
  const webView = useRef<WebView>(null);
  const base64Profile = utf8Base64(content);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(nativeEvent.data);
    } catch {
      return;
    }
    const message = unknownRecord(parsed);
    if (message === null) {
      return;
    }
    if (message.type === "speedscope-ready") {
      loadProfile();
    }
    if (message.type === "speedscope-profile-loaded") {
      setStatus("ready");
    }
    if (message.type === "speedscope-error") {
      setStatus("error");
      setError(
        typeof message.message === "string"
          ? message.message
          : "Speedscope failed to load the profile",
      );
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close performance profile"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            Speedscope · local profile viewer
          </Text>
        </View>
        {(status === "waiting" || status === "loading") && (
          <ActivityIndicator color={colors.textMuted} />
        )}
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <WebView
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled
        javaScriptEnabled
        onError={({ nativeEvent }) => {
          setStatus("error");
          setError(
            nativeEvent.description === ""
              ? "Speedscope WebView failed to load"
              : nativeEvent.description,
          );
        }}
        onMessage={handleMessage}
        onRenderProcessGone={() => {
          setStatus("error");
          setError("Android stopped the Speedscope renderer");
        }}
        originWhitelist={["file://*"]}
        ref={webView}
        setSupportMultipleWindows={false}
        source={{ uri: SPEEDSCOPE_URL }}
        style={styles.webView}
      />
    </View>
  );
}

function utf8Base64(value: string): string {
  return fromByteArray(new TextEncoder().encode(value));
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  error: {
    color: colors.red,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.xs,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  subtitle: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  webView: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
