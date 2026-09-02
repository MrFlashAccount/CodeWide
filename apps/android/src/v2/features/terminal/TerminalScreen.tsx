import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { TerminalView, type TerminalViewRef } from "expo-libghostty";
import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import type {
  TerminalTransport,
  TerminalTransportEvent,
} from "../../application/ports/terminalTransport";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { useDisposableLifecycle } from "../../../boot/useDisposableLifecycle";
import { useEvent } from "../../../react/useEvent";
import { colors, spacing, touchTarget, typeScale } from "../../theme";

const MAX_TABS = 8;
const TERMINAL_FONT_SIZE = 10;

interface TerminalScreenProps {
  owner: QualifiedThread;
}

interface ProjectedTerminalProps extends TerminalScreenProps {
  resource: ProjectionResource;
}

interface TerminalTabModel {
  error: string | null;
  id: string;
  status: "connecting" | "open" | "closed" | "error";
  title: string;
}

interface TerminalTabButtonProps {
  active: boolean;
  onClose(id: string): Promise<void>;
  onSelect(id: string): void;
  tab: TerminalTabModel;
}

interface ActiveTerminalProps {
  onAttach(id: string, terminal: TerminalViewRef | null): void;
  onReconcile(id: string): void;
  onResize(id: string, cols: number, rows: number): void;
  onSend(id: string, data: string): void;
  tab: TerminalTabModel;
}

interface TerminalInputEvent {
  nativeEvent: { data: string };
}

interface TerminalResizeEvent {
  nativeEvent: { cols: number; rows: number };
}

type TerminalHandle = Awaited<ReturnType<TerminalTransport["open"]>>;

export function TerminalScreen(props: TerminalScreenProps): React.JSX.Element {
  const { owner } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(owner.savedServerId, owner.threadId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <View style={styles.root}>
        <ShimmerText style={styles.loadingText} text="Loading terminal…" />
      </View>
    );
  }
  return <ProjectedTerminal owner={owner} resource={opened.value} />;
}

function ProjectedTerminal(props: ProjectedTerminalProps): React.JSX.Element {
  const { owner, resource } = props;
  const runtime = useV2Runtime();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live;
  const [tabs, setTabs] = useState<TerminalTabModel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const handles = useRef(new Map<string, TerminalHandle>());
  const terminals = useRef(new Map<string, TerminalViewRef>());
  const pendingOutput = useRef(new Map<string, string[]>());
  const writeChains = useRef(new Map<string, Promise<void>>());
  const nextTab = useRef(1);
  const cleanup = useRef({
    async close() {
      for (const handle of handles.current.values()) await handle.close().catch(() => undefined);
      handles.current.clear();
    },
  });
  useDisposableLifecycle(cleanup);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;

  const updateTab = useEvent((id: string, patch: Partial<TerminalTabModel>) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  });
  const write = useEvent((id: string, data: string) => {
    const terminal = terminals.current.get(id);
    if (terminal === undefined) {
      const chunks = pendingOutput.current.get(id) ?? [];
      chunks.push(data);
      pendingOutput.current.set(id, chunks);
      return;
    }
    const previous = writeChains.current.get(id) ?? Promise.resolve();
    const next = previous.then(() => terminal.write(data));
    writeChains.current.set(id, next);
    void next.catch((cause: unknown) => {
      updateTab(id, { error: message(cause, "Could not render terminal output"), status: "error" });
    });
  });
  const listen = useEvent((id: string, event: TerminalTransportEvent) => {
    if (event.type === "opened") updateTab(id, { error: null, status: "open" });
    else if (event.type === "output") write(id, event.data);
    else if (event.type === "exited") {
      updateTab(id, { status: "closed" });
      void terminals.current
        .get(id)
        ?.finish(0)
        .catch(() => undefined);
    } else updateTab(id, { error: event.message, status: "error" });
  });
  const createTab = useEvent(async () => {
    if (projection === null || tabs.length >= MAX_TABS) return;
    const ordinal = nextTab.current;
    nextTab.current += 1;
    const id = `v2-terminal-tab-${ordinal}`;
    setTabs((current) => [
      ...current,
      { error: null, id, status: "connecting", title: `Terminal ${ordinal}` },
    ]);
    setActiveId(id);
    pendingOutput.current.set(id, []);
    const workspace = projection.currentThread?.thread.workspace ?? null;
    try {
      const handle = await runtime.terminal.open(
        owner,
        projection.sourceGeneration,
        workspace,
        (event) => listen(id, event),
      );
      handles.current.set(id, handle);
    } catch (cause) {
      updateTab(id, { error: message(cause, "Could not open terminal"), status: "error" });
    }
  });
  const closeTab = useEvent(async (id: string) => {
    const handle = handles.current.get(id);
    handles.current.delete(id);
    terminals.current.delete(id);
    pendingOutput.current.delete(id);
    writeChains.current.delete(id);
    if (handle !== undefined) await handle.close();
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  });
  const attachTerminal = useEvent((id: string, terminal: TerminalViewRef | null) => {
    if (terminal === null) {
      terminals.current.delete(id);
      return;
    }
    terminals.current.set(id, terminal);
    const chunks = pendingOutput.current.get(id) ?? [];
    pendingOutput.current.set(id, []);
    for (const chunk of chunks) write(id, chunk);
  });
  const send = useEvent((id: string, data: string) => {
    const handle = handles.current.get(id);
    if (handle === undefined) return;
    void handle.input(data).catch((cause: unknown) => {
      updateTab(id, { error: message(cause, "Could not send terminal input"), status: "error" });
    });
  });
  const resize = useEvent((id: string, cols: number, rows: number) => {
    const handle = handles.current.get(id);
    if (handle === undefined) return;
    void handle.resize(cols, rows).catch((cause: unknown) => {
      updateTab(id, { error: message(cause, "Could not resize terminal"), status: "error" });
    });
  });
  const reconcile = useEvent((id: string) => {
    void terminals.current
      .get(id)
      ?.reconcileLayout?.()
      .catch((cause: unknown) => {
        updateTab(id, {
          error: message(cause, "Could not restore terminal layout"),
          status: "error",
        });
      });
  });
  const activateCreate = useEvent(() => {
    void createTab().catch(() => undefined);
  });
  const minimize = useEvent(() => router.back());

  return (
    <View testID="v2-terminal-workspace" style={styles.root}>
      <View style={styles.header}>
        <ScrollView
          contentContainerStyle={styles.tabList}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
        >
          {tabs.map((tab) => (
            <TerminalTabButton
              key={tab.id}
              active={tab.id === active?.id}
              onClose={closeTab}
              onSelect={setActiveId}
              tab={tab}
            />
          ))}
        </ScrollView>
        <Pressable
          accessibilityLabel="New terminal tab"
          accessibilityRole="button"
          accessibilityState={{ disabled: projection === null || tabs.length >= MAX_TABS }}
          disabled={projection === null || tabs.length >= MAX_TABS}
          onPress={activateCreate}
          style={styles.newTab}
        >
          <Ionicons color={colors.text} name="add" size={21} />
        </Pressable>
        <Pressable
          accessibilityLabel="Minimize terminal"
          accessibilityRole="button"
          onPress={minimize}
          style={styles.headerButton}
        >
          <Ionicons color={colors.text} name="chevron-down" size={24} />
        </Pressable>
      </View>
      {active === null ? (
        <View style={styles.empty}>
          <Ionicons color={colors.textMuted} name="terminal-outline" size={30} />
          <Text style={styles.emptyTitle}>No terminal tabs</Text>
          <Pressable
            accessibilityLabel="Open terminal"
            accessibilityRole="button"
            disabled={projection === null}
            onPress={activateCreate}
            style={styles.createButton}
          >
            <Ionicons color={colors.onPrimary} name="add" size={18} />
            <Text style={styles.createButtonText}>New terminal</Text>
          </Pressable>
        </View>
      ) : (
        <ActiveTerminal
          key={active.id}
          onAttach={attachTerminal}
          onReconcile={reconcile}
          onResize={resize}
          onSend={send}
          tab={active}
        />
      )}
    </View>
  );
}

function TerminalTabButton(props: TerminalTabButtonProps): React.JSX.Element {
  const { active, onClose, onSelect, tab } = props;
  const select = useEvent(() => onSelect(tab.id));
  const close = useEvent(() => {
    void onClose(tab.id).catch(() => undefined);
  });
  return (
    <View style={[styles.tab, active && styles.activeTab]}>
      <Pressable
        accessibilityLabel={tab.title}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={select}
        style={styles.tabSelect}
      >
        <View style={[styles.statusDot, statusDotStyle(tab.status)]} />
        <Text numberOfLines={1} style={[styles.tabText, active && styles.activeTabText]}>
          {tab.title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={`Close ${tab.title}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={close}
        style={styles.tabClose}
      >
        <Ionicons color={colors.textMuted} name="close" size={16} />
      </Pressable>
    </View>
  );
}

function ActiveTerminal(props: ActiveTerminalProps): React.JSX.Element {
  const { onAttach, onReconcile, onResize, onSend, tab } = props;
  const attach = useEvent((value: TerminalViewRef | null) => onAttach(tab.id, value));
  const reconcile = useEvent(() => onReconcile(tab.id));
  const send = useEvent((event: TerminalInputEvent) => onSend(tab.id, event.nativeEvent.data));
  const resize = useEvent((event: TerminalResizeEvent) =>
    onResize(tab.id, event.nativeEvent.cols, event.nativeEvent.rows),
  );
  return (
    <View onLayout={reconcile} style={styles.pane}>
      {tab.error === null ? null : (
        <View style={styles.errorBanner}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={17} />
          <Text selectable style={styles.errorText}>
            {tab.error}
          </Text>
        </View>
      )}
      <TerminalView
        ref={attach}
        fontSize={TERMINAL_FONT_SIZE}
        onInput={send}
        onResize={resize}
        style={styles.terminal}
        theme={{
          background: colors.background,
          cursorColor: colors.text,
          foreground: colors.text,
          selectionBackground: colors.surfaceHover,
        }}
      />
      {tab.status === "connecting" ? (
        <View pointerEvents="none" style={styles.connecting}>
          <ShimmerText style={styles.loadingText} text="Connecting…" />
        </View>
      ) : null}
    </View>
  );
}

function statusDotStyle(status: TerminalTabModel["status"]): ViewStyle {
  if (status === "open") return styles.statusLive;
  if (status === "error") return styles.statusError;
  return styles.statusIdle;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  activeTab: { backgroundColor: colors.surfaceRaised },
  activeTabText: { color: colors.text },
  connecting: { position: "absolute", right: spacing.md, top: spacing.md },
  loadingText: { color: colors.textMuted, ...typeScale.caption },
  createButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 14,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  createButtonText: { color: colors.onPrimary, ...typeScale.body },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyTitle: { color: colors.textMuted, ...typeScale.body },
  errorBanner: {
    alignItems: "center",
    backgroundColor: colors.errorContainer,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  errorText: { color: colors.red, flex: 1, ...typeScale.label },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  headerButton: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  newTab: {
    alignItems: "center",
    borderRadius: 10,
    height: 38,
    justifyContent: "center",
    marginRight: spacing.xs,
    width: 38,
  },
  pane: { flex: 1, minHeight: 0, minWidth: 0 },
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0, minWidth: 0 },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusError: { backgroundColor: colors.red },
  statusIdle: { backgroundColor: colors.textDim },
  statusLive: { backgroundColor: colors.green },
  tab: {
    alignItems: "center",
    backgroundColor: colors.surfaceHover,
    borderRadius: 10,
    flexDirection: "row",
    height: 34,
    maxWidth: 190,
  },
  tabClose: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  tabList: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  tabScroll: { flex: 1, minWidth: 0 },
  tabSelect: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: "100%",
    minWidth: 80,
    paddingLeft: spacing.sm,
  },
  tabText: { color: colors.textMuted, flexShrink: 1, ...typeScale.label },
  terminal: { backgroundColor: colors.background, flex: 1, minHeight: 0, minWidth: 0 },
});
