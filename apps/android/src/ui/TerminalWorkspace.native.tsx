import { Ionicons } from "@expo/vector-icons";
import { TerminalView, type TerminalViewRef } from "expo-libghostty";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  closeInteractiveTerminalTab,
  commitInteractiveTerminalRenderedOffset,
  createInteractiveTerminalTab,
  readInteractiveTerminalRenderedOffset,
  selectInteractiveTerminalTab,
  useInteractiveTerminalWorkspace,
  type InteractiveTerminalTab,
} from "../data/interactive-terminal-store";
import {
  readNativeTerminalOutput,
  resizeNativeTerminal,
  subscribeNativeTerminal,
  writeNativeTerminal,
} from "../native/native-transport";
import { colors, spacing, touchTarget, typeScale, iconSize, radii, layoutSize, controlSize } from "../theme";
import { useFullscreenWindowReady } from "./FullscreenWindowReady";
import { AppText as Text } from "./Typography";

const MAX_TABS = 8;
const TERMINAL_FONT_SIZE = 10;

export function TerminalWorkspace({
  connectionId,
  threadId,
  cwd,
  onMinimize,
}: {
  connectionId: string;
  threadId: string;
  cwd: string | null;
  onMinimize(): void;
}) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  const active = workspace.tabs.find(({ id }) => id === workspace.activeId) ?? workspace.tabs[0] ?? null;
  const createTab = () => createInteractiveTerminalTab({ connectionId, threadId, cwd });

  return (
    <View testID="terminal-workspace" style={styles.root}>
      <View style={styles.header}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabList} style={styles.tabScroll}>
          {workspace.tabs.map((tab) => (
            <View key={tab.id} style={[styles.tab, tab.id === active?.id && styles.activeTab]}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: tab.id === active?.id }}
                accessibilityLabel={tab.title}
                onPress={() => selectInteractiveTerminalTab(connectionId, threadId, tab.id)}
                style={styles.tabSelect}
              >
                <View style={[styles.statusDot, statusDotStyle(tab.status)]} />
                <Text numberOfLines={1} style={[styles.tabText, tab.id === active?.id && styles.activeTabText]}>{tab.title}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${tab.title}`}
                hitSlop={8}
                onPress={() => closeInteractiveTerminalTab(connectionId, threadId, tab.id)}
                style={({ pressed }) => [styles.tabClose, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={iconSize.inline} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New terminal tab"
          accessibilityState={{ disabled: workspace.tabs.length >= MAX_TABS }}
          disabled={workspace.tabs.length >= MAX_TABS}
          onPress={createTab}
          style={({ pressed }) => [styles.newTab, pressed && styles.pressed, workspace.tabs.length >= MAX_TABS && styles.disabled]}
        >
          <Ionicons name="add" size={iconSize.action} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Minimize terminal"
          onPress={onMinimize}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={iconSize.navigation} color={colors.text} />
        </Pressable>
      </View>

      {active === null ? (
        <View style={styles.empty}>
          <Ionicons name="terminal-outline" size={iconSize.illustration} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No terminal tabs</Text>
          <Pressable accessibilityRole="button" onPress={createTab} style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}>
            <Ionicons name="add" size={iconSize.action} color={colors.onPrimary} />
            <Text style={styles.createButtonText}>New terminal</Text>
          </Pressable>
        </View>
      ) : (
        <TerminalTab key={active.id} tab={active} />
      )}
    </View>
  );
}

function TerminalTab({ tab }: { tab: InteractiveTerminalTab }) {
  const terminalRef = useRef<TerminalViewRef>(null);
  const fullscreenWindowReady = useFullscreenWindowReady();
  const nextOffsetRef = useRef(readInteractiveTerminalRenderedOffset(tab.id));
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pumping = false;
    let requested = false;
    let finished = false;

    const drain = async () => {
      while (requested && !disposed) {
        requested = false;
        const terminal = terminalRef.current;
        if (terminal === null) return;
        while (!disposed) {
          const chunk = await readNativeTerminalOutput(tab.id, nextOffsetRef.current);
          if (chunk.data !== "") await terminal.write(chunk.data);
          nextOffsetRef.current = chunk.nextOffset;
          commitInteractiveTerminalRenderedOffset(tab.id, chunk.nextOffset);
          if (!chunk.hasMore) {
            if (chunk.finished && !finished) {
              finished = true;
              await terminal.finish(0);
            }
            break;
          }
        }
      }
    };

    const pump = () => {
      requested = true;
      if (pumping || disposed) return;
      pumping = true;
      void drain().then(
        () => {
          pumping = false;
          if (requested && !disposed) pump();
        },
        (cause: unknown) => {
          pumping = false;
          if (!disposed) setRenderError(message(cause, "Could not restore terminal output"));
          if (requested && !disposed) pump();
        },
      );
    };

    const unsubscribe = subscribeNativeTerminal((event) => {
      if (event.sessionId !== tab.id) return;
      if (event.type === "output" || event.type === "open" || event.type === "closed" || event.type === "error") pump();
    });
    pump();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [tab.id]);

  useEffect(() => {
    if (!fullscreenWindowReady) return;
    const frame = requestAnimationFrame(() => {
      void terminalRef.current?.reconcileLayout?.().catch((cause: unknown) => {
        setRenderError(message(cause, "Could not restore terminal layout"));
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [fullscreenWindowReady, tab.id]);

  const resize = (cols: number, rows: number) => {
    void resizeNativeTerminal(tab.id, cols, rows).catch((cause) => {
      if (tab.status !== "closed" && tab.status !== "error") setRenderError(message(cause, "Could not resize terminal"));
    });
  };
  const send = (data: string) => {
    void writeNativeTerminal(tab.id, data).catch((cause) => setRenderError(message(cause, "Could not send terminal input")));
  };
  const error = renderError ?? tab.error;

  return (
    <View style={styles.terminalPane}>
      {error !== null && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={iconSize.inline} color={colors.red} />
          <Text selectable style={styles.errorText}>{error}</Text>
        </View>
      )}
      <TerminalView
        ref={terminalRef}
        persistentSessionId={tab.id}
        fontSize={TERMINAL_FONT_SIZE}
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
      {tab.status === "connecting" && (
        <View pointerEvents="none" style={styles.connecting}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

function statusDotStyle(status: InteractiveTerminalTab["status"]) {
  if (status === "open") return styles.statusLive;
  if (status === "error") return styles.statusError;
  return styles.statusIdle;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  header: { minHeight: layoutSize.header, flexDirection: "row", alignItems: "center", paddingLeft: spacing.xs, paddingRight: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  tabScroll: { flex: 1, minWidth: 0 },
  tabList: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  tab: { minHeight: controlSize.compact, maxWidth: "100%", flexDirection: "row", alignItems: "center", borderRadius: radii.small, backgroundColor: colors.surfaceHover },
  activeTab: { backgroundColor: colors.surfaceRaised },
  tabSelect: { minWidth: controlSize.regular, flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingLeft: spacing.sm },
  tabText: { flexShrink: 1, color: colors.textMuted, ...typeScale.label },
  activeTabText: { color: colors.text },
  tabClose: { width: controlSize.compact, height: controlSize.compact, alignItems: "center", justifyContent: "center", borderRadius: radii.small },
  newTab: { width: controlSize.regular, height: controlSize.regular, marginRight: spacing.xs, alignItems: "center", justifyContent: "center", borderRadius: radii.small },
  statusDot: { width: 7, height: 7, borderRadius: radii.pill },
  statusLive: { backgroundColor: colors.green },
  statusError: { backgroundColor: colors.red },
  statusIdle: { backgroundColor: colors.textDim },
  terminalPane: { flex: 1, minWidth: 0, minHeight: 0 },
  terminal: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  connecting: { position: "absolute", top: spacing.md, right: spacing.md },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.errorContainer },
  errorText: { flex: 1, color: colors.red, ...typeScale.label },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { color: colors.textMuted, ...typeScale.body },
  createButton: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.medium, backgroundColor: colors.accent },
  createButtonText: { color: colors.onPrimary, ...typeScale.body },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});
