import { Ionicons } from "@expo/vector-icons";
import { TerminalView, type TerminalViewRef } from "expo-libghostty";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import {
  closeNativeTerminal,
  openNativeTerminal,
  resizeNativeTerminal,
  subscribeNativeTerminal,
  writeNativeTerminal,
} from "../native/native-transport";
import { colors, spacing, touchTarget, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

export function TerminalWorkspace({
  connectionId,
  cwd,
  onClose,
}: {
  connectionId: string;
  cwd: string | null;
  onClose(): void;
}) {
  const terminalRef = useRef<TerminalViewRef>(null);
  const sessionIdRef = useRef(`terminal-${Crypto.randomUUID()}`);
  const nativeSessionCreatedRef = useRef(false);
  const sizeRef = useRef({ cols: 80, rows: 24 });
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = subscribeNativeTerminal((event) => {
      if (event.sessionId !== sessionIdRef.current) return;
      if (event.type === "output" && event.data !== undefined) {
        void terminalRef.current?.write(event.data).catch((cause) => {
          setStatus("error");
          setError(message(cause, "Could not render terminal output"));
        });
        return;
      }
      if (event.type === "open") {
        setStatus("open");
        setError(null);
      } else if (event.type === "error") {
        setStatus("error");
        setError(event.message ?? "Terminal connection failed");
      } else if (event.type === "closed") {
        setStatus("closed");
        void terminalRef.current?.finish(0);
      }
    });
    const sessionId = sessionIdRef.current;
    void openNativeTerminal({ sessionId, connectionId, cwd, ...sizeRef.current }).then(
      () => {
        nativeSessionCreatedRef.current = true;
        if (disposed) {
          closeNativeTerminal(sessionId);
          return;
        }
        void resizeNativeTerminal(sessionId, sizeRef.current.cols, sizeRef.current.rows).catch(() => undefined);
      },
      (cause) => {
        if (disposed) return;
        setStatus("error");
        setError(message(cause, "Could not open terminal"));
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
      if (nativeSessionCreatedRef.current) closeNativeTerminal(sessionId);
    };
  }, [connectionId, cwd]);

  const send = (data: string) => {
    if (!nativeSessionCreatedRef.current) return;
    const sessionId = sessionIdRef.current;
    void writeNativeTerminal(sessionId, data).catch((cause) => {
      setStatus("error");
      setError(message(cause, "Could not send terminal input"));
    });
  };
  const resize = (cols: number, rows: number) => {
    sizeRef.current = { cols, rows };
    if (!nativeSessionCreatedRef.current) return;
    const sessionId = sessionIdRef.current;
    void resizeNativeTerminal(sessionId, cols, rows).catch((cause) => {
      setStatus("error");
      setError(message(cause, "Could not resize terminal"));
    });
  };

  return (
    <View testID="terminal-workspace" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.title}>Terminal</Text>
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.subtitle}>{cwd ?? "Home directory"}</Text>
        </View>
        <View style={styles.status}>
          {status === "connecting" && <ActivityIndicator size="small" color={colors.textMuted} />}
          <View style={[styles.statusDot, status === "open" ? styles.statusLive : status === "error" ? styles.statusError : styles.statusIdle]} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close terminal" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <Ionicons name="close" size={23} color={colors.text} />
        </Pressable>
      </View>
      {error !== null && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={17} color={colors.red} />
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}
      <TerminalView
        ref={terminalRef}
        fontSize={14}
        theme={{
          background: colors.background,
          foreground: colors.text,
          cursorColor: colors.text,
          selectionBackground: colors.surfaceHover,
        }}
        onInput={({ nativeEvent }) => send(nativeEvent.data)}
        onResize={({ nativeEvent }) => resize(nativeEvent.cols, nativeEvent.rows)}
        style={styles.terminal}
      />
    </View>
  );
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
  identity: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typeScale.titleMedium },
  subtitle: { color: colors.textMuted, ...typeScale.labelMedium },
  status: { minWidth: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLive: { backgroundColor: colors.green },
  statusError: { backgroundColor: colors.red },
  statusIdle: { backgroundColor: colors.textDim },
  close: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: touchTarget / 2 },
  pressed: { backgroundColor: colors.surfaceHover },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.errorContainer },
  errorText: { flex: 1, color: colors.red, ...typeScale.labelMedium },
  terminal: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
});
