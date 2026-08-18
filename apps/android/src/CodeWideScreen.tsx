import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { Accordion } from "heroui-native/accordion";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { FieldError } from "heroui-native/field-error";
import { Label } from "heroui-native/label";
import { Menu, type MenuTriggerRef } from "heroui-native/menu";
import { TextField } from "heroui-native/text-field";
import { LegendList, type LegendListRenderItemProps, useRecyclingState } from "@legendapp/list/react-native";
import { parsePairingPayload } from "@codewide/codex-protocol/pairing";
import type { ReviewDelivery, ReviewTarget, Thread, ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import { connectionId, normalizeThreadItem } from "@codewide/domain";
import { projectCompleteMarkdown, projectMarkdownStream } from "@codewide/rendering-core";
import { toRenderBlock, type RenderBlock, type RenderContentReference } from "@codewide/renderers";
import { latestProjectedThreadExecutionSettings, MAX_TURN_TEXT_CHARS, projectedThreadExecutionSettings, projectedTurnMetadata, type TurnUsageProjection } from "@codewide/sync-client";
import { and, eq, gte, lte, or, useLiveQuery } from "@tanstack/react-db";
import { Gesture, GestureDetector, Pressable as GesturePressable } from "react-native-gesture-handler";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { KeyboardController, KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import Reanimated, {
  cancelAnimation,
  Easing as ReanimatedEasing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions } from "expo-camera";
import { createContext, type ReactNode, useContext, useDeferredValue, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Switch,
  ToastAndroid,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { colors, radii, spacing, touchTarget, typeScale } from "./theme";
import { useRemoteWorkspace, type BackgroundTerminal, type ComposerAttachment, type QueuedPrompt, type RemoteWorkspace, type SendMode, type ThreadChangeDiffValue, type ThreadGoalInput, type ThreadSettings, type TunnelPreview, type TurnControls, type TurnSendOptions, type VoiceTranscriptionEvent, type VoiceTranscriptionOptions, type VoiceTranscriptionSession } from "./data/use-remote-workspace";
import type { ThreadForkOptions } from "./data/thread-fork";
import { advanceResidentOffset, retreatResidentOffset, shouldPrefetchOlderPage, THREAD_RESIDENT_TURN_LIMIT, THREAD_TURN_PAGE_SIZE } from "./data/thread-pagination";
import { mergeThreadPartitions } from "./data/thread-partitions";
import { plainThreadPreview } from "./data/thread-cache";
import { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns, type ThreadDetailDatabase } from "./data/thread-detail-database";
import type { ThreadSummaryDatabase } from "./data/thread-summary-database";
import { subagentActivityTargetThreadId, subagentDisplayName, subagentsForThread } from "./data/subagent-projection";
import { deriveThreadProjects, projectIncludesCwd, projectLabel, threadContextLabel, type ThreadProject } from "./data/thread-projects";
import type { DraftSelection } from "./data/voice-draft";
import { isProfileOnlyConnectionUpdate, validateConnectionProfile, validateConnectionUpdateInput, type ConnectionInput, type ConnectionUpdateInput } from "./data/connection-validation";
import { resolveComposerSendMode, type ComposerSendPreference } from "./data/composer-delivery-mode";
import { validateGoalEditorDraft } from "./data/goal-editor";
import { currentThreadContextUsage, selectWeeklyRateLimit, type AccountRateLimitsRow } from "./data/account-rate-limits";
import { accountProfileLabel, type AccountPoolSnapshot } from "./data/account-pool";
import { isSafeHttpUrl, mcpElicitationFields, parseElicitationValue } from "./data/elicitation-form";
import { parseThreadDeepLink } from "./data/deep-link";
import { recordTiming } from "./data/operational-metrics";
import { humanPairingError } from "./data/pairing-error";
import {
  createNativePortForwardId,
  nativePortForwardingStore,
  useNativePortForwarding,
} from "./data/native-port-forwarding-store";
import { effectiveTurnLifecycleStatus, isThreadLifecycleActive } from "./data/thread-lifecycle";
import type { StoredConnection } from "./data/connection-profile-types";
import type { PendingServerRequest } from "./data/pending-request-types";
import type { StoredThreadSummary } from "./data/thread-summary-types";
import type { StoredComposerPreferences, ThreadUiStateRow } from "./data/thread-ui-state-types";
import { threadLoadResourceKey, threadResourceKey, tunnelResourceKey, turnControlsResourceKey, type BackgroundTerminalsRow, type FileTransferRow, type ThreadAttachmentResource, type ThreadChangeResource, type ThreadGoalRow, type ThreadLoadState, type ThreadResourcesRow, type ThreadResourcesValue, type TunnelRow, type TurnControlsRow, type VoiceInputRow } from "./data/workspace-resource-database";
import type { VoiceInputController } from "./data/voice-input-controller";
import type { FileTransferController } from "./data/file-transfer-controller";
import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "./data/attachment-upload";
import { type NativeCommandDelivery } from "./native/native-transport";
import { windowLayoutStore } from "./native/window-layout-store";
import { createTextUpload, pickUploadFile, type SelectedUpload } from "./native/file-transfer";
import { RichMarkdown } from "./rendering/RichMarkdown";
import { richMarkdownLayout, type RichMarkdownLayout } from "./rendering/rich-markdown-layout";
import { RichContentWidthProvider } from "./rendering/RichContentLayout";
import { ImagePreviewGroup, useImagePreview, useImagePreviewAnnotationHandler, useImagePreviewGroup, useRegisterImagePreviewItem } from "./rendering/ImagePreviewHost";
import { loadDocumentPreview, MAX_DOCUMENT_PREVIEW_BYTES, useDocumentDownload, useDocumentPreview, type DocumentPreviewRequest, type DocumentPreviewResult } from "./rendering/DocumentPreviewHost";
import { isolatedHtmlDocument, remoteDocumentDirectory, remoteFileKind, resolvePreviewableDocumentLink, resolveRemoteDocumentPath, type DocumentPreviewKind } from "./rendering/document-preview";
import { MarkdownLocalLinkProvider } from "./rendering/MarkdownLinkHandler";
import { forwardedLoopbackUrl, parseLoopbackLink, type LoopbackLinkTarget } from "./rendering/loopback-link";
import { NativeCodeBlock } from "./rendering/NativeCodeBlock";
import { CodeReviewWorkspace } from "./rendering/CodeReviewWorkspace";
import { codeReviewFilesForDocument } from "./rendering/code-review-files";
import { serializeCodeReviewAttachment, type CodeReviewComment } from "./rendering/code-review";
import { collapsedCodePreview, nativeCodeLanguageForPath, stripTerminalControlSequences } from "./rendering/native-code-block";
import { boundedJsonStringify } from "./rendering/bounded-json";
import { useAsyncResource } from "./rendering/async-resource-store";
import { changedFileDisplayPath } from "./rendering/changed-file-path";
import { projectFileChange } from "./rendering/file-change-rendering";
import { privateImageAssetProjection, safeImageUri, userImageSourceProjection } from "./rendering/image-source";
import { readPrivateAssetText, type GetTransferAccess, type PrivateAssetSource } from "./data/private-transfer";
import { projectCachedLiveText } from "./rendering/live-text-stream";
import { mergeChronologicalTimeline, protocolTimestampMs } from "./rendering/optimistic-timeline";
import { reasoningActivityTitle } from "./rendering/reasoning-title";
import { selectTurnRenderWindow } from "./rendering/thread-render-window";
import { ThreadTimelineList, type ThreadTimelineListRef } from "./rendering/ThreadTimelineList";
import { useTimelineOverlayScrollGuard } from "./rendering/use-timeline-overlay-scroll-guard";
import { optimisticTimelineKey, remoteTurnTimelineKey } from "./rendering/timeline-identity";
import { activeTurnSequence, type TurnSequencePart } from "./rendering/turn-sequence";
import { normalizeUserMessage } from "./rendering/user-message-normalizer";
import { PrivateAssetRecoveryProvider, PrivateImageAccessProvider, usePrivateAssetUri, usePrivateFileAccessScope, usePrivateImageUri } from "./rendering/use-private-image-uri";
import { useReducedMotionPreference } from "./rendering/reduced-motion-store";
import { AppSheet, AppSheetScrollView } from "./ui/AppSheet";
import { AppFullscreenOverlayBoundary, useAppFullscreenOverlay, type AppFullscreenOverlayLifecycle } from "./ui/AppFullscreenOverlay";
import { ActionMenu, type ActionMenuItem } from "./ui/ActionMenu";
import { useAppDialog } from "./ui/AppDialog";
import { ModelThinkingMenu, PermissionsMenu } from "./ui/TurnControlMenus";
import { AppText as Text, AppTextInput as TextInput } from "./ui/Typography";
import { AppVoiceInputProvider, useVoiceInputLevel, type AppVoiceInputRuntime } from "./ui/VoiceInputRuntime";
import { VoiceAura } from "./ui/VoiceAura";
import { WaveText } from "./ui/WaveText";
import { ContextRing, UsagePopover } from "./ui/UsagePopover";
import { CostBreakdownPopover } from "./ui/CostBreakdownPopover";
import { AnimatedNumber, compactNumberFormat, integerNumberFormat } from "./ui/AnimatedNumber";
import { PerformanceDiagnostics } from "./ui/PerformanceDiagnostics";
import { RecoverableRenderBoundary, RenderRecoveryProvider } from "./ui/RecoverableRenderBoundary";
import { renderRecoveryPrompt, type RecoverableRenderFailure } from "./ui/render-recovery-prompt";
import { SubagentSheet } from "./ui/SubagentSheet";
import { PortForwardingManager, type PortForwardingManagerProps } from "./ui/PortForwardingManager";
import { TerminalWorkspace } from "./ui/TerminalWorkspace";

const ALL_SERVERS_ID = "__all_servers__";

type ServerStatus = "live" | "syncing" | "offline" | "connecting" | "degraded" | "authRequired";

type DemoServer = {
  id: string;
  name: string;
  emoji: string;
  status: ServerStatus;
  endpoint?: string;
  token?: string;
  tlsPinSha256?: string;
};

type DemoThread = {
  id: string;
  serverId: string;
  title: string;
  preview: string;
  time: string;
  pinned: boolean;
  archived?: boolean;
  unread: number;
  state?: "running" | "approval" | "failed";
};

type InjectedTestWorkspace = {
  servers: DemoServer[];
  threads: DemoThread[];
  thread: Thread | null;
  controls: TurnControls | null;
};
const COLLAPSED_BODY_CHARS = 360;
const EXPANDED_BODY_CHARS = 96_000;
const TOOL_RESULT_MAX_HEIGHT = 400;
const TURN_FOOTER_MIN_HEIGHT = 20;
const USER_MESSAGE_COLLAPSED_LINES = 25;
const USER_MESSAGE_COLLAPSED_CHARS = 1_800;
const MAX_OPTIMISTIC_MESSAGES = 1_000;
const COMPOSER_MIN_HEIGHT = touchTarget;
const COMPOSER_MAX_HEIGHT = 132;
const COMPOSER_LINE_HEIGHT = 21;

async function copySessionId(sessionId: string): Promise<void> {
  await Clipboard.setStringAsync(sessionId);
  if (Platform.OS === "android") ToastAndroid.show("Session ID copied", ToastAndroid.SHORT);
}

const EMPTY_COMPOSER_PREFERENCES: StoredComposerPreferences = {
  model: null,
  effort: null,
  personality: null,
  permissions: null,
  skillPaths: [],
  sendMode: "start",
};
const LATEST_TIMELINE_THRESHOLD_PX = 2;
const sessionConversationScrollOffsets = new Map<string, number>();
const ForceExpandCardsContext = createContext(false);
const ActiveToolCallContext = createContext(false);
const TurnActivityContentContext = createContext(false);
const ExpansionItemKeyContext = createContext("item");
const ThreadCwdContext = createContext("/workspace");
const ThreadCodeDocumentContext = createContext<((request: DocumentPreviewRequest) => void) | null>(null);
const SubagentNavigationContext = createContext<((threadId: string) => void) | null>(null);
type LargeContentViewerRequest = {
  pointer: string;
  reference: RenderContentReference;
  presentation: "markdown" | "terminal" | "text";
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};
const LargeContentViewerContext = createContext<((request: LargeContentViewerRequest) => void) | null>(null);
const persistentExpansionStates = new Map<string, boolean>();
const PERSISTENT_EXPANSION_STATE_LIMIT = 4_096;

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function monotonicNowMs(): number {
  return performance.now();
}

function writePersistentExpansionState(key: string, expanded: boolean): void {
  persistentExpansionStates.delete(key);
  persistentExpansionStates.set(key, expanded);
  while (persistentExpansionStates.size > PERSISTENT_EXPANSION_STATE_LIMIT) {
    const oldest = persistentExpansionStates.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    persistentExpansionStates.delete(oldest);
  }
}

type ComposerMenuPage = "model" | "skills" | "permissions" | "queue" | "goal" | "review" | "runtime";
type ComposerAccessoryAction = "files" | "skills" | "goal" | "runtime";

function composerHeightForContent(text: string, measuredContentHeight: number): number {
  if (text === "") return COMPOSER_MIN_HEIGHT;
  const explicitLineFloor = COMPOSER_MIN_HEIGHT + Math.max(0, text.split("\n").length - 1) * COMPOSER_LINE_HEIGHT;
  return Math.max(
    COMPOSER_MIN_HEIGHT,
    Math.min(
      COMPOSER_MAX_HEIGHT,
      // contentSize already includes TextInput padding. Adding it again makes
      // the first glyph look like a second line.
      Math.max(explicitLineFloor, Math.ceil(measuredContentHeight)),
    ),
  );
}

function executionPermissionsLabel(settings: ReturnType<typeof projectedThreadExecutionSettings>, pending = true): string {
  if (settings?.permissions !== null && settings?.permissions !== undefined) return permissionProfileLabel(settings.permissions);
  const sandbox = settings?.sandboxPolicy === "dangerFullAccess"
    ? "Full access"
    : settings?.sandboxPolicy === "workspaceWrite"
      ? "Workspace"
      : settings?.sandboxPolicy === "readOnly"
        ? "Read only"
        : settings?.sandboxPolicy === "externalSandbox"
          ? "External sandbox"
          : null;
  const approval = settings?.approvalPolicy === "on-request"
    ? "Ask"
    : settings?.approvalPolicy === "untrusted"
      ? "Untrusted"
      : settings?.approvalPolicy === "never"
        ? "No prompts"
        : settings?.approvalPolicy === "granular"
          ? "Granular"
          : null;
  if (sandbox !== null && approval !== null) return `${sandbox} · ${approval}`;
  return sandbox ?? approval ?? (pending ? "Loading access…" : "Access unavailable");
}

function permissionProfileLabel(id: string): string {
  if (id === ":workspace") return "Workspace";
  if (id === ":read-only") return "Read only";
  if (id === ":full-access") return "Full access";
  return id.startsWith(":") ? id.slice(1).replaceAll("-", " ") : id;
}

function ComposerContextLabel({
  text,
  loading = false,
  testID,
}: {
  text: string;
  loading?: boolean;
  testID?: string;
}) {
  return loading
    ? <WaveText {...(testID === undefined ? {} : { testID })} text={text} style={styles.composerContextText} containerStyle={styles.composerContextWave} />
    : <Text testID={testID} numberOfLines={1} style={styles.composerContextText}>{text}</Text>;
}

function ComposerContextCount({ label, value, testID }: { label: string; value: number; testID?: string }) {
  return (
    <AnimatedNumber
      value={value}
      format={integerNumberFormat}
      prefix={`${label} · `}
      style={styles.composerContextText}
      containerStyle={styles.composerContextValue}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}

function pairingParseResult(raw: string): { value: ReturnType<typeof parsePairingPayload>; error: null } | { value: null; error: string } {
  try {
    return { value: parsePairingPayload(raw), error: null };
  } catch (cause) {
    return { value: null, error: humanPairingError(cause) };
  }
}

function useWindowLayout() {
  return useSyncExternalStore(windowLayoutStore.subscribe, windowLayoutStore.getSnapshot, windowLayoutStore.getSnapshot);
}

const EMPTY_TURN_CONTROLS: TurnControls = { models: [], skills: [], permissions: [] };

type TimelineItem =
  | {
      kind: "turn";
      id: string;
      key: string;
      connectionId: string;
      threadId: string;
      scope: string;
      turn: Thread["turns"][number];
    }
  | { kind: "optimistic"; scope: string; id: string; text: string; attachments: ComposerAttachment[]; status: "sending" | "uncertain" | "failed" | "delivered"; lastError: string | null; createdAt: number }
  | { kind: "meta"; key: string; status: "completed" | "interrupted" | "failed" | "inProgress"; durationMs: number | null; completedAt: number | null };

const timelineRowCache = new WeakMap<Thread["turns"][number], Extract<TimelineItem, { kind: "turn" }>>();
const liveBlockProjectionCache = new WeakMap<object, { revision: string; block: RenderBlock }>();
const timelineViewabilityConfig = { itemVisiblePercentThreshold: 1 };

function projectTimelineTurns(
  turns: readonly Thread["turns"][number][],
  composerScope: string,
  connectionId: string,
  threadId: string,
  threadState?: DemoThread["state"],
): Extract<TimelineItem, { kind: "turn" }>[] {
  return turns.map((rawTurn) => {
    const effectiveStatus = threadState === undefined
      ? rawTurn.status
      : effectiveTurnLifecycleStatus(rawTurn.status, threadState);
    const effectiveTurn = effectiveStatus === rawTurn.status
      ? rawTurn
      : { ...rawTurn, status: effectiveStatus };
    const cached = effectiveTurn === rawTurn ? timelineRowCache.get(rawTurn) : undefined;
    if (cached !== undefined) return cached;
    const item: Extract<TimelineItem, { kind: "turn" }> = {
      kind: "turn",
      id: rawTurn.id,
      key: `${composerScope}\u0000${rawTurn.id}`,
      connectionId,
      threadId,
      scope: composerScope,
      turn: effectiveTurn,
    };
    if (effectiveTurn === rawTurn) timelineRowCache.set(rawTurn, item);
    return item;
  });
}

function timelineItemKey(item: TimelineItem): string {
  if (item.kind === "turn") return remoteTurnTimelineKey(item.scope, item.id, item.turn.items);
  if (item.kind === "optimistic") return optimisticTimelineKey(item.scope, item.id);
  return `turn-meta-${item.key}`;
}

const timelineSearchTextCache = new WeakMap<object, string>();

class ScrollOffsetMemory {
  #value = 0;

  read(): number { return this.#value; }
  write(value: number): void { this.#value = value; }
}

class DemoComposerMemory {
  readonly #drafts = new Map<string, string>();
  readonly #attachments = new Map<string, ComposerAttachment[]>();
  readonly #preferences = new Map<string, StoredComposerPreferences>();

  read(scope: string): { draft: string; attachments: ComposerAttachment[]; preferences: StoredComposerPreferences } {
    return {
      draft: this.#drafts.get(scope) ?? "",
      attachments: structuredClone(this.#attachments.get(scope) ?? []),
      preferences: this.#preferences.get(scope) ?? EMPTY_COMPOSER_PREFERENCES,
    };
  }

  writeDraft(scope: string, text: string): void { this.#drafts.set(scope, text); }
  writeAttachments(scope: string, attachments: ComposerAttachment[]): void { this.#attachments.set(scope, structuredClone(attachments)); }
  writePreferences(scope: string, preferences: StoredComposerPreferences): void { this.#preferences.set(scope, preferences); }
}

export function CodeWideScreen() {
  const windowLayout = useWindowLayout();
  const insets = useSafeAreaInsets();
  const remote = useRemoteWorkspace();
  return <CodeWideWorkspaceScreen desktop={windowLayout.desktop} viewportWidth={windowLayout.width} insets={insets} remote={remote} />;
}

function CodeWideWorkspaceScreen({ desktop, viewportWidth, insets, remote }: { desktop: boolean; viewportWidth: number; insets: ReturnType<typeof useSafeAreaInsets>; remote: RemoteWorkspace }) {
  const accountRateLimitsQuery = useLiveQuery(
    () => remote.accountRateLimitsDatabase?.collection,
    [remote.accountRateLimitsDatabase],
  );
  const accountRateLimits = accountRateLimitsQuery.data ?? [];
  const dialog = useAppDialog();
  const reduceVoiceMotion = useReducedMotionPreference();
  const [testWorkspace] = useState(injectedTestWorkspace);
  const [injectedRemoteThread] = useState(() => injectedTestThread() ?? testWorkspace?.thread ?? null);
  const [demoServerState, setDemoServerState] = useState<DemoServer[]>(() => testWorkspace?.servers ?? []);
  const [demoThreadState, setDemoThreadState] = useState<DemoThread[]>(() => testWorkspace?.threads ?? []);
  const [connectionSheetVisible, setConnectionSheetVisible] = useState(false);
  const [pendingPairingCode, setPendingPairingCode] = useState<string | null>(null);
  const [newThreadVisible, setNewThreadVisible] = useState(false);
  const newThreadStartRef = useRef(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [mobileThreadQuery, setMobileThreadQuery] = useState("");
  const [mobileThreadOffset] = useState(() => new ScrollOffsetMemory());
  const [threadListMode, setThreadListMode] = useState<ThreadListMode>("active");
  const demoForkCounterRef = useRef(0);
  const [demoComposerMemory] = useState(() => new DemoComposerMemory());
  const demoScrollOffsetsRef = useRef(new Map<string, number>());
  const saveDemoDraft = async (serverId: string, threadId: string, text: string) => {
    demoComposerMemory.writeDraft(`${serverId}\u0000${threadId}`, text);
  };
  const saveDemoDraftAttachments = async (serverId: string, threadId: string, attachments: ComposerAttachment[]) => {
    demoComposerMemory.writeAttachments(`${serverId}\u0000${threadId}`, attachments);
  };
  const loadDemoScrollOffset = async (serverId: string, threadId: string) => demoScrollOffsetsRef.current.get(`${serverId}\u0000${threadId}`) ?? null;
  const saveDemoScrollOffset = async (serverId: string, threadId: string, offset: number) => {
    demoScrollOffsetsRef.current.set(`${serverId}\u0000${threadId}`, offset);
  };
  const saveDemoPreferences = async (serverId: string, threadId: string, preferences: StoredComposerPreferences) => {
    demoComposerMemory.writePreferences(`${serverId}\u0000${threadId}`, preferences);
  };
  const servers: DemoServer[] = remote.native
    ? [...remote.connections.map((server) => ({
        id: server.id,
        name: server.displayName,
        emoji: server.emoji,
        status: server.enabled ? server.state : "offline",
      }))]
    : demoServerState;
  const settingsConnections: StoredConnection[] = remote.native
    ? remote.connections
    : demoServerState.map((server, index) => ({
        id: server.id,
        displayName: server.name,
        emoji: server.emoji,
        endpoint: server.endpoint ?? `wss://${server.id}.example.test/v1/sync`,
        token: server.token ?? "d".repeat(43),
        ...(server.tlsPinSha256 === undefined ? {} : { tlsPinSha256: server.tlsPinSha256 }),
        enabled: server.status !== "offline",
        sortOrder: index,
        state: server.status,
        lastError: null,
        lastErrorAt: null,
      }));
  const threads: DemoThread[] = remote.native
    ? remote.threads.map(storedThreadToDemo)
    : demoThreadState;
  const [requestedServerId, setActiveServerId] = useState(remote.native ? (desktop ? "" : ALL_SERVERS_ID) : (desktop ? (testWorkspace?.servers[0]?.id ?? "") : ALL_SERVERS_ID));
  const activeServerId = servers.length === 0
    ? desktop ? "" : ALL_SERVERS_ID
    : !desktop && requestedServerId === ALL_SERVERS_ID
      ? ALL_SERVERS_ID
      : servers.some((server) => server.id === requestedServerId)
        ? requestedServerId
        : servers[0]?.id ?? "";
  const [threadSelection, setThreadSelection] = useState(() => ({
    id: desktop && !remote.native && testWorkspace?.threads[0] !== undefined ? threadSelectionKey(testWorkspace.threads[0]) : null as string | null,
    generation: 0,
  }));
  const requestedThreadId = threadSelection.id;
  const threadOpenGeneration = threadSelection.generation;
  const setActiveThreadId = (value: string | null, refreshIfSelected = false) => {
    if (value !== requestedThreadId) {
      // A focused search field or composer keeps the Android IME session alive
      // when the visible surface is replaced. End that session at the navigation
      // boundary so the newly selected conversation never inherits keyboard focus.
      KeyboardController.dismiss({ animated: false, keepFocus: false });
    }
    // Selection is immediate. A bounded atomic snapshot can render while the
    // authoritative server refresh runs; individual historical events are
    // never replayed into the visible conversation one by one.
    const startedAt = performance.now();
    setThreadSelection((current) => current.id === value
      ? refreshIfSelected
        ? { id: value, generation: current.generation + 1 }
        : current
      : { id: value, generation: current.generation + 1 });
    requestAnimationFrame(() => {
      const elapsed = performance.now() - startedAt;
      recordTiming("thread_selection_commit_ms", elapsed);
      if (__DEV__) console.log(`[CodeWide perf] thread_selection_commit_ms=${Math.round(elapsed)}`);
    });
  };
  const selectThread = (value: string) => setActiveThreadId(value, true);

  const scopedThreads = activeServerId === ALL_SERVERS_ID ? threads : threads.filter((thread) => thread.serverId === activeServerId);
  const serverThreads = scopedThreads.filter((thread) => !thread.archived);
  const archivedThreads = scopedThreads.filter((thread) => thread.archived);
  const normalizedMobileThreadQuery = mobileThreadQuery.trim().toLocaleLowerCase();
  const mobileSearchKey = `${activeServerId}\u0000${normalizedMobileThreadQuery}`;
  const mobileRemoteSearchResource = useAsyncResource<DemoThread[]>(
    remote.native ? "mobile-thread-search" : null,
    mobileSearchKey,
    async (_publish, signal) => {
      if (normalizedMobileThreadQuery === "") return [];
      await abortableDelay(60, signal);
      const results = await remote.searchThreads(
        mobileThreadQuery,
        activeServerId === ALL_SERVERS_ID ? null : activeServerId,
      );
      return results.map(storedThreadToDemo);
    },
  );
  const localMobileSearchMatches = normalizedMobileThreadQuery === "" ? [] : demoThreadState.filter((thread) =>
    (activeServerId === ALL_SERVERS_ID || activeServerId === thread.serverId)
      && `${thread.title}\n${thread.preview}`.toLocaleLowerCase().includes(normalizedMobileThreadQuery),
  );
  const mobileNativeSearch = normalizedMobileThreadQuery === ""
    ? null
    : remote.native
      ? mobileRemoteSearchResource.value ?? []
      : localMobileSearchMatches;
  const mobileVisibleThreads = mobileNativeSearch === null ? serverThreads : mobileNativeSearch.filter((thread) => !thread.archived);
  const mobileVisibleArchivedThreads = mobileNativeSearch === null ? archivedThreads : mobileNativeSearch.filter((thread) => thread.archived);
  const selectedThread = requestedThreadId === null
    ? null
    : scopedThreads.find((thread) => threadSelectionKey(thread) === requestedThreadId) ?? null;
  const pendingThreadSelection = requestedThreadId !== null
    && selectedThread === null;
  const activeThread = selectedThread ?? (desktop && !pendingThreadSelection ? (serverThreads[0] ?? null) : null);
  const activeThreadId = activeThread === null
    ? pendingThreadSelection ? requestedThreadId : null
    : threadSelectionKey(activeThread);
  const activeThreadKey = activeThread === null ? null : threadSelectionKey(activeThread);
  const activeThreadHydrationScope = activeThreadKey === null ? null : `${activeThreadKey}\u0001${threadOpenGeneration}`;
  const activeConnectionId = activeThread?.serverId ?? (activeServerId === ALL_SERVERS_ID ? "" : activeServerId);
  const activeAccountRateLimits = accountRateLimits.find((row) => row.connectionId === activeConnectionId) ?? null;
  const selectedServerAccountRateLimits = accountRateLimits.find((row) => row.connectionId === activeServerId) ?? null;
  const activeConnectionState = remote.connections.find((connection) => connection.id === activeConnectionId)?.state ?? "offline";
  const activeConnectionAvailable = activeConnectionState === "live" || activeConnectionState === "syncing";
  const activeRemoteThreadId = activeThread?.id ?? null;
  const nativePortForwardingSnapshot = useNativePortForwarding(
    remote.native ? activeConnectionId : "",
  );
  const nativePortForwardProfiles = nativePortForwardingSnapshot.profiles;
  const activeStoredThread = remote.threads.find((candidate) =>
    candidate.connectionId === activeConnectionId && candidate.remoteThreadId === activeRemoteThreadId,
  ) ?? null;
  const activeCwd = activeStoredThread?.cwd ?? "/workspace";
  const activeProjects = activeConnectionId === ""
    ? []
    : deriveThreadProjects(remote.threads, activeConnectionId);
  const activeEmptyProvisionalThread = activeStoredThread?.provisionalThread?.turns.length === 0;
  const activeThreadLoadResourceId = activeRemoteThreadId === null || activeConnectionId === ""
    ? null
    : threadLoadResourceKey(activeConnectionId, activeRemoteThreadId, threadOpenGeneration);
  const activeThreadLoadQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeThreadLoadResourceId === null
      ? undefined
      : query
          .from({ load: remote.resourceDatabase.threadLoads })
          .where(({ load }) => eq(load.id, activeThreadLoadResourceId)),
    [activeThreadLoadResourceId, remote.resourceDatabase],
  );
  const activeThreadLoadResource = activeThreadLoadQuery.data?.[0] ?? null;
  const putActiveThreadLoadState = (state: ThreadLoadState) => {
    if (remote.resourceDatabase === null || activeThreadLoadResourceId === null || activeRemoteThreadId === null || activeConnectionId === "") return;
    remote.resourceDatabase.putThreadLoad({
      id: activeThreadLoadResourceId,
      connectionId: activeConnectionId,
      threadId: activeRemoteThreadId,
      generation: threadOpenGeneration,
      ...state,
    });
  };
  const activeControlsResourceId = activeConnectionId === "" ? null : turnControlsResourceKey(activeConnectionId, activeCwd);
  const activeControlsQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeControlsResourceId === null
      ? undefined
      : query
          .from({ controls: remote.resourceDatabase.turnControls })
          .where(({ controls }) => eq(controls.id, activeControlsResourceId)),
    [activeControlsResourceId, remote.resourceDatabase],
  );
  const activeControlsResource = activeControlsQuery.data?.[0] ?? null;
  const activeThreadResourceId = activeConnectionId === "" || activeRemoteThreadId === null ? null : threadResourceKey(activeConnectionId, activeRemoteThreadId);
  const activeTerminalsQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeThreadResourceId === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.backgroundTerminals }).where(({ resource }) => eq(resource.id, activeThreadResourceId)),
    [activeThreadResourceId, remote.resourceDatabase],
  );
  const activeGoalQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeThreadResourceId === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.threadGoals }).where(({ resource }) => eq(resource.id, activeThreadResourceId)),
    [activeThreadResourceId, remote.resourceDatabase],
  );
  const activeThreadResourcesQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeThreadResourceId === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.threadResources }).where(({ resource }) => eq(resource.id, activeThreadResourceId)),
    [activeThreadResourceId, remote.resourceDatabase],
  );
  const activeTunnelResourceId = activeConnectionId === "" ? null : tunnelResourceKey(activeConnectionId);
  const activeTunnelQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeTunnelResourceId === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.tunnels }).where(({ resource }) => eq(resource.id, activeTunnelResourceId)),
    [activeTunnelResourceId, remote.resourceDatabase],
  );
  const activeTerminalsResource = activeTerminalsQuery.data?.[0] ?? null;
  const activeGoalResource = activeGoalQuery.data?.[0] ?? null;
  const activeThreadResources = activeThreadResourcesQuery.data?.[0] ?? null;
  const visibleThreadResources: ThreadResourcesRow | null = activeEmptyProvisionalThread && activeRemoteThreadId !== null
      ? {
          id: threadResourceKey(activeConnectionId, activeRemoteThreadId),
          connectionId: activeConnectionId,
          threadId: activeRemoteThreadId,
          status: "ready",
          value: { threadId: activeRemoteThreadId, revision: "empty", changes: [], attachments: [] },
          error: null,
          updatedAt: 0,
        }
      : activeThreadResources;
  const activeTunnelResource = activeTunnelQuery.data?.[0] ?? null;
  const activeVoiceScope = activeConnectionId === "" || activeRemoteThreadId === null ? null : `${activeConnectionId}\u0000${activeRemoteThreadId}`;
  const activeVoiceQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeVoiceScope === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.voiceInputs }).where(({ resource }) => eq(resource.id, activeVoiceScope)),
    [activeVoiceScope, remote.resourceDatabase],
  );
  const activeVoiceResource = activeVoiceQuery.data?.[0] ?? null;
  const activeReviewVoiceScope = activeVoiceScope === null ? null : `${activeVoiceScope}\u0000review`;
  const activeReviewVoiceQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeReviewVoiceScope === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.voiceInputs }).where(({ resource }) => eq(resource.id, activeReviewVoiceScope)),
    [activeReviewVoiceScope, remote.resourceDatabase],
  );
  const activeReviewVoiceResource = activeReviewVoiceQuery.data?.[0] ?? null;
  const voiceInputsQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.voiceInputs }),
    [remote.resourceDatabase],
  );
  const activeFileTransferQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeVoiceScope === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.fileTransfers }).where(({ resource }) => eq(resource.id, activeVoiceScope)),
    [activeVoiceScope, remote.resourceDatabase],
  );
  const activeFileTransferResource = activeFileTransferQuery.data?.[0] ?? null;
  const activeResidentOffset = activeThreadLoadResource?.residentOffset ?? 0;
  const activeSealedTurnQuery = useLiveQuery(
    (query) => remote.threadDetails === null || activeRemoteThreadId === null || activeConnectionId === ""
      ? undefined
      : query
          .from({ row: remote.threadDetails.collection })
          .where(({ row }) => and(
            eq(row.connectionId, activeConnectionId),
            eq(row.remoteThreadId, activeRemoteThreadId),
            eq(row.sealed, true),
            eq(row.kind, "turn"),
          ))
          .orderBy(({ row }) => row.ordinal, "desc")
          .limit(THREAD_RESIDENT_TURN_LIMIT)
          .offset(activeResidentOffset),
    [activeConnectionId, activeRemoteThreadId, activeResidentOffset, remote.threadDetails],
  );
  const residentOrdinalBounds = (() => {
    const rows = activeSealedTurnQuery.data ?? [];
    if (rows.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      min = Math.min(min, row.ordinal);
      max = Math.max(max, row.ordinal);
    }
    return { min, max };
  })();
  const activeSealedDetailQuery = useLiveQuery(
    (query) => remote.threadDetails === null || activeRemoteThreadId === null || activeConnectionId === "" || residentOrdinalBounds === null
      ? undefined
      : query
          .from({ row: remote.threadDetails.collection })
          .where(({ row }) => and(
            eq(row.connectionId, activeConnectionId),
            eq(row.remoteThreadId, activeRemoteThreadId),
            eq(row.sealed, true),
            or(eq(row.kind, "turnMeta"), eq(row.kind, "activity")),
            gte(row.ordinal, residentOrdinalBounds.min),
            lte(row.ordinal, residentOrdinalBounds.max),
          )),
    [activeConnectionId, activeRemoteThreadId, remote.threadDetails, residentOrdinalBounds?.max, residentOrdinalBounds?.min],
  );
  const activeLiveDetailQuery = useLiveQuery(
    (query) => remote.threadDetails === null || activeRemoteThreadId === null || activeConnectionId === ""
      ? undefined
      : query
          .from({ row: remote.threadDetails.collection })
          .where(({ row }) => and(
            eq(row.connectionId, activeConnectionId),
            eq(row.remoteThreadId, activeRemoteThreadId),
            eq(row.sealed, false),
          )),
    [activeConnectionId, activeRemoteThreadId, remote.threadDetails],
  );
  const activePendingTimeline = materializePendingTimeline(activeLiveDetailQuery.data ?? []);
  const activePendingDeliveries: Array<NativeCommandDelivery & { attachments: ComposerAttachment[] }> = activePendingTimeline
    .filter(({ presentation }) => presentation === "delivery")
    .map((entry) => ({
      connectionId: activeConnectionId,
      commandId: entry.commandId,
      method: entry.method,
      threadId: activeRemoteThreadId,
      targetCommandId: null,
      text: entry.text,
      attachments: entry.attachments,
      state: entry.state,
      attempts: entry.attempts,
      lastError: entry.lastError,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  const activeQueuedPrompts: QueuedPrompt[] = activePendingTimeline
    .filter(({ presentation, state }) => presentation === "queue" && state !== "delivered")
    .map(({ commandId, text, attachments, createdAt, state, lastError }) => ({
      commandId,
      text,
      attachments,
      createdAt,
      state: state === "uncertain" || state === "failed" ? state : "queued",
      lastError,
    }));
  const activeComposerStateQuery = useLiveQuery(
    (query) => remote.threadUiStateDatabase === null || activeRemoteThreadId === null || activeConnectionId === ""
      ? undefined
      : query
          .from({ state: remote.threadUiStateDatabase.collection })
          .where(({ state }) => and(
            eq(state.connectionId, activeConnectionId),
            eq(state.threadId, activeRemoteThreadId),
          )),
    [activeConnectionId, activeRemoteThreadId, remote.threadUiStateDatabase],
  );
  const activeComposerState = activeComposerStateQuery.data?.[0] ?? null;
  const activeSealedTurns = materializeThreadTurns([
      ...(activeSealedTurnQuery.data ?? []),
      ...(activeSealedDetailQuery.data ?? []),
    ]);
  const activeLiveSnapshot = (() => {
    if (remote.threadDetails === null || activeRemoteThreadId === null) return null;
    const snapshot = materializeThreadDetails(activeLiveDetailQuery.data ?? [], remote.threadDetails.sessionId)[0] ?? null;
    if (snapshot?.connectionId !== activeConnectionId || snapshot.thread.id !== activeRemoteThreadId) return null;
    return snapshot;
  })();
  const activeMergedTurns = activeLiveSnapshot === null
    ? []
    : mergeThreadPartitions(activeSealedTurns, activeLiveSnapshot.thread.turns);
  const activeLiveTurnIds = new Set(activeLiveSnapshot?.thread.turns.map(({ id }) => id) ?? []);
  const activeVisibleSealedTurns = activeMergedTurns.filter(({ id }) => !activeLiveTurnIds.has(id));
  const activeVisibleLiveTurns = activeMergedTurns.filter(({ id }) => activeLiveTurnIds.has(id));
  const activeRemoteSnapshot = (() => {
    if (activeLiveSnapshot === null) return null;
    return {
      ...activeLiveSnapshot,
      thread: {
        ...activeLiveSnapshot.thread,
        turns: activeMergedTurns,
      },
    };
  })();
  const activeTimelinePartitions = activeRemoteSnapshot === null || activeLiveSnapshot === null
    ? {}
    : { remoteSealedTurns: activeVisibleSealedTurns, remoteLiveTurns: activeVisibleLiveTurns };
  const remoteThread = !remote.native
    ? testWorkspace?.threads[0] !== undefined && activeThreadKey === threadSelectionKey(testWorkspace.threads[0]) ? injectedRemoteThread : null
    : activeRemoteSnapshot?.thread ?? activeStoredThread?.provisionalThread ?? null;
  // thread/start creates a real server thread before a rollout exists. Keep
  // treating that shell as provisional even after its seeded detail row is
  // visible; otherwise the hydration resource immediately calls
  // thread/resume and paints a false "not materialized" failure. The summary
  // projection clears provisionalThread on the first authoritative thread
  // event, which is the correct point to enable normal hydration.
  const activeProvisionalThread = activeStoredThread?.provisionalThread ?? null;
  const activeThreadLifecycleActive = isThreadLifecycleActive(activeThread?.state);
  const activeThreadLoadState: ThreadLoadState = !remote.native
    ? { phase: "ready", nextCursor: null, loadingOlder: false, residentOffset: 0, error: null }
    : activeThreadHydrationScope === null
      ? { phase: "ready", nextCursor: null, loadingOlder: false, residentOffset: 0, error: null }
      : activeThreadLoadResource ?? {
          phase: activeProvisionalThread !== null ? "ready" : remoteThread === null ? "loading" : activeRemoteSnapshot?.fresh === true || !activeConnectionAvailable ? "ready" : "refreshing",
          nextCursor: null,
          loadingOlder: false,
          residentOffset: 0,
          error: null,
        };
  const activePendingRequests = remote.pendingRequests.filter((request) =>
    request.connectionId === activeConnectionId && request.params.threadId === activeRemoteThreadId,
  );
  const activePendingRequest = activePendingRequests[0] ?? null;
  const remoteNative = remote.native;
  const readRemoteThread = remote.readThread;
  const reconcileRemoteThreadLifecycle = remote.reconcileThreadLifecycle;
  const receiveDeepLink = useEffectEvent((raw: string | null) => {
    if (raw === null) return;
    if (raw.startsWith("codewide://pair") || raw.startsWith("codexremote://pair")) {
      setPendingPairingCode(raw);
      setConnectionSheetVisible(true);
      return;
    }
    const parsed = parseThreadDeepLink(raw);
    if (parsed !== null) {
      setActiveServerId(parsed.connectionId);
      setActiveThreadId(threadSelectionKey({ serverId: parsed.connectionId, id: parsed.threadId }));
    }
  });

  useEffect(() => {
    void Linking.getInitialURL().then(receiveDeepLink);
    const subscription = Linking.addEventListener("url", ({ url }) => receiveDeepLink(url));
    return () => subscription.remove();
  }, []);

  const forkCurrentThread = async (options: ThreadForkOptions): Promise<void> => {
    if (activeThread === null || activeRemoteThreadId === null || activeConnectionId === "") throw new Error("No thread selected");
    if (remote.native) {
      const forkedId = await remote.forkThread(activeConnectionId, activeRemoteThreadId, options);
      const selectionKey = threadSelectionKey({ serverId: activeConnectionId, id: forkedId });
      setActiveThreadId(selectionKey);
      return;
    }
    demoForkCounterRef.current += 1;
    const forkedId = `${activeRemoteThreadId}-fork-${demoForkCounterRef.current}`;
    const scope = options.boundary.kind === "all" ? "all history" : `${options.boundary.kind} ${options.boundary.turnId}`;
    const { state: _sourceState, ...sourceWithoutState } = activeThread;
    const forked: DemoThread = {
      ...sourceWithoutState,
      id: forkedId,
      title: `${activeThread.title.replace(/\s+·\s+fork.*$/u, "")} · fork`,
      preview: `${options.ephemeral ? "Ephemeral" : "Durable"} fork · ${scope}`,
      pinned: false,
      unread: 0,
      time: "now",
    };
    setDemoThreadState((current) => [forked, ...current]);
    setActiveServerId(activeConnectionId);
    setActiveThreadId(threadSelectionKey(forked));
  };

  const activeHydrationTaskKey = !remoteNative
    || activeConnectionId === ""
    || activeRemoteThreadId === null
    || activeThreadKey === null
    || activeThreadHydrationScope === null
    || activeThreadId !== activeThreadKey
    || !activeConnectionAvailable
      ? null
      : `thread-hydration:${activeThreadLoadResourceId}:${activeStoredThread?.recencyAt ?? activeStoredThread?.updatedAt ?? 0}:${activeProvisionalThread === null ? "materialized" : "provisional"}`;
  const activeControlsTaskKey = !remoteNative
    || activeConnectionId === ""
    || activeRemoteThreadId === null
    || !activeConnectionAvailable
      ? null
      : `turn-controls:${activeConnectionId}:${activeCwd}`;
  useAsyncResource<TurnControls>(remoteNative ? "active-turn-controls" : null, activeControlsTaskKey ?? "inactive", async () => {
    if (activeControlsTaskKey === null) return EMPTY_TURN_CONTROLS;
    return await remote.loadTurnControls(activeConnectionId, activeCwd);
  });
  useAsyncResource<ThreadLoadState>(remoteNative ? "active-thread-hydration" : null, activeHydrationTaskKey ?? "inactive", async (_publish, signal) => {
    if (activeHydrationTaskKey === null) {
      return { phase: "ready", nextCursor: null, loadingOlder: false, residentOffset: 0, error: null };
    }
    const loadingState: ThreadLoadState = {
      phase: "loading",
      nextCursor: null,
      loadingOlder: false,
      residentOffset: 0,
      error: null,
    };
    putActiveThreadLoadState(loadingState);
    const openedAt = monotonicNowMs();
    // Never paint persisted history as if it were current: a cold open waits
    // for one authoritative bounded snapshot. Only this runtime's warm view
    // may stay visible while refreshing, so switching cannot replay stale
    // turns into the conversation one by one.
    const result = await readRemoteThread(activeConnectionId, activeRemoteThreadId as string, null).then(
      (window) => ({ window, cause: null }),
      (cause: unknown) => ({ window: null, cause }),
    );
    // Aborting is normal when the user switches threads. Return without
    // publishing another state; useAsyncResource drops aborted completions.
    if (signal.aborted) return loadingState;
    if (result.cause !== null) {
      // A freshly started thread can exist briefly before its rollout is
      // materialized. Keep that local shell usable, but still attempt the read:
      // old app versions could persist the same shell after the companion had
      // already acquired the complete conversation. Skipping hydration here
      // made those threads permanently empty.
      if (activeProvisionalThread !== null) {
        const state: ThreadLoadState = {
          phase: "ready",
          nextCursor: null,
          loadingOlder: false,
          residentOffset: 0,
          error: null,
        };
        putActiveThreadLoadState(state);
        return state;
      }
      const state: ThreadLoadState = {
        phase: "error",
        nextCursor: null,
        loadingOlder: false,
        residentOffset: 0,
        error: result.cause instanceof Error ? result.cause.message : "Could not load messages",
      };
      putActiveThreadLoadState(state);
      return state;
    }
    const window = result.window;
    if (window !== null) recordTiming("thread_fresh_visible_ms", monotonicNowMs() - openedAt);
    const state: ThreadLoadState = {
      phase: window === null ? "error" : "ready",
      nextCursor: window?.nextCursor ?? null,
      loadingOlder: false,
      residentOffset: 0,
      error: window === null ? "Could not load messages" : null,
    };
    putActiveThreadLoadState(state);
    return state;
  });

  const staleLifecycleTurnId = !remoteNative
    || activeConnectionId === ""
    || activeRemoteThreadId === null
    || activeThreadKey === null
    || !activeConnectionAvailable
    || activeThreadLifecycleActive
    || remoteThread === null
      ? null
      : activeTurnId(remoteThread);
  const lifecycleRepairTaskKey = staleLifecycleTurnId === null
    ? null
    : `thread-lifecycle-repair:${activeConnectionId}:${activeRemoteThreadId}:${staleLifecycleTurnId}`;
  useAsyncResource<boolean>(remoteNative ? "active-thread-lifecycle-repair" : null, lifecycleRepairTaskKey ?? "inactive", async () => {
    if (lifecycleRepairTaskKey === null) return false;
    // The summary already reached a terminal state while detail still says
    // in-progress. Reconcile from one authoritative snapshot; do not replay
    // terminal events or expose the stale detail state as typing/running.
    await reconcileRemoteThreadLifecycle(activeConnectionId, activeRemoteThreadId as string, staleLifecycleTurnId as string, remoteThread as Thread);
    return true;
  });

  const loadOlderTurns = async (): Promise<void> => {
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null || activeThreadKey === null || activeThreadHydrationScope === null) return;
    const state = activeThreadLoadResource;
    if (state?.nextCursor === null || state?.nextCursor === undefined || state.loadingOlder) return;
    putActiveThreadLoadState({ ...state, loadingOlder: true, error: null });
    try {
      const page = await remote.loadOlderTurns(activeConnectionId, activeRemoteThreadId, state.nextCursor);
      putActiveThreadLoadState({
        phase: "ready",
        nextCursor: page.nextCursor,
        loadingOlder: false,
        residentOffset: advanceResidentOffset(state.residentOffset, activeSealedTurns.length, page.turns.length),
        error: null,
      });
    } catch (cause) {
      putActiveThreadLoadState({ ...state, phase: "ready", loadingOlder: false, error: cause instanceof Error ? cause.message : "Could not load older messages" });
    }
  };

  const revealNewerTurns = async (): Promise<void> => {
    const state = activeThreadLoadResource;
    if (state === null || state.residentOffset === 0) return;
    putActiveThreadLoadState({
      ...state,
      residentOffset: retreatResidentOffset(state.residentOffset),
    });
  };

  const loadTurnItems = async (turnId: string): Promise<void> => {
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null || activeThreadKey === null) return;
    await remote.loadTurnItems(activeConnectionId, activeRemoteThreadId, turnId);
  };

  const markActiveThreadRead = () => {
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) return;
    void remote.markThreadRead(activeConnectionId, activeRemoteThreadId).catch(() => undefined);
  };

  const selectServer = (serverId: string) => {
    const first = threads.find((thread) => thread.serverId === serverId);
    // Server and thread selection are one atomic navigation action. Deferring
    // either half leaves the previous composer interactive for a frame and can
    // persist input under the wrong thread.
    setActiveServerId(serverId);
    setActiveThreadId(desktop && first !== undefined ? threadSelectionKey(first) : null);
  };

  const openConnectionSheet = () => setConnectionSheetVisible(true);

  const saveConnection = async (input: ConnectionInput): Promise<void> => {
    if (remote.native) {
      const added = await remote.addConnection(input);
      setActiveServerId(added.id);
      setActiveThreadId(null);
      return;
    }
    const index = demoServerState.length + 1;
    const server: DemoServer = {
      id: `server-${index}`,
      name: input.displayName.trim(),
      emoji: input.emoji.trim(),
      status: "syncing",
      endpoint: input.endpoint,
      token: input.token,
      ...(input.tlsPinSha256 === undefined ? {} : { tlsPinSha256: input.tlsPinSha256 }),
    };
    setDemoServerState((current) => [...current, server]);
    selectServer(server.id);
  };

  const toggleConnection = async (connectionId: string, enabled: boolean): Promise<void> => {
    if (remote.native) return await remote.setConnectionEnabled(connectionId, enabled);
    setDemoServerState((current) => current.map((server) => server.id === connectionId ? { ...server, status: enabled ? "connecting" : "offline" } : server));
  };

  const reconnectSavedConnection = async (connectionId: string): Promise<void> => {
    if (remote.native) return await remote.reconnectConnection(connectionId);
    setDemoServerState((current) => current.map((server) => server.id === connectionId ? { ...server, status: "live" } : server));
  };

  const deleteSavedConnection = async (connectionId: string): Promise<void> => {
    if (remote.native) return await remote.deleteConnection(connectionId);
    setDemoServerState((current) => current.filter((server) => server.id !== connectionId));
    setDemoThreadState((current) => current.filter((thread) => thread.serverId !== connectionId));
  };

  const updateSavedConnection = async (connectionId: string, input: ConnectionUpdateInput): Promise<void> => {
    const current = settingsConnections.find((connection) => connection.id === connectionId);
    if (current === undefined) throw new Error("Connection not found");
    if (remote.native) {
      if (isProfileOnlyConnectionUpdate(input, current)) {
        const profile = validateConnectionProfile(input.displayName, input.emoji);
        return await remote.updateConnectionProfile(connectionId, profile.displayName, profile.emoji);
      }
      return await remote.updateConnection(connectionId, input);
    }
    const validated = validateConnectionUpdateInput(input, current.token);
    setDemoServerState((serversState) => serversState.map((server) => {
      if (server.id !== connectionId) return server;
      const { tlsPinSha256: _oldPin, ...serverWithoutPin } = server;
      return {
        ...serverWithoutPin,
        name: validated.displayName,
        emoji: validated.emoji,
        endpoint: validated.endpoint,
        token: validated.token,
        ...(validated.tlsPinSha256 === undefined ? {} : { tlsPinSha256: validated.tlsPinSha256 }),
      };
    }));
  };

  const moveSavedConnection = async (connectionId: string, direction: -1 | 1): Promise<void> => {
    if (remote.native) return await remote.moveConnection(connectionId, direction);
    setDemoServerState((current) => moveItem(current, connectionId, direction));
  };

  const defaultProjectCwd = (serverId: string): string | null => deriveThreadProjects(remote.threads, serverId)[0]?.cwd ?? null;

  const createThread = (): void => {
    if (servers.length === 0) {
      openConnectionSheet();
      return;
    }
    if (activeServerId === ALL_SERVERS_ID || activeServerId === "") {
      setNewThreadVisible(true);
      return;
    }
    void startNewThread(activeServerId, defaultProjectCwd(activeServerId)).catch((cause) => {
      dialog.alert("Could not create chat", cause instanceof Error ? cause.message : "Thread creation failed");
    });
  };

  const startNewThread = async (requestedServerId: string, cwd: string | null): Promise<void> => {
    if (requestedServerId === "" || newThreadStartRef.current) return;
    newThreadStartRef.current = true;
    const operation = (async () => {
      if (remote.native) {
        const threadId = await remote.startThread(requestedServerId, cwd ?? undefined);
        const selectionKey = threadSelectionKey({ id: threadId, serverId: requestedServerId });
        setActiveServerId(requestedServerId);
        setActiveThreadId(selectionKey);
        return;
      }
      const id = `new-${Date.now()}`;
      setDemoThreadState((current) => [{
        id,
        serverId: requestedServerId,
        title: "New Codex thread",
        preview: "Ready for your first message.",
        time: "now",
        pinned: false,
        unread: 0,
      }, ...current]);
      setActiveServerId(requestedServerId);
      setActiveThreadId(threadSelectionKey({ id, serverId: requestedServerId }));
    })();
    await operation.then(
      () => { newThreadStartRef.current = false; },
      (cause: unknown) => {
        newThreadStartRef.current = false;
        throw cause;
      },
    );
  };

  const changeEmptyThreadProject = async (cwd: string | null): Promise<void> => {
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) return;
    if ((remoteThread?.turns.length ?? 0) > 0 || activePendingDeliveries.length > 0) {
      throw new Error("Project can only be changed before the first message");
    }
    if ((cwd ?? null) === (activeStoredThread?.cwd || null)) return;
    const previousThreadId = activeRemoteThreadId;
    const nextThreadId = await remote.startThread(activeConnectionId, cwd ?? undefined);
    setActiveServerId(activeConnectionId);
    setActiveThreadId(threadSelectionKey({ id: nextThreadId, serverId: activeConnectionId }));
    await remote.deleteThread(activeConnectionId, previousThreadId);
  };

  const createRepairThread = async (title: string, prompt: string): Promise<void> => {
    if (activeConnectionId === "") throw new Error("No server selected");
    if (remote.native) {
      const currentCwd = remote.threads.find((candidate) => candidate.connectionId === activeConnectionId && candidate.remoteThreadId === activeRemoteThreadId)?.cwd;
      const threadId = await remote.startThread(activeConnectionId, currentCwd);
      await remote.renameThread(activeConnectionId, threadId, title);
      await remote.sendText(activeConnectionId, threadId, prompt, { type: "start" });
      const selectionKey = threadSelectionKey({ serverId: activeConnectionId, id: threadId });
      setActiveServerId(activeConnectionId);
      setActiveThreadId(selectionKey);
      return;
    }
    const id = `fix-renderer-${Date.now()}`;
    const fixThread: DemoThread = {
      id,
      serverId: activeConnectionId,
      title,
      preview: "Renderer fix prompt is ready.",
      time: "now",
      pinned: false,
      unread: 0,
    };
    demoComposerMemory.writeDraft(`${activeConnectionId}\u0000${id}`, prompt);
    setDemoThreadState((current) => [fixThread, ...current]);
    setActiveServerId(activeConnectionId);
    setActiveThreadId(threadSelectionKey(fixThread));
  };

  const createUnsupportedFixThread = async (block: RenderBlock): Promise<void> => {
    const rawType = typeof block.raw.type === "string" ? block.raw.type : block.kind;
    const raw = JSON.stringify(block.raw, null, 2) ?? "{}";
    const prompt = [
      `Implement support for the Codex protocol block \`${rawType}\` in this remote client.`,
      "Inspect the renderer registry, add a compact safe renderer, preserve unknown-field compatibility, and add regression tests.",
      "Raw block:",
      "```json",
      raw.slice(0, 12_000),
      "```",
    ].join("\n\n");
    await createRepairThread(`Support ${rawType}`, prompt);
  };

  const createRenderFailureFixThread = async (failure: RecoverableRenderFailure): Promise<void> => {
    const threadContext = activeRemoteThreadId === null
      ? "No thread selected"
      : `Connection: ${activeConnectionId}\nThread: ${activeRemoteThreadId}\nCWD: ${activeCwd}`;
    await createRepairThread(
      `Fix ${failure.label}`.slice(0, 80),
      renderRecoveryPrompt({
        ...failure,
        context: [threadContext, failure.context].filter((value): value is string => value !== undefined && value !== "").join("\n"),
      }),
    );
  };

  const toggleListThreadPin = async (thread: DemoThread): Promise<void> => {
    if (remote.native) await remote.setThreadPinned(thread.serverId, thread.id, !thread.pinned);
    else setDemoThreadState((current) => current.map((candidate) =>
      threadSelectionKey(candidate) === threadSelectionKey(thread) ? { ...candidate, pinned: !candidate.pinned } : candidate,
    ));
  };

  const archiveListThread = async (thread: DemoThread): Promise<void> => {
    if (remote.native) await remote.archiveThread(thread.serverId, thread.id);
    else setDemoThreadState((current) => current.map((candidate) =>
      threadSelectionKey(candidate) === threadSelectionKey(thread) ? { ...candidate, archived: true } : candidate,
    ));
    if (activeThreadId === threadSelectionKey(thread)) setActiveThreadId(null);
  };

  const unarchiveListThread = async (thread: DemoThread): Promise<void> => {
    if (remote.native) await remote.unarchiveThread(thread.serverId, thread.id);
    else setDemoThreadState((current) => current.map((candidate) =>
      threadSelectionKey(candidate) === threadSelectionKey(thread) ? { ...candidate, archived: false } : candidate,
    ));
    if (activeThreadId === threadSelectionKey(thread)) setActiveThreadId(null);
  };

  const markListThreadRead = async (thread: DemoThread): Promise<void> => {
    if (remote.native) await remote.markThreadRead(thread.serverId, thread.id);
    else setDemoThreadState((current) => current.map((candidate) =>
      threadSelectionKey(candidate) === threadSelectionKey(thread) ? { ...candidate, unread: 0 } : candidate,
    ));
  };

  const useLocalConversationState = !remote.native;
  const activeDemoComposerKey = `${activeConnectionId}\u0000${activeRemoteThreadId ?? "none"}`;
  const activeDemoComposer = demoComposerMemory.read(activeDemoComposerKey);
  const conversationActions = remote.native && activeRemoteThreadId !== null
      ? {
          onSend: async (text: string, mode: SendMode, options: TurnSendOptions) => await remote.sendText(activeConnectionId, activeRemoteThreadId, text, mode, options),
          onRetryFailedMessage: async (commandId: string) => await remote.retryFailedMessage(activeConnectionId, commandId),
          onLoadControls: async (cwd: string) => await remote.loadTurnControls(activeConnectionId, cwd),
          onUpdateSettings: async (settings: ThreadSettings) => { await remote.updateThreadSettings(activeConnectionId, activeRemoteThreadId, settings); },
          onInterrupt: async (turnId: string) => { await remote.interruptTurn(activeConnectionId, activeRemoteThreadId, turnId); },
          onListQueue: async () => await remote.listQueuedPrompts(activeConnectionId, activeRemoteThreadId),
          onEditQueued: async (commandId: string, text: string, attachments: ComposerAttachment[]) => { await remote.editQueuedPrompt(activeConnectionId, commandId, text, attachments); },
          onCancelQueued: async (commandId: string) => { await remote.cancelQueuedPrompt(activeConnectionId, commandId); },
          onMoveQueued: async (commandId: string, direction: -1 | 1) => { await remote.moveQueuedPrompt(activeConnectionId, activeRemoteThreadId, commandId, direction); },
          onSteerQueued: async (commandId: string, expectedTurnId: string) => { await remote.steerQueuedPrompt(activeConnectionId, commandId, expectedTurnId); },
          onListTerminals: async () => await remote.listBackgroundTerminals(activeConnectionId, activeRemoteThreadId),
          onLoadThreadResources: async () => await remote.loadThreadResources(activeConnectionId, activeRemoteThreadId),
          onLoadThreadChangeDiff: async (path: string) => await remote.loadThreadChangeDiff(activeConnectionId, activeRemoteThreadId, path),
          onTerminateTerminal: async (processId: string) => await remote.terminateBackgroundTerminal(activeConnectionId, activeRemoteThreadId, processId),
          onGetGoal: async () => await remote.getThreadGoal(activeConnectionId, activeRemoteThreadId),
          onSetGoal: async (input: ThreadGoalInput) => await remote.setThreadGoal(activeConnectionId, activeRemoteThreadId, input),
          onClearGoal: async () => await remote.clearThreadGoal(activeConnectionId, activeRemoteThreadId),
          onStartReview: async (target: ReviewTarget, delivery: ReviewDelivery) => await remote.startReview(activeConnectionId, activeRemoteThreadId, target, delivery),
          onCompact: async () => await remote.compactThread(activeConnectionId, activeRemoteThreadId),
          onCreateTunnel: async (port: number, ttlSeconds: number) => await remote.createLocalhostTunnel(activeConnectionId, port, ttlSeconds),
          onRevokeTunnel: async (tunnelId: string) => { await remote.revokeLocalhostTunnel(activeConnectionId, tunnelId); },
          onRespondToRequest: remote.respondToServerRequest,
          getTransferAccess: async (forceRefresh = false) => await remote.transferAccess(activeConnectionId, forceRefresh),
          onStartVoiceTranscription: async (listener: (event: VoiceTranscriptionEvent) => void, options?: VoiceTranscriptionOptions) => await remote.startVoiceTranscription(activeConnectionId, activeRemoteThreadId, listener, options),
        }
      : {};

  const nativePortForwarding: PortForwardingManagerProps | undefined = remote.native && activeConnectionId !== "" ? {
    serverName: servers.find((server) => server.id === activeConnectionId)?.name ?? "Server",
    profiles: nativePortForwardProfiles,
    discoveredPorts: nativePortForwardingSnapshot.discoveredPorts,
    discoveryStatus: nativePortForwardingSnapshot.discoveryStatus,
    discoveryError: nativePortForwardingSnapshot.discoveryError,
    onRefresh: async () => await nativePortForwardingStore.refreshDiscovery(activeConnectionId),
    onSelectPort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId: activeConnectionId,
        profileId: createNativePortForwardId(),
        label: candidate.name,
        remotePort: candidate.port,
        preferredLocalPort: null,
        startImmediately: true,
      });
    },
    onAdd: async (input) => {
      await nativePortForwardingStore.upsert({
        connectionId: activeConnectionId,
        profileId: createNativePortForwardId(),
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: input.preferredLocalPort,
        startImmediately: input.startImmediately,
      });
    },
    onEdit: async (profileId, input) => {
      await nativePortForwardingStore.upsert({
        connectionId: activeConnectionId,
        profileId,
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: input.preferredLocalPort,
        startImmediately: input.startImmediately,
      });
    },
    onStart: async (profileId) => { await nativePortForwardingStore.start(activeConnectionId, profileId); },
    onStop: async (profileId) => await nativePortForwardingStore.stop(activeConnectionId, profileId),
    onReconnect: async (profileId) => await nativePortForwardingStore.reconnect(activeConnectionId, profileId),
    onRemove: async (profileId) => await nativePortForwardingStore.remove(activeConnectionId, profileId),
    onOpen: (profileId) => {
      const previewUrl = nativePortForwardProfiles.find((profile) => profile.id === profileId)?.previewUrl;
      if (previewUrl === null || previewUrl === undefined) return;
      void Linking.openURL(previewUrl).catch((cause: unknown) => {
        dialog.alert("Could not open forwarded port", cause instanceof Error ? cause.message : "The local URL could not be opened.");
      });
    },
  } : undefined;
  const activePortForwarding = nativePortForwarding;
  // The stop action switches the controller to `finishing` synchronously.
  // Keep the aura tied to live capture so it starts disappearing on that tap,
  // instead of lingering for the full transcription request.
  const voiceAuraResource = voiceInputsQuery.data?.find((resource) => resource?.phase === "recording") ?? null;
  const voiceAuraPhase = voiceAuraResource === null ? "idle" : "recording";
  const voiceInputRuntime: AppVoiceInputRuntime = {
    controller: remote.voiceController,
    resources: remote.resourceDatabase,
    scopePrefix: `${activeConnectionId || "local"}\u0000${activeRemoteThreadId ?? "workspace"}`,
    thread: remoteThread ?? null,
    ...(remote.native && activeConnectionId !== ""
      ? {
          startRemote: async (listener, options) => await remote.startVoiceTranscription(
            activeConnectionId,
            activeRemoteThreadId ?? "",
            listener,
            options,
          ),
        }
      : {}),
  };
  const openActiveLoopbackLink = remote.native && activeConnectionId !== ""
    ? async (target: LoopbackLinkTarget) => {
        const profile = await nativePortForwardingStore.ensureStarted({
          connectionId: activeConnectionId,
          remotePort: target.remotePort,
          label: `localhost:${target.remotePort}`,
        });
        await Linking.openURL(forwardedLoopbackUrl(target, profile));
      }
    : undefined;

  if (!desktop) {
    return (
      <RenderRecoveryProvider onFix={createRenderFailureFixThread}>
      <AppVoiceInputProvider runtime={voiceInputRuntime}>
      <VoiceAura phase={voiceAuraPhase} controller={remote.voiceController} scope={voiceAuraResource?.scope ?? null} reducedMotion={reduceVoiceMotion}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}> 
        {activeThreadId === null ? (
          <MobileThreads
            servers={servers}
            activeServerId={activeServerId}
            threads={mobileVisibleThreads}
            archivedThreads={mobileVisibleArchivedThreads}
            mode={threadListMode}
            query={mobileThreadQuery}
            onQueryChange={setMobileThreadQuery}
            onModeChange={setThreadListMode}
            initialOffset={mobileThreadOffset.read()}
            onOffsetChange={(offset) => mobileThreadOffset.write(offset)}
            onSelectThread={selectThread}
            onSelectServer={selectServer}
            onAddServer={openConnectionSheet}
            onNewThread={() => void createThread()}
            onTogglePin={toggleListThreadPin}
            onArchive={archiveListThread}
            onUnarchive={unarchiveListThread}
            onMarkRead={markListThreadRead}
            onSettings={() => setSettingsVisible(true)}
            accountRateLimits={selectedServerAccountRateLimits}
            {...(activeServerId === ALL_SERVERS_ID ? {} : {
              onRefreshAccountRateLimits: async () => await remote.refreshAccountRateLimits(activeServerId),
            })}
          />
        ) : (
          <RecoverableRenderBoundary
            scope="surface"
            label="Conversation"
            context={`Connection: ${activeConnectionId}\nThread: ${activeRemoteThreadId ?? "none"}`}
            resetKey={`${activeConnectionId}:${activeRemoteThreadId ?? "none"}`}
            onDismiss={() => setActiveThreadId(null)}
          >
          <ConversationPane
            thread={activeThread}
            server={servers.find((server) => server.id === activeConnectionId)}
            demo={useLocalConversationState}
            demoComposer={activeDemoComposer}
            demoControls={testWorkspace?.controls ?? null}
            onBack={() => setActiveThreadId(null)}
            compact
            remoteThread={remoteThread}
            accountRateLimits={activeAccountRateLimits}
            {...(activeConnectionId === "" ? {} : {
              onRefreshAccountRateLimits: async () => await remote.refreshAccountRateLimits(activeConnectionId),
            })}
            {...activeTimelinePartitions}
            loadState={activeThreadLoadState}
            onLoadOlder={loadOlderTurns}
            onRevealNewer={revealNewerTurns}
            onLoadTurnItems={loadTurnItems}
            pendingDeliveries={useLocalConversationState ? [] : activePendingDeliveries}
            queuedPrompts={useLocalConversationState ? [] : activeQueuedPrompts}
            composerState={useLocalConversationState ? null : activeComposerState}
            controlsResource={useLocalConversationState ? null : activeControlsResource}
            terminalsResource={useLocalConversationState ? null : activeTerminalsResource}
            threadResources={useLocalConversationState ? null : visibleThreadResources}
            goalResource={useLocalConversationState ? null : activeGoalResource}
            tunnelResource={useLocalConversationState ? null : activeTunnelResource}
            {...(activePortForwarding === undefined ? {} : { portForwarding: activePortForwarding })}
            {...(openActiveLoopbackLink === undefined ? {} : { onOpenLoopbackLink: openActiveLoopbackLink })}
            voiceResource={useLocalConversationState ? null : activeVoiceResource}
            reviewVoiceResource={useLocalConversationState ? null : activeReviewVoiceResource}
            voiceController={useLocalConversationState ? null : remote.voiceController}
            fileTransferResource={useLocalConversationState ? null : activeFileTransferResource}
            fileTransferController={useLocalConversationState ? null : remote.fileTransferController}
            subagents={useLocalConversationState ? [] : remote.subagents}
            subagentSummaryDatabase={useLocalConversationState ? null : remote.threadSummaryDatabase}
            subagentThreadDetails={useLocalConversationState ? null : remote.threadDetails}
            {...(useLocalConversationState ? {} : {
              onReadSubagentThread: remote.readSubagentThread,
              onRefreshSubagents: async (rootThreadId: string) => await remote.refreshSubagents(activeConnectionId, rootThreadId),
            })}
            {...(useLocalConversationState ? {} : { loadDraft: remote.loadDraft })}
            saveDraft={useLocalConversationState ? saveDemoDraft : remote.saveDraft}
            saveDraftAttachments={useLocalConversationState ? saveDemoDraftAttachments : remote.saveDraftAttachments}
            loadScrollOffset={useLocalConversationState ? loadDemoScrollOffset : remote.loadScrollOffset}
            saveScrollOffset={useLocalConversationState ? saveDemoScrollOffset : remote.saveScrollOffset}
            saveComposerPreferences={useLocalConversationState ? saveDemoPreferences : remote.saveComposerPreferences}
            pendingRequest={activePendingRequest}
            pendingRequestCount={activePendingRequests.length}
            pinned={activeThread?.pinned ?? false}
            unread={activeThread?.unread ?? 0}
            onViewedLatest={markActiveThreadRead}
            cwd={activeCwd}
            projects={activeProjects}
            onChangeProject={changeEmptyThreadProject}
            onRename={async (name) => {
              if (remote.native && activeRemoteThreadId !== null) await remote.renameThread(activeConnectionId, activeRemoteThreadId, name);
              else if (activeRemoteThreadId !== null) setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, title: name } : candidate));
            }}
            onArchive={async () => {
              if (remote.native && activeRemoteThreadId !== null) await remote.archiveThread(activeConnectionId, activeRemoteThreadId);
              else if (activeThreadId !== null) setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, archived: true } : candidate));
              setActiveThreadId(null);
            }}
            onUnarchive={async () => {
              if (remote.native && activeRemoteThreadId !== null) await remote.unarchiveThread(activeConnectionId, activeRemoteThreadId);
              else if (activeThreadId !== null) setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, archived: false } : candidate));
              setThreadListMode("active");
              setActiveThreadId(null);
            }}
            archived={activeThread?.archived ?? false}
            onDelete={async () => {
              if (remote.native && activeRemoteThreadId !== null) await remote.deleteThread(activeConnectionId, activeRemoteThreadId);
              else if (activeThreadId !== null) setDemoThreadState((current) => current.filter((candidate) => threadSelectionKey(candidate) !== activeThreadId));
              setActiveThreadId(null);
            }}
            onFork={forkCurrentThread}
            onFixUnsupportedBlock={createUnsupportedFixThread}
            onTogglePin={async () => {
              if (activeRemoteThreadId === null || activeThreadId === null) return;
              if (remote.native) await remote.setThreadPinned(activeConnectionId, activeRemoteThreadId, !(activeThread?.pinned ?? false));
              else setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, pinned: !candidate.pinned } : candidate));
            }}
            {...conversationActions}
          />
          </RecoverableRenderBoundary>
        )}
        <ConnectionSheet
          visible={connectionSheetVisible}
          localReady={remote.ready && remote.error === null}
          localError={remote.error}
          onRetryStartup={remote.retryStartup}
          onClose={() => {
            setConnectionSheetVisible(false);
            setPendingPairingCode(null);
          }}
          onSave={saveConnection}
          initialCode={pendingPairingCode}
        />
        <ConnectionSettings
          visible={settingsVisible}
          connections={settingsConnections}
          onClose={() => setSettingsVisible(false)}
          onToggle={toggleConnection}
          onReconnect={reconnectSavedConnection}
          onDelete={deleteSavedConnection}
          onUpdate={updateSavedConnection}
          onMove={moveSavedConnection}
          accountRateLimits={accountRateLimits}
          {...(!remote.native ? {} : {
            onRefreshAccountPool: remote.refreshAccountPool,
            onStartAccountLogin: remote.startAccountLogin,
            onCancelAccountLogin: remote.cancelAccountLogin,
            onActivateAccountProfile: remote.activateAccountProfile,
            onUpdateAccountProfile: remote.updateAccountProfile,
            onRemoveAccountProfile: remote.removeAccountProfile,
          })}
        />
        <NewThreadServerSheet
          visible={newThreadVisible}
          servers={servers}
          onClose={() => setNewThreadVisible(false)}
          onSelect={async (serverId) => await startNewThread(serverId, defaultProjectCwd(serverId))}
        />
      </View>
      </VoiceAura>
      </AppVoiceInputProvider>
      </RenderRecoveryProvider>
    );
  }

  return (
    <RenderRecoveryProvider onFix={createRenderFailureFixThread}>
    <AppVoiceInputProvider runtime={voiceInputRuntime}>
    <VoiceAura phase={voiceAuraPhase} controller={remote.voiceController} scope={voiceAuraResource?.scope ?? null} reducedMotion={reduceVoiceMotion}>
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}> 
      <View style={styles.desktopWorkspace}>
        <ServerRail
          servers={servers}
          activeServerId={activeServerId}
          onSelect={selectServer}
          onAdd={openConnectionSheet}
          onSettings={() => setSettingsVisible(true)}
        />
        <ThreadSidebar
          width={Math.max(280, Math.min(480, Math.floor(viewportWidth * 0.32)))}
          server={servers.find((server) => server.id === activeServerId)}
          threads={serverThreads}
          archivedThreads={archivedThreads}
          mode={threadListMode}
          activeThreadId={activeThread === null ? null : threadSelectionKey(activeThread)}
          onModeChange={setThreadListMode}
          onSelect={selectThread}
          onNewThread={() => void createThread()}
          onTogglePin={toggleListThreadPin}
          onArchive={archiveListThread}
          onUnarchive={unarchiveListThread}
          onMarkRead={markListThreadRead}
          accountRateLimits={selectedServerAccountRateLimits}
          {...(activeServerId === "" ? {} : {
            onRefreshAccountRateLimits: async () => await remote.refreshAccountRateLimits(activeServerId),
          })}
        />
        <RecoverableRenderBoundary
          scope="surface"
          label="Conversation"
          context={`Connection: ${activeConnectionId}\nThread: ${activeRemoteThreadId ?? "none"}`}
          resetKey={`${activeConnectionId}:${activeRemoteThreadId ?? "none"}`}
          onDismiss={() => setActiveThreadId(null)}
        >
        <ConversationPane
          thread={activeThread}
          server={servers.find((server) => server.id === activeConnectionId)}
          demo={useLocalConversationState}
          demoComposer={activeDemoComposer}
          demoControls={testWorkspace?.controls ?? null}
          remoteThread={remoteThread}
          accountRateLimits={activeAccountRateLimits}
          {...(activeConnectionId === "" ? {} : {
            onRefreshAccountRateLimits: async () => await remote.refreshAccountRateLimits(activeConnectionId),
          })}
          {...activeTimelinePartitions}
          loadState={activeThreadLoadState}
          onLoadOlder={loadOlderTurns}
          onRevealNewer={revealNewerTurns}
          onLoadTurnItems={loadTurnItems}
          pendingDeliveries={useLocalConversationState ? [] : activePendingDeliveries}
          queuedPrompts={useLocalConversationState ? [] : activeQueuedPrompts}
          composerState={useLocalConversationState ? null : activeComposerState}
          controlsResource={useLocalConversationState ? null : activeControlsResource}
          terminalsResource={useLocalConversationState ? null : activeTerminalsResource}
          threadResources={useLocalConversationState ? null : visibleThreadResources}
          goalResource={useLocalConversationState ? null : activeGoalResource}
          tunnelResource={useLocalConversationState ? null : activeTunnelResource}
          {...(activePortForwarding === undefined ? {} : { portForwarding: activePortForwarding })}
          {...(openActiveLoopbackLink === undefined ? {} : { onOpenLoopbackLink: openActiveLoopbackLink })}
          voiceResource={useLocalConversationState ? null : activeVoiceResource}
          reviewVoiceResource={useLocalConversationState ? null : activeReviewVoiceResource}
          voiceController={useLocalConversationState ? null : remote.voiceController}
          fileTransferResource={useLocalConversationState ? null : activeFileTransferResource}
          fileTransferController={useLocalConversationState ? null : remote.fileTransferController}
          subagents={useLocalConversationState ? [] : remote.subagents}
          subagentSummaryDatabase={useLocalConversationState ? null : remote.threadSummaryDatabase}
          subagentThreadDetails={useLocalConversationState ? null : remote.threadDetails}
          {...(useLocalConversationState ? {} : {
            onReadSubagentThread: remote.readSubagentThread,
            onRefreshSubagents: async (rootThreadId: string) => await remote.refreshSubagents(activeConnectionId, rootThreadId),
          })}
          {...(useLocalConversationState ? {} : { loadDraft: remote.loadDraft })}
          saveDraft={useLocalConversationState ? saveDemoDraft : remote.saveDraft}
          saveDraftAttachments={useLocalConversationState ? saveDemoDraftAttachments : remote.saveDraftAttachments}
          loadScrollOffset={useLocalConversationState ? loadDemoScrollOffset : remote.loadScrollOffset}
          saveScrollOffset={useLocalConversationState ? saveDemoScrollOffset : remote.saveScrollOffset}
          saveComposerPreferences={useLocalConversationState ? saveDemoPreferences : remote.saveComposerPreferences}
          pendingRequest={activePendingRequest}
          pendingRequestCount={activePendingRequests.length}
          pinned={activeThread?.pinned ?? false}
          unread={activeThread?.unread ?? 0}
          onViewedLatest={markActiveThreadRead}
          cwd={activeCwd}
          projects={activeProjects}
          onChangeProject={changeEmptyThreadProject}
          onRename={async (name) => {
            if (remote.native && activeRemoteThreadId !== null) await remote.renameThread(activeConnectionId, activeRemoteThreadId, name);
            else if (activeThreadId !== null) setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, title: name } : candidate));
          }}
          onArchive={async () => {
            if (remote.native && activeRemoteThreadId !== null) await remote.archiveThread(activeConnectionId, activeRemoteThreadId);
            else if (activeThreadId !== null) setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, archived: true } : candidate));
            setActiveThreadId(null);
          }}
          onUnarchive={async () => {
            if (remote.native && activeRemoteThreadId !== null) await remote.unarchiveThread(activeConnectionId, activeRemoteThreadId);
            else if (activeThreadId !== null) setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, archived: false } : candidate));
            setThreadListMode("active");
            setActiveThreadId(null);
          }}
          archived={activeThread?.archived ?? false}
          onDelete={async () => {
            if (remote.native && activeRemoteThreadId !== null) await remote.deleteThread(activeConnectionId, activeRemoteThreadId);
            else if (activeThreadId !== null) setDemoThreadState((current) => current.filter((candidate) => threadSelectionKey(candidate) !== activeThreadId));
            setActiveThreadId(null);
          }}
          onFork={forkCurrentThread}
          onFixUnsupportedBlock={createUnsupportedFixThread}
          onTogglePin={async () => {
            if (activeRemoteThreadId === null || activeThreadId === null) return;
            if (remote.native) await remote.setThreadPinned(activeConnectionId, activeRemoteThreadId, !(activeThread?.pinned ?? false));
            else setDemoThreadState((current) => current.map((candidate) => threadSelectionKey(candidate) === activeThreadId ? { ...candidate, pinned: !candidate.pinned } : candidate));
          }}
          {...conversationActions}
        />
        </RecoverableRenderBoundary>
      </View>
      <ConnectionSheet
        visible={connectionSheetVisible}
        localReady={remote.ready && remote.error === null}
        localError={remote.error}
        onRetryStartup={remote.retryStartup}
        onClose={() => {
          setConnectionSheetVisible(false);
          setPendingPairingCode(null);
        }}
        onSave={saveConnection}
        initialCode={pendingPairingCode}
      />
      <ConnectionSettings
        visible={settingsVisible}
        connections={settingsConnections}
        onClose={() => setSettingsVisible(false)}
        onToggle={toggleConnection}
        onReconnect={reconnectSavedConnection}
        onDelete={deleteSavedConnection}
        onUpdate={updateSavedConnection}
        onMove={moveSavedConnection}
        accountRateLimits={accountRateLimits}
        {...(!remote.native ? {} : {
          onRefreshAccountPool: remote.refreshAccountPool,
          onStartAccountLogin: remote.startAccountLogin,
          onCancelAccountLogin: remote.cancelAccountLogin,
          onActivateAccountProfile: remote.activateAccountProfile,
          onUpdateAccountProfile: remote.updateAccountProfile,
          onRemoveAccountProfile: remote.removeAccountProfile,
        })}
      />
      <NewThreadServerSheet
        visible={newThreadVisible}
        servers={servers}
        onClose={() => setNewThreadVisible(false)}
        onSelect={async (serverId) => await startNewThread(serverId, defaultProjectCwd(serverId))}
      />
    </View>
    </VoiceAura>
    </AppVoiceInputProvider>
    </RenderRecoveryProvider>
  );
}

function ServerRail({
  servers,
  activeServerId,
  onSelect,
  onAdd,
  onSettings,
}: {
  servers: DemoServer[];
  activeServerId: string;
  onSelect(id: string): void;
  onAdd(): void;
  onSettings(): void;
}) {
  const [pendingSelection, setPendingSelection] = useState<{ base: string; target: string } | null>(null);
  const visibleServerId = pendingSelection?.base === activeServerId ? pendingSelection.target : activeServerId;
  const select = (serverId: string) => {
    if (serverId === visibleServerId) return;
    setPendingSelection({ base: activeServerId, target: serverId });
    // Commit the visual selection before the conversation tree changes.
    requestAnimationFrame(() => onSelect(serverId));
  };
  return (
    <View testID="server-rail" style={styles.serverRail}>
      <ScrollView
        style={styles.serverRailScroll}
        contentContainerStyle={styles.serverRailScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {servers.map((server) => (
          <Pressable
            key={server.id}
            {...(server.id === visibleServerId ? { testID: "active-server" } : {})}
            accessibilityLabel={`${server.name}, ${connectionStateLabel(server.status)}`}
            accessibilityRole="button"
            onPress={() => select(server.id)}
            style={[styles.serverAvatar, server.id === visibleServerId && styles.serverAvatarActive]}
          >
            {server.id === visibleServerId && <View testID="active-server-marker" style={styles.serverActiveMarker} />}
            <Text style={styles.serverEmoji}>{serverGlyph(server)}</Text>
            <StatusDot status={server.status} />
          </Pressable>
        ))}
        <RailButton icon="add" accessibilityLabel="Add server" onPress={onAdd} />
      </ScrollView>
      <RailButton icon="settings-outline" accessibilityLabel="Settings" onPress={onSettings} />
    </View>
  );
}

function RailButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress?(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.railButton, pressed && styles.pressed]}
    >
      <Ionicons name={icon} color={colors.text} size={23} />
    </Pressable>
  );
}

function StatusDot({ status }: { status: ServerStatus }) {
  const activity = connectionActivity(status);
  if (activity === null) return null;
  return (
    <View style={[styles.statusDot, { backgroundColor: colors.surfaceContainerHigh }]}> 
      <ActivityIndicator size={8} color={connectionActivityColor(activity)} />
    </View>
  );
}

type ConnectionActivity = "connecting" | "updating";

function connectionActivity(status: ServerStatus): ConnectionActivity | null {
  if (status === "connecting") return "connecting";
  if (status === "syncing") return "updating";
  return null;
}

function connectionActivityColor(activity: ConnectionActivity): string {
  return activity === "connecting" ? colors.textDim : colors.amber;
}

function ConnectionActivityIndicator({ status, size = 14 }: { status: ServerStatus; size?: number }) {
  const activity = connectionActivity(status);
  if (activity === null) return null;
  return (
    <View accessible accessibilityLabel={activity === "connecting" ? "Connecting" : "Updating"} style={styles.connectionActivityIndicator}>
      <ActivityIndicator size={size} color={connectionActivityColor(activity)} />
    </View>
  );
}

function connectionStateLabel(status: ServerStatus, enabled = true): string {
  if (!enabled) return "Disabled";
  if (status === "live") return "Live";
  if (status === "syncing") return "Updating…";
  if (status === "connecting") return "Connecting…";
  if (status === "authRequired") return "Access required";
  if (status === "degraded") return "Connection error";
  return "Offline";
}

function connectionStateColor(status: ServerStatus): string {
  if (status === "live") return colors.green;
  if (status === "syncing" || status === "connecting") return colors.amber;
  if (status === "offline") return colors.textDim;
  return colors.red;
}

function connectionDiagnosticSummary(diagnostic: string): string {
  if (diagnostic.includes("session_expired") || diagnostic.startsWith("4003:")) {
    return "Session expired. Refreshing credentials and reconnecting.";
  }
  if (diagnostic === "native_frame_journal_overflow") return "Incoming update buffer overflowed. A fresh sync is required.";
  if (diagnostic.includes("Pairing or access grant required")) return "This device needs to be paired again.";
  if (diagnostic === "IOException") return "The server could not be reached.";
  return diagnostic;
}

function connectionDiagnosticTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type ThreadListRow =
  | { kind: "header"; title: string }
  | { kind: "thread"; thread: DemoThread };

type ThreadListMode = "active" | "archived";

function threadListRowsEqual(previous: ThreadListRow, next: ThreadListRow): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "header" && next.kind === "header") return previous.title === next.title;
  if (previous.kind !== "thread" || next.kind !== "thread") return false;
  const left = previous.thread;
  const right = next.thread;
  return left === right || (
    left.id === right.id
    && left.serverId === right.serverId
    && left.title === right.title
    && left.preview === right.preview
    && left.time === right.time
    && left.pinned === right.pinned
    && left.archived === right.archived
    && left.unread === right.unread
    && left.state === right.state
  );
}

function ThreadSidebar({
  width,
  server,
  threads,
  archivedThreads,
  mode,
  activeThreadId,
  onModeChange,
  onSelect,
  onNewThread,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
  accountRateLimits = null,
  onRefreshAccountRateLimits,
}: {
  width: number;
  server: DemoServer | undefined;
  threads: DemoThread[];
  archivedThreads: DemoThread[];
  mode: ThreadListMode;
  activeThreadId: string | null;
  onModeChange(mode: ThreadListMode): void;
  onSelect(id: string): void;
  onNewThread(): void;
  onTogglePin(thread: DemoThread): Promise<void>;
  onArchive(thread: DemoThread): Promise<void>;
  onUnarchive(thread: DemoThread): Promise<void>;
  onMarkRead(thread: DemoThread): Promise<void>;
  accountRateLimits?: AccountRateLimitsRow | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  const windowLayout = useWindowLayout();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ThreadListFilter>("all");
  const filtered = threads.filter((thread) => threadMatchesFilter(thread, filter) &&
    `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const filteredArchived = archivedThreads.filter((thread) => threadMatchesFilter(thread, filter) &&
    `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const rows: ThreadListRow[] = [];
  if (mode === "archived") {
    rows.push(...filteredArchived.map((thread) => ({ kind: "thread" as const, thread })));
  } else {
    const pinned = filtered.filter((thread) => thread.pinned);
    const recent = filtered.filter((thread) => !thread.pinned);
    if (pinned.length > 0) {
      rows.push({ kind: "header", title: "Pinned" });
      rows.push(...pinned.map((thread) => ({ kind: "thread" as const, thread })));
    }
    if (recent.length > 0) {
      rows.push({ kind: "header", title: "Recent" });
      rows.push(...recent.map((thread) => ({ kind: "thread" as const, thread })));
    }
  }

  return (
    <View testID="thread-list-pane" style={[styles.threadSidebar, { width }]}>
      <View style={styles.sidebarHeader}>
        <View style={styles.serverTitleRow}>
          {mode === "archived" && (
            <Pressable onPress={() => onModeChange("active")} style={styles.headerIcon} accessibilityLabel="Back to threads">
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
          )}
          <Text testID="server-title" numberOfLines={1} ellipsizeMode="tail" style={styles.serverTitle}>
            {mode === "archived" ? "Archived threads" : server?.name ?? "Server"}
          </Text>
          {mode === "active" && server !== undefined && <ConnectionActivityIndicator status={server.status} />}
          {mode === "active" && (
            <>
              <Pressable onPress={onNewThread} style={styles.headerIcon} accessibilityLabel="New thread">
                <Ionicons name="create-outline" size={22} color={colors.text} />
              </Pressable>
              <ThreadListMenu
                archivedCount={archivedThreads.length}
                onOpenArchived={() => onModeChange("archived")}
                accountRateLimits={accountRateLimits}
                showAccountLimits={server !== undefined}
                {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
              />
            </>
          )}
        </View>
        <View style={styles.threadSearchRow}>
          <View style={[styles.searchBox, styles.threadSearchBox]}>
            <Ionicons name="search" color={colors.textMuted} size={18} />
            <TextInput
              accessibilityLabel="Search threads"
              value={query}
              onChangeText={setQuery}
              placeholder={mode === "archived" ? "Search archived threads" : "Search threads"}
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
            />
          </View>
          <ThreadFilterMenu selected={filter} onSelect={setFilter} />
        </View>
      </View>
      <LegendList
        data={rows}
        dataKey={`desktop-threads:${windowLayout.measurementRevision}`}
        extraData={`${activeThreadId ?? ""}:${windowLayout.measurementRevision}`}
        estimatedItemSize={64}
        drawDistance={320}
        recycleItems
        getItemType={(row) => row.kind}
        itemsAreEqual={threadListRowsEqual}
        keyExtractor={(row) => row.kind === "header" ? `header-${row.title}` : threadSelectionKey(row.thread)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<ThreadListEmpty archived={mode === "archived"} />}
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <Text style={styles.sectionHeader}>{item.title}</Text>
          ) : (
            <ThreadRow
              thread={item.thread}
              selected={threadSelectionKey(item.thread) === activeThreadId}
              onPress={() => onSelect(threadSelectionKey(item.thread))}
              onTogglePin={() => onTogglePin(item.thread)}
              onArchive={() => onArchive(item.thread)}
              onUnarchive={() => onUnarchive(item.thread)}
              onMarkRead={() => onMarkRead(item.thread)}
            />
          )
        }
      />
    </View>
  );
}

function ThreadListMenu({
  archivedCount,
  onOpenArchived,
  accountRateLimits = null,
  showAccountLimits = true,
  onRefreshAccountRateLimits,
}: {
  archivedCount: number;
  onOpenArchived(): void;
  accountRateLimits?: AccountRateLimitsRow | null;
  showAccountLimits?: boolean;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  return (
    <UsagePopover
      rateLimits={accountRateLimits}
      showAccountLimits={showAccountLimits}
      {...(onRefreshAccountRateLimits === undefined ? {} : { onRefresh: onRefreshAccountRateLimits })}
      placement="bottom"
      align="end"
      actions={[{
        id: "archived",
        label: "Archived threads",
        description: archivedCount === 1 ? "1 thread" : `${archivedCount} threads`,
        icon: "archive-outline",
        onPress: onOpenArchived,
      }]}
    >
      <Pressable accessibilityLabel="Thread list menu" style={styles.headerIcon}>
        <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
      </Pressable>
    </UsagePopover>
  );
}

function ThreadFilterMenu({ selected, onSelect }: { selected: ThreadListFilter; onSelect(filter: ThreadListFilter): void }) {
  const [triggerHandle, setTriggerHandle] = useState<MenuTriggerRef | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const options: Array<{ id: ThreadListFilter; label: string }> = [
    { id: "all", label: "All threads" },
    { id: "running", label: "Running" },
    { id: "approval", label: "Approval needed" },
    { id: "unread", label: "Unread" },
    { id: "pinned", label: "Pinned" },
  ];
  return (
    <Menu presentation="popover" isOpen={isOpen} onOpenChange={setIsOpen}>
      <Menu.Trigger asChild ref={setTriggerHandle}>
        <Pressable
          accessibilityLabel="Thread filters"
          accessibilityRole="button"
          accessibilityState={{ selected: selected !== "all" }}
          hitSlop={2}
          onPress={() => triggerHandle?.open()}
          style={({ pressed }) => [styles.threadFilterButton, pressed && styles.pressed]}
        >
          <Ionicons name="filter-outline" size={20} color={colors.text} />
          {selected !== "all" && <View testID="thread-filter-active-dot" style={styles.threadFilterActiveDot} />}
        </Pressable>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay className="bg-backdrop" />
        <Menu.Content
          presentation="popover"
          placement="bottom"
          align="end"
          width={220}
          offset={8}
          className="border border-border"
        >
          {options.map((option) => (
            <Menu.Item
              key={option.id}
              id={option.id}
              isSelected={selected === option.id}
              onPress={() => {
                onSelect(option.id);
                setIsOpen(false);
              }}
            >
              <Menu.ItemTitle>{option.label}</Menu.ItemTitle>
              {selected === option.id && <Menu.ItemIndicator />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

function ThreadListEmpty({ archived }: { archived: boolean }) {
  return (
    <View style={styles.threadListEmpty}>
      <Ionicons name={archived ? "archive-outline" : "chatbubble-ellipses-outline"} size={24} color={colors.textDim} />
      <Text style={styles.threadListEmptyText}>{archived ? "No archived threads" : "No threads found"}</Text>
    </View>
  );
}

type ThreadListFilter = "all" | "running" | "approval" | "unread" | "pinned";

function threadMatchesFilter(thread: DemoThread, filter: ThreadListFilter): boolean {
  if (filter === "running") return thread.state === "running";
  if (filter === "approval") return thread.state === "approval";
  if (filter === "unread") return thread.unread > 0;
  if (filter === "pinned") return thread.pinned;
  return true;
}

function ThreadRow({
  thread,
  selected,
  onPress,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
}: {
  thread: DemoThread;
  selected: boolean;
  onPress(): void;
  onTogglePin?(): Promise<void>;
  onArchive?(): Promise<void>;
  onUnarchive?(): Promise<void>;
  onMarkRead?(): Promise<void>;
}) {
  const dialog = useAppDialog();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const [webContextVisible, setWebContextVisible] = useState(false);
  const archiveAction = thread.archived ? onUnarchive : onArchive;
  const archiveLabel = thread.archived ? "Unarchive" : "Archive";
  const swipeEnabled = onTogglePin !== undefined || archiveAction !== undefined || onMarkRead !== undefined;
  const menuActions: ActionMenuItem[] = [
    { id: "copy-session-id", label: "Copy session ID", icon: "copy-outline" },
    { id: "pin", label: thread.pinned ? "Unpin" : "Pin", icon: "pin-outline", selected: thread.pinned, disabled: onTogglePin === undefined },
    { id: "read", label: "Mark as read", icon: "checkmark-done-outline", disabled: onMarkRead === undefined },
    { id: "archive", label: archiveLabel, icon: thread.archived ? "archive" : "archive-outline", destructive: !thread.archived, disabled: archiveAction === undefined },
  ];
  const runThreadAction = (action: (() => Promise<void>) | undefined, label: string, closeSwipe = false) => {
    if (action === undefined) return;
    // Start the action before closing the animated row. A close failure must
    // never swallow the actual thread command.
    void action().catch((cause) => dialog.alert(`${label} failed`, cause instanceof Error ? cause.message : "Thread action failed"));
    if (closeSwipe) swipeableRef.current?.close();
  };
  useEffect(() => {
    swipeableRef.current?.close();
  }, [selected, thread.id]);
  const row = (
    <Pressable
      {...(selected ? { testID: "selected-thread-row" } : {})}
      accessibilityRole="button"
      onPress={onPress}
      {...(Platform.OS === "web" ? { onLongPress: () => setWebContextVisible(true), delayLongPress: 350 } : {})}
      style={({ pressed }) => [
        styles.threadRow,
        swipeEnabled && styles.threadRowSwipeChild,
        selected && styles.threadRowSelected,
        pressed && styles.pressed,
      ]}
    >
      {selected && <View style={styles.selectionBar} />}
      <View style={styles.threadText}>
        <View style={styles.threadTitleLine}>
          <View style={styles.threadTitleSlot}>
            {thread.state === "running"
              ? <RunningThreadTitle value={thread.title} />
              : <Text numberOfLines={1} style={styles.threadTitle}>{emojiSafeTitle(thread.title)}</Text>}
          </View>
          {thread.state !== undefined && thread.state !== null && thread.state !== "running" && (
            <View accessible accessibilityLabel={`Thread ${thread.state}`} style={styles.threadStatusIcon}>
              <Ionicons
                name={thread.state === "approval" ? "shield-checkmark" : "alert-circle"}
                size={14}
                color={thread.state === "failed" ? colors.red : colors.amber}
              />
            </View>
          )}
          <View style={styles.unreadSlot}>
            {thread.unread > 0 && (
              <View
                accessible
                accessibilityLabel={`${thread.unread} unread ${thread.unread === 1 ? "message" : "messages"}`}
                style={styles.unreadDot}
              />
            )}
          </View>
          <Text testID="thread-time" numberOfLines={1} style={styles.threadTime}>{thread.time}</Text>
        </View>
        <View style={styles.threadPreviewLine}>
          <Text testID="thread-preview" numberOfLines={1} style={styles.threadPreview}>{plainThreadPreview(thread.preview)}</Text>
        </View>
      </View>
    </Pressable>
  );
  const rowMenu = Platform.OS === "web" ? row : (
    <ActionMenu
      accessibilityLabel="Thread actions"
      actions={menuActions}
      trigger="long-press"
      onSelect={(id) => {
        if (id === "copy-session-id") void copySessionId(thread.id).catch((cause) => dialog.alert("Copy failed", cause instanceof Error ? cause.message : "Could not copy session ID"));
        else if (id === "pin") runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin");
        else if (id === "read") runThreadAction(onMarkRead, "Mark as read");
        else if (id === "archive") runThreadAction(archiveAction, archiveLabel);
      }}
      style={styles.threadContextMenu}
    >
      {row}
    </ActionMenu>
  );
  return (
    <>
      {!swipeEnabled ? rowMenu : (
        <Swipeable
          ref={swipeableRef}
          friction={1.8}
          leftThreshold={48}
          rightThreshold={48}
          dragOffsetFromLeftEdge={12}
          dragOffsetFromRightEdge={12}
          overshootLeft={false}
          overshootRight={false}
          containerStyle={styles.swipeContainer}
          childrenContainerStyle={styles.swipeChildren}
          renderRightActions={() => (
            <View style={styles.swipeActionsRight}>
              <ThreadSwipeAction label={thread.pinned ? "Unpin" : "Pin"} icon="push-pin" tone="neutral" {...(onTogglePin === undefined ? {} : { onPress: () => runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin", true) })} />
              <ThreadSwipeAction label="Read" icon="checkmark-done-outline" tone="accent" {...(onMarkRead === undefined ? {} : { onPress: () => runThreadAction(onMarkRead, "Mark as read", true) })} />
              <ThreadSwipeAction label={archiveLabel} icon={thread.archived ? "archive" : "archive-outline"} tone={thread.archived ? "accent" : "danger"} {...(archiveAction === undefined ? {} : { onPress: () => runThreadAction(archiveAction, archiveLabel, true) })} />
            </View>
          )}
        >
          {rowMenu}
        </Swipeable>
      )}
      {Platform.OS === "web" && (
        <AppSheet isOpen={webContextVisible} onOpenChange={setWebContextVisible} contentProps={{ index: 0, enableDynamicSizing: true }}>
          <Text style={styles.sheetTitle}>Thread</Text>
          <MenuAction icon="copy-outline" title="Copy session ID" subtitle="" onPress={() => { setWebContextVisible(false); void copySessionId(thread.id).catch((cause) => dialog.alert("Copy failed", cause instanceof Error ? cause.message : "Could not copy session ID")); }} />
          <MenuAction icon="push-pin" title={thread.pinned ? "Unpin" : "Pin"} subtitle="" onPress={() => { setWebContextVisible(false); runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin"); }} />
          <MenuAction icon="checkmark-done-outline" title="Mark as read" subtitle="" onPress={() => { setWebContextVisible(false); runThreadAction(onMarkRead, "Mark as read"); }} />
          <MenuAction danger={!thread.archived} icon={thread.archived ? "archive" : "archive-outline"} title={archiveLabel} subtitle="" onPress={() => { setWebContextVisible(false); runThreadAction(archiveAction, archiveLabel); }} />
        </AppSheet>
      )}
    </>
  );
}

function ThreadSwipeAction({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap | "push-pin";
  tone: "neutral" | "accent" | "danger";
  onPress?(): void;
}) {
  const foreground = tone === "neutral"
    ? colors.text
    : tone === "danger"
      ? colors.onErrorContainer
      : colors.onPrimary;
  return (
    <Pressable
      accessibilityLabel={`${label} thread`}
      accessibilityRole="button"
      disabled={onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.swipeAction,
        tone === "neutral" && styles.swipeActionNeutral,
        tone === "accent" && styles.swipeActionAccent,
        tone === "danger" && styles.swipeActionDanger,
        pressed && styles.swipeActionPressed,
      ]}
    >
      {icon === "push-pin"
        ? <MaterialIcons name="push-pin" size={19} color={foreground} />
        : <Ionicons name={icon} size={19} color={foreground} />}
      <Text style={[styles.swipeActionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

function MobileThreads({
  servers,
  activeServerId,
  threads,
  archivedThreads,
  mode,
  query,
  onQueryChange,
  onModeChange,
  initialOffset,
  onOffsetChange,
  onSelectThread,
  onSelectServer,
  onAddServer,
  onNewThread,
  onSettings,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
  accountRateLimits = null,
  onRefreshAccountRateLimits,
}: {
  servers: DemoServer[];
  activeServerId: string;
  threads: DemoThread[];
  archivedThreads: DemoThread[];
  mode: ThreadListMode;
  query: string;
  onQueryChange(query: string): void;
  onModeChange(mode: ThreadListMode): void;
  initialOffset: number;
  onOffsetChange(offset: number): void;
  onSelectThread(id: string): void;
  onSelectServer(id: string): void;
  onAddServer(): void;
  onNewThread(): void;
  onSettings(): void;
  onTogglePin(thread: DemoThread): Promise<void>;
  onArchive(thread: DemoThread): Promise<void>;
  onUnarchive(thread: DemoThread): Promise<void>;
  onMarkRead(thread: DemoThread): Promise<void>;
  accountRateLimits?: AccountRateLimitsRow | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  const windowLayout = useWindowLayout();
  const [filter, setFilter] = useState<ThreadListFilter>("all");
  const [serverPickerVisible, setServerPickerVisible] = useState(false);
  const filteredThreads = threads.filter((thread) => threadMatchesFilter(thread, filter) &&
    `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const filteredArchived = archivedThreads.filter((thread) => threadMatchesFilter(thread, filter) &&
    `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const activeServer = servers.find((server) => server.id === activeServerId);
  const mobileRows: ThreadListRow[] = [];
  if (mode === "archived") {
    mobileRows.push(...filteredArchived.map((thread) => ({ kind: "thread" as const, thread })));
  } else {
    const pinnedThreads = filteredThreads.filter((thread) => thread.pinned);
    const recentThreads = filteredThreads.filter((thread) => !thread.pinned);
    if (pinnedThreads.length > 0) {
      mobileRows.push({ kind: "header", title: "Pinned" });
      mobileRows.push(...pinnedThreads.map((thread) => ({ kind: "thread" as const, thread })));
    }
    if (recentThreads.length > 0) {
      mobileRows.push({ kind: "header", title: "Recent" });
      mobileRows.push(...recentThreads.map((thread) => ({ kind: "thread" as const, thread })));
    }
  }

  return (
    <View style={styles.mobileList}>
      <View style={styles.mobileTitleRow}>
        {mode === "archived" ? (
          <View style={styles.mobileTitleSelector}>
            <Pressable accessibilityLabel="Back to threads" onPress={() => onModeChange("active")} style={styles.headerIcon}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.mobileIdentity}>
              <Text numberOfLines={1} style={styles.mobileTitle}>Archived threads</Text>
              <Text numberOfLines={1} style={styles.mobileSubtitle}>{filteredArchived.length === 1 ? "1 thread" : `${filteredArchived.length} threads`}</Text>
            </View>
          </View>
        ) : (
          <Pressable accessibilityLabel="Choose server" onPress={() => setServerPickerVisible(true)} style={styles.mobileTitleSelector}>
            <View style={styles.mobileIdentity}>
              <Text numberOfLines={1} style={styles.mobileTitle}>{activeServer?.name ?? "All threads"}</Text>
              <Text numberOfLines={1} style={styles.mobileSubtitle}>{activeServer === undefined ? `${servers.length} servers` : connectionStateLabel(activeServer.status)}</Text>
            </View>
            <Ionicons name="chevron-down" size={17} color={colors.textMuted} />
          </Pressable>
        )}
        {mode === "active" && (
          <>
            <TopBarAction icon="add" accessibilityLabel="Add server" onPress={onAddServer} />
            <ThreadListMenu
              archivedCount={archivedThreads.length}
              onOpenArchived={() => onModeChange("archived")}
              accountRateLimits={accountRateLimits}
              showAccountLimits={activeServer !== undefined}
              {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
            />
          </>
        )}
      </View>
      <View style={styles.mobileSearchWrap}>
        <View style={styles.threadSearchRow}>
          <View style={[styles.searchBox, styles.threadSearchBox]}>
            <Ionicons name="search" color={colors.textMuted} size={18} />
            <TextInput
              accessibilityLabel="Search threads"
              value={query}
              onChangeText={onQueryChange}
              placeholder={mode === "archived" ? "Search archived threads" : "Search threads"}
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
            />
          </View>
          <ThreadFilterMenu selected={filter} onSelect={setFilter} />
        </View>
      </View>
      <LegendList
        data={mobileRows}
        dataKey={`mobile-threads:${windowLayout.measurementRevision}`}
        extraData={windowLayout.measurementRevision}
        initialScrollOffset={initialOffset}
        estimatedItemSize={64}
        drawDistance={320}
        recycleItems
        getItemType={(item) => item.kind}
        itemsAreEqual={threadListRowsEqual}
        onScroll={({ nativeEvent }) => onOffsetChange(nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
        keyExtractor={(item) => item.kind === "header" ? `header-${item.title}` : threadSelectionKey(item.thread)}
        ListEmptyComponent={<ThreadListEmpty archived={mode === "archived"} />}
        renderItem={({ item }) => (
          item.kind === "header" ? <Text style={styles.sectionHeader}>{item.title}</Text> : <ThreadRow
              thread={item.thread}
              selected={false}
              onPress={() => onSelectThread(threadSelectionKey(item.thread))}
              onTogglePin={() => onTogglePin(item.thread)}
              onArchive={() => onArchive(item.thread)}
              onUnarchive={() => onUnarchive(item.thread)}
              onMarkRead={() => onMarkRead(item.thread)}
            />
        )}
      />
      {mode === "active" && (
        <Pressable accessibilityLabel="New thread" onPress={onNewThread} style={styles.newThreadFab}>
          <Ionicons name="create-outline" size={23} color={colors.onPrimary} />
        </Pressable>
      )}
      <MobileServerSheet
        visible={serverPickerVisible}
        servers={servers}
        activeServerId={activeServerId}
        onSelect={(id) => { onSelectServer(id); setServerPickerVisible(false); }}
        onSettings={() => { setServerPickerVisible(false); onSettings(); }}
        onClose={() => setServerPickerVisible(false)}
      />
    </View>
  );
}

function TopBarAction({ icon, accessibilityLabel, active = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; accessibilityLabel: string; active?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.topBarAction, active && styles.topBarActionActive, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={active ? colors.primary : colors.text} />
    </Pressable>
  );
}

function MobileServerSheet({ visible, servers, activeServerId, onSelect, onSettings, onClose }: { visible: boolean; servers: DemoServer[]; activeServerId: string; onSelect(id: string): void; onSettings(): void; onClose(): void }) {
  return (
    <AppSheet isOpen={visible} onOpenChange={(open) => { if (!open) onClose(); }} contentProps={{ index: 0, enableDynamicSizing: true }}>
      <Text style={styles.sheetTitle}>Server</Text>
      <ControlOption title="All servers" selected={activeServerId === ALL_SERVERS_ID} onPress={() => onSelect(ALL_SERVERS_ID)} />
      {servers.map((server) => (
        <ControlOption
          key={server.id}
          accessibilityLabel={`${server.name}, ${connectionStateLabel(server.status)}`}
          title={`${serverGlyph(server)} ${server.name}`}
          subtitle={connectionStateLabel(server.status)}
          selected={activeServerId === server.id}
          onPress={() => onSelect(server.id)}
        />
      ))}
      <MenuAction icon="settings-outline" title="Settings" subtitle="Servers, accounts, and limits" onPress={onSettings} />
    </AppSheet>
  );
}

function VoiceCaptureStatus({
  phase,
  backend,
  startedAt,
  controller,
  scope,
}: {
  phase: VoiceInputRow["phase"];
  backend: VoiceInputRow["backend"];
  startedAt: number;
  controller: VoiceInputController | null;
  scope: string;
}) {
  const level = useVoiceInputLevel(controller, phase === "recording" ? scope : null);
  const [clock, setClock] = useState(0);

  // The clock invalidates only this tiny status row. Recording time is not
  // application state and must never make the thread/sidebar render again.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  const elapsedSeconds = phase === "recording"
    ? Math.max(0, Math.floor((Math.max(startedAt, clock) - startedAt) / 1_000))
    : 0;

  return (
    <View accessibilityLabel="Voice recording" style={styles.voiceCapture}>
      {phase === "recording" ? (
        <View style={styles.voiceMeter}>
          {[0.55, 0.8, 1, 0.72, 0.45].map((weight, index) => (
            <View key={index} style={[styles.voiceMeterBar, { height: 5 + Math.max(0.12, level) * weight * 18 }]} />
          ))}
        </View>
      ) : <ActivityIndicator size="small" color={colors.accent} />}
      <Text numberOfLines={1} style={styles.voiceCaptureLabel}>
        {phase === "starting"
          ? "Connecting…"
          : phase === "finishing"
            ? "Transcribing…"
            : `${backend === "android" ? "Android · " : ""}${formatVoiceDuration(elapsedSeconds)}`}
      </Text>
    </View>
  );
}

function ConversationPane({
  thread,
  server,
  demo = false,
  demoComposer,
  demoControls = null,
  compact = false,
  readOnly = false,
  onBack,
  remoteThread,
  accountRateLimits = null,
  onRefreshAccountRateLimits,
  remoteSealedTurns,
  remoteLiveTurns,
  loadState = { phase: "ready", nextCursor: null, loadingOlder: false, residentOffset: 0, error: null },
  onLoadOlder,
  onRevealNewer,
  onLoadTurnItems,
  pendingDeliveries = [],
  queuedPrompts = [],
  composerState = null,
  controlsResource = null,
  terminalsResource = null,
  threadResources = null,
  goalResource = null,
  tunnelResource = null,
  portForwarding,
  onOpenLoopbackLink,
  voiceResource = null,
  reviewVoiceResource = null,
  voiceController = null,
  fileTransferResource = null,
  fileTransferController = null,
  subagents = [],
  subagentSummaryDatabase = null,
  subagentThreadDetails = null,
  onReadSubagentThread,
  onRefreshSubagents,
  onOpenSubagentThread,
  onSend,
  onRetryFailedMessage,
  loadDraft,
  saveDraft,
  saveDraftAttachments,
  loadScrollOffset,
  saveScrollOffset,
  saveComposerPreferences,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
  archived = false,
  pinned = false,
  unread = 0,
  onViewedLatest,
  onTogglePin,
  cwd = "/workspace",
  projects = [],
  onChangeProject,
  onLoadControls,
  onUpdateSettings,
  onInterrupt,
  onListQueue,
  onEditQueued,
  onCancelQueued,
  onMoveQueued,
  onSteerQueued,
  onListTerminals,
  onLoadThreadResources,
  onLoadThreadChangeDiff,
  onTerminateTerminal,
  onGetGoal,
  onSetGoal,
  onClearGoal,
  onStartReview,
  onCompact,
  onFork,
  onFixUnsupportedBlock,
  onCreateTunnel,
  onRevokeTunnel,
  pendingRequest = null,
  pendingRequestCount = 0,
  onRespondToRequest,
  getTransferAccess,
  onStartVoiceTranscription,
}: {
  thread: DemoThread | null;
  server: DemoServer | undefined;
  demo?: boolean;
  demoComposer?: { draft: string; attachments: ComposerAttachment[]; preferences: StoredComposerPreferences };
  demoControls?: TurnControls | null;
  compact?: boolean;
  readOnly?: boolean;
  onBack?(): void;
  remoteThread?: Thread | null;
  accountRateLimits?: AccountRateLimitsRow | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
  remoteSealedTurns?: readonly Thread["turns"][number][];
  remoteLiveTurns?: readonly Thread["turns"][number][];
  loadState?: ThreadLoadState;
  onLoadOlder?(): Promise<void>;
  onRevealNewer?(): Promise<void>;
  onLoadTurnItems?(turnId: string): Promise<void>;
  pendingDeliveries?: Array<NativeCommandDelivery & { attachments?: ComposerAttachment[] }>;
  queuedPrompts?: QueuedPrompt[];
  composerState?: ThreadUiStateRow | null;
  controlsResource?: TurnControlsRow | null;
  terminalsResource?: BackgroundTerminalsRow | null;
  threadResources?: ThreadResourcesRow | null;
  goalResource?: ThreadGoalRow | null;
  tunnelResource?: TunnelRow | null;
  portForwarding?: PortForwardingManagerProps;
  onOpenLoopbackLink?(target: LoopbackLinkTarget): Promise<void>;
  voiceResource?: VoiceInputRow | null;
  reviewVoiceResource?: VoiceInputRow | null;
  voiceController?: VoiceInputController | null;
  fileTransferResource?: FileTransferRow | null;
  fileTransferController?: FileTransferController | null;
  subagents?: readonly StoredThreadSummary[];
  subagentSummaryDatabase?: ThreadSummaryDatabase | null;
  subagentThreadDetails?: ThreadDetailDatabase | null;
  onReadSubagentThread?(connectionId: string, threadId: string): Promise<import("./data/use-remote-workspace").ThreadWindow | null>;
  onRefreshSubagents?(rootThreadId: string): Promise<void>;
  onOpenSubagentThread?(threadId: string): void;
  onSend?(text: string, mode: SendMode, options: TurnSendOptions): Promise<string>;
  onRetryFailedMessage?(commandId: string): Promise<void>;
  loadDraft?(connectionId: string, threadId: string): Promise<string>;
  saveDraft?(connectionId: string, threadId: string, text: string): Promise<void>;
  saveDraftAttachments?(connectionId: string, threadId: string, attachments: ComposerAttachment[]): Promise<void>;
  loadScrollOffset?(connectionId: string, threadId: string): Promise<number | null>;
  saveScrollOffset?(connectionId: string, threadId: string, offset: number): Promise<void>;
  saveComposerPreferences?(connectionId: string, threadId: string, preferences: StoredComposerPreferences): Promise<void>;
  onRename?(name: string): Promise<void>;
  onArchive?(): Promise<void>;
  onUnarchive?(): Promise<void>;
  onDelete?(): Promise<void>;
  archived?: boolean;
  pinned?: boolean;
  unread?: number;
  onViewedLatest?(): void;
  onTogglePin?(): Promise<void>;
  cwd?: string;
  projects?: readonly ThreadProject[];
  onChangeProject?(cwd: string | null): Promise<void>;
  onLoadControls?(cwd: string): Promise<TurnControls>;
  onUpdateSettings?(settings: ThreadSettings): Promise<void>;
  onInterrupt?(turnId: string): Promise<void>;
  onListQueue?(): Promise<QueuedPrompt[]>;
  onEditQueued?(commandId: string, text: string, attachments: ComposerAttachment[]): Promise<void>;
  onCancelQueued?(commandId: string): Promise<void>;
  onMoveQueued?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteerQueued?(commandId: string, expectedTurnId: string): Promise<void>;
  onListTerminals?(): Promise<BackgroundTerminal[]>;
  onLoadThreadResources?(): Promise<ThreadResourcesValue>;
  onLoadThreadChangeDiff?(path: string): Promise<ThreadChangeDiffValue>;
  onTerminateTerminal?(processId: string): Promise<boolean>;
  onGetGoal?(): Promise<ThreadGoal | null>;
  onSetGoal?(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClearGoal?(): Promise<boolean>;
  onStartReview?(target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
  onCompact?(): Promise<void>;
  onFork?(options: ThreadForkOptions): Promise<void>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
  onCreateTunnel?(port: number, ttlSeconds: number): Promise<TunnelPreview>;
  onRevokeTunnel?(tunnelId: string): Promise<void>;
  pendingRequest?: PendingServerRequest | null;
  pendingRequestCount?: number;
  onRespondToRequest?(request: PendingServerRequest, result: unknown): Promise<void>;
  getTransferAccess?: GetTransferAccess;
  onStartVoiceTranscription?(listener: (event: VoiceTranscriptionEvent) => void, options?: VoiceTranscriptionOptions): Promise<VoiceTranscriptionSession>;
}) {
  const windowLayout = useWindowLayout();
  const dialog = useAppDialog();
  const conversationInsets = useSafeAreaInsets();
  const openDocument = useDocumentPreview();
  const downloadDocument = useDocumentDownload();
  const draftConnectionId = server?.id ?? null;
  const draftThreadId = thread?.id ?? null;
  const composerScope = `${draftConnectionId ?? "demo"}\u0000${draftThreadId ?? "none"}`;
  const [narrowConversationPane, setNarrowConversationPane] = useState(false);
  const [conversationPaneWidth, setConversationPaneWidth] = useState(0);
  const timelineCompact = compact || narrowConversationPane;
  const timelineHorizontalInsets = timelineCompact ? spacing.xs * 2 : 52 + spacing.md;
  const timelineItemWidth = Math.min(880, Math.max(0, conversationPaneWidth - timelineHorizontalInsets));
  const richContentWidth = timelineItemWidth > 0
    ? Math.max(1, Math.floor(timelineItemWidth * 0.94) - 20)
    : null;
  const [composerTrayVisible, setComposerTrayVisible] = useState(false);
  const [threadResourceSheet, setThreadResourceSheet] = useState<"changes" | "attachments" | null>(null);
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectChangeBusy, setProjectChangeBusy] = useState(false);
  const [projectChangeError, setProjectChangeError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuInitialPage, setMenuInitialPage] = useState<ComposerMenuPage>("model");
  const [demoDraft, setDemoDraft] = useState(() => demoComposer?.draft ?? "");
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_MIN_HEIGHT);
  const composerInputWidthRef = useRef(0);
  const [demoAttachments, setDemoAttachments] = useState<ComposerAttachment[]>(() => demoComposer?.attachments ?? []);
  const voicePhase = voiceResource?.phase ?? "idle";
  const voiceBackend = voiceResource?.backend ?? "remote";
  const voiceError = voiceResource?.error ?? null;
  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;
  const pendingVoiceSelection = voiceResource?.pendingSelection ?? null;
  const controls = demo ? demoControls ?? EMPTY_TURN_CONTROLS : controlsResource?.value ?? EMPTY_TURN_CONTROLS;
  const threadResourcesPending = threadResources === null || (threadResources.status === "loading" && threadResources.value === null);
  const controlsLoading = controlsResource?.status === "loading" && controlsResource.value === null;
  const controlsPending = !demo
    && onLoadControls !== undefined
    && (controlsResource === null || controlsLoading);
  const [controlError, setControlError] = useState<string | null>(null);
  const effectiveControlError = controlError ?? controlsResource?.error ?? null;

  const [demoPreferences, setDemoPreferences] = useState<StoredComposerPreferences>(() => demoComposer?.preferences ?? EMPTY_COMPOSER_PREFERENCES);
  const draft = demo ? demoDraft : composerState?.draftText ?? "";
  const visibleComposerInputHeight = draft === "" ? COMPOSER_MIN_HEIGHT : composerInputHeight;
  const attachments = demo ? demoAttachments : composerState?.attachments ?? [];
  const visibleSubagents = draftThreadId === null ? [] : subagentsForThread(subagents, draftThreadId);
  const sessionChangeCount = threadResources?.value?.changes.length ?? 0;
  const sessionAttachmentCount = threadResources?.value?.attachments.length ?? 0;
  const sessionChangesEmpty = threadResources?.status === "ready" && sessionChangeCount === 0;
  const sessionAttachmentsEmpty = threadResources?.status === "ready" && sessionAttachmentCount === 0;
  const sessionChangesLabel = threadResourcesPending
    ? "Loading changes…"
    : threadResources?.status === "error" && threadResources.value === null
      ? "Changes unavailable"
      : sessionChangesEmpty
        ? "No changes"
        : `Changes · ${sessionChangeCount}`;
  const sessionAttachmentsLabel = threadResourcesPending
    ? "Loading attachments…"
    : threadResources?.status === "error" && threadResources.value === null
      ? "Attachments unavailable"
      : sessionAttachmentsEmpty
        ? "No attachments"
        : `Attachments · ${sessionAttachmentCount}`;
  const composerPreferences = demo ? demoPreferences : composerState?.preferences ?? EMPTY_COMPOSER_PREFERENCES;
  const composerStateMissing = composerState === null;
  const updateComposerPreferences = (apply: (current: StoredComposerPreferences) => StoredComposerPreferences) => {
    const next = apply(composerPreferences);
    if (demo) setDemoPreferences(next);
    else if (saveComposerPreferences !== undefined && draftConnectionId !== null && draftThreadId !== null) {
      void saveComposerPreferences(draftConnectionId, draftThreadId, next).catch(() => undefined);
    }
  };
  const selectedModel = composerPreferences.model;
  const selectedEffort = composerPreferences.effort;
  const selectedPersonality = composerPreferences.personality;
  const selectedPermissions = composerPreferences.permissions;
  const selectedSkills = composerPreferences.skillPaths;
  const setSelectedModel = (value: string | null | ((current: string | null) => string | null)) => updateComposerPreferences((current) => ({
    ...current,
    model: typeof value === "function" ? value(current.model) : value,
  }));
  const setSelectedEffort = (value: string | null | ((current: string | null) => string | null)) => updateComposerPreferences((current) => ({
    ...current,
    effort: typeof value === "function" ? value(current.effort) : value,
  }));
  const setSelectedPersonality = (value: Personality | null) => updateComposerPreferences((current) => ({ ...current, personality: value }));
  const setSelectedPermissions = (value: string | null | ((current: string | null) => string | null)) => updateComposerPreferences((current) => ({
    ...current,
    permissions: typeof value === "function" ? value(current.permissions) : value,
  }));
  const [threadRenameVisible, setThreadRenameVisible] = useState(false);
  const [threadSearchVisible, setThreadSearchVisible] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchMatch, setThreadSearchMatch] = useState(0);
  const draftSelectionRef = useRef<DraftSelection>({ start: 0, end: 0 });
  const composerContentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const timelineViewportHeightRef = useRef(0);
  const timelineContentHeightRef = useRef(0);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelinePositionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineIndexRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchOriginOffsetRef = useRef<number | null>(null);
  const timelineInteractionScopeRef = useRef("");
  const olderLoadInFlightRef = useRef(false);
  const firstVisibleTimelineIndexRef = useRef<number | null>(null);
  const lastTimelineOffsetYRef = useRef<number | null>(null);
  const onTimelineViewableItemsChanged = ({ viewableItems }: { viewableItems: Array<{ index: number | null; isViewable: boolean }> }) => {
    firstVisibleTimelineIndexRef.current = viewableItems
      .filter((item) => item.isViewable && item.index !== null)
      .reduce<number | null>((first, item) => first === null ? item.index : Math.min(first, item.index as number), null);
  };
  const timelineRef = useRef<ThreadTimelineListRef>(null);
  const timelineOverlayFreeze = useSharedValue(false);
  const timelineOverlay = useTimelineOverlayScrollGuard({
    listRef: timelineRef,
    offsetYRef: lastTimelineOffsetYRef,
    viewportHeightRef: timelineViewportHeightRef,
    contentHeightRef: timelineContentHeightRef,
    distanceFromEndRef: scrollOffsetRef,
    freeze: timelineOverlayFreeze,
  });
  const fullscreenOverlayLifecycle: AppFullscreenOverlayLifecycle = {
    willOpen: (id) => {
      timelineOverlay.begin(id);
      dismissComposerKeyboardForOverlay();
    },
    didOpen: () => timelineOverlay.restore(false),
    didClose: (id) => timelineOverlay.end(id),
  };
  const fullscreenOverlay = useAppFullscreenOverlay({
    scope: composerScope,
    lifecycle: fullscreenOverlayLifecycle,
  });
  const dismissComposerKeyboardForOverlay = () => {
    // KeyboardController.dismiss is synchronous on Android. Treating its void
    // result as a Promise produced the global "undefined is not a function"
    // rejection whenever a menu or sheet opened.
    KeyboardController.dismiss({ animated: true, keepFocus: false });
  };
  const awayFromLatestRef = useRef(false);
  const followingLatestRef = useRef(false);
  const momentumActiveRef = useRef(false);
  const scrollRestoredRef = useRef(false);
  const pendingRestoreOffsetRef = useRef<number | null>(sessionConversationScrollOffsets.get(composerScope) ?? 0);
  const [composerDockHeight, setComposerDockHeight] = useState(touchTarget + 12);
  const [timelinePositionedScope, setTimelinePositionedScope] = useState("");
  const [timelineInteractionScope, setTimelineInteractionScope] = useState("");
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [timelineTailFollowEnabled, setTimelineTailFollowEnabled] = useState(false);
  const mountedConversationScopeRef = useRef({
    scope: composerScope,
    connectionId: draftConnectionId,
    threadId: draftThreadId,
    saveScrollOffset,
  });
  const newItemCount = awayFromLatest ? unread : 0;
  const threadLifecycleActive = isThreadLifecycleActive(thread?.state);
  const currentTurnId = threadLifecycleActive ? activeTurnId(remoteThread) : null;
  const serverExecution = remoteThread === null || remoteThread === undefined ? null : latestProjectedThreadExecutionSettings(remoteThread);
  const effectiveModel = selectedModel ?? serverExecution?.model ?? null;
  const effectiveEffort = selectedEffort ?? serverExecution?.effort ?? null;
  const effectivePermissions = selectedPermissions ?? serverExecution?.permissions ?? null;
  const effectiveModelLabel = controls.models.find((candidate) => candidate.id === effectiveModel)?.label
    ?? effectiveModel
    ?? (controlsPending ? "Loading model…" : "Model unavailable");
  const effectivePermissionLabel = selectedPermissions === null
    ? executionPermissionsLabel(serverExecution, controlsPending)
    : permissionProfileLabel(selectedPermissions);
  const modelLabelPending = controlsPending && effectiveModel === null;
  const permissionLabelPending = controlsPending && effectivePermissions === null;
  const serverBackedSettings = onUpdateSettings !== undefined;
  const timelineInteracted = timelineInteractionScope === composerScope;

  const projectedPendingDeliveries = (() => {
    if (draftConnectionId === null || draftThreadId === null) return [];
    return pendingDeliveries.flatMap((delivery) => {
      if (delivery.connectionId !== draftConnectionId || (delivery.method !== "turn/start" && delivery.method !== "turn/steer")) return [];
      if (delivery.threadId !== draftThreadId) return [];
      return [{
        scope: composerScope,
        id: delivery.commandId,
        text: delivery.text,
        attachments: delivery.attachments ?? [],
        status: delivery.state === "failed"
          ? "failed" as const
          : delivery.state === "uncertain"
            ? "uncertain" as const
            : delivery.state === "delivered"
              ? "delivered" as const
              : "sending" as const,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
      }];
    });
  })();

  // The TanStack thread timeline is the only optimistic-message source.
  // Kotlin owns durable delivery; React only renders the unified projection.
  const optimistic = projectedPendingDeliveries.slice(-MAX_OPTIMISTIC_MESSAGES);

  const requestControls = () => {
    if (onLoadControls === undefined || controlsLoading) return;
    const scope = composerScope;
    setControlError(null);
    void onLoadControls(cwd).then((next) => {
      if (mountedConversationScopeRef.current.scope !== scope) return;
      setSelectedModel((current) => current !== null && !next.models.some((candidate) => candidate.id === current) ? null : current);
      setSelectedEffort((current) => current !== null && !next.models.some((candidate) => candidate.efforts.includes(current)) ? null : current);
    }).catch((cause) => {
      if (mountedConversationScopeRef.current.scope !== scope) return;
      setControlError(cause instanceof Error ? cause.message : "Could not load turn controls");
    });
  };

  const timelineRemoteThreadId = remoteThread?.id;
  const sealedTimeline = remoteSealedTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : projectTimelineTurns(remoteSealedTurns, composerScope, server?.id ?? "remote", timelineRemoteThreadId);
  const liveTimeline = remoteLiveTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : projectTimelineTurns(remoteLiveTurns, composerScope, server?.id ?? "remote", timelineRemoteThreadId, thread?.state);
  const fullTimeline = remoteThread === null || remoteThread === undefined
      ? []
      : projectTimelineTurns(remoteThread.turns, composerScope, server?.id ?? "remote", remoteThread.id, thread?.state);
  const completeTurnHeadersResident = remoteThread !== null
    && remoteThread !== undefined
    && loadState.nextCursor === null
    && loadState.residentOffset === 0
    && (remoteSealedTurns === undefined || remoteSealedTurns.length < THREAD_RESIDENT_TURN_LIMIT);
  const sessionCompactionCount = completeTurnHeadersResident
    && remoteThread.turns.every((candidate) => candidate.itemsView === "full")
      ? remoteThread.turns.reduce(
          (count, candidate) => count + candidate.items.filter((item) => item.type === "contextCompaction").length,
          0,
        )
      : null;
  const timeline: TimelineItem[] = (() => {
    const partitioned = remoteSealedTurns !== undefined && remoteLiveTurns !== undefined;
    const content: TimelineItem[] = remoteThread === null || remoteThread === undefined
      ? []
      : partitioned ? [...sealedTimeline, ...liveTimeline] : fullTimeline;
    const pending = optimistic
      .filter((message) => message.scope === composerScope)
      .map((message) => ({ kind: "optimistic" as const, ...message }));
    if (pending.length === 0) return content;
    return mergeChronologicalTimeline(
      content.map((value) => ({
        value,
        timestampMs: value.kind === "turn" ? protocolTimestampMs(value.turn.startedAt) : null,
      })),
      pending.map((value) => ({ value, timestampMs: value.createdAt })),
    );
  })();
  const timelinePositioned = timeline.length === 0
    ? loadState.phase === "ready" || loadState.phase === "error"
    : timelinePositionedScope === composerScope;

  const visibleQueuedPrompts = queuedPrompts;
  const inlineQueue = visibleQueuedPrompts.map((entry) => ({ id: entry.commandId, text: entry.text, state: entry.state }));

  const deferredThreadSearch = useDeferredValue(threadSearch);
  const threadSearchMatches = (() => {
    const query = deferredThreadSearch.trim().toLocaleLowerCase();
    if (query === "") return [];
    return timeline.flatMap((item, index) => timelineSearchText(item).toLocaleLowerCase().includes(query) ? [index] : []);
  })();
  const threadSearchActive = threadSearch.trim() !== "";
  const displayedTimeline = threadSearchActive
    ? threadSearchMatches.flatMap((index) => timeline[index] === undefined ? [] : [timeline[index]])
    : timeline;
  const emptyRemoteThread = !demo
    && remoteThread !== null
    && remoteThread !== undefined
    && remoteThread.turns.length === 0
    && optimistic.length === 0;
  const updateFollowingLatest = (value: boolean) => {
    followingLatestRef.current = value;
    setTimelineTailFollowEnabled((current) => current === value ? current : value);
  };
  const respondToRequest = async (request: PendingServerRequest, result: unknown) => {
    if (onRespondToRequest === undefined) throw new Error("Request response is unavailable");
    await onRespondToRequest(request, result);
  };
  const getStableTransferAccess = async (forceRefresh = false) => {
    if (getTransferAccess === undefined) throw new Error("File access is unavailable");
    return await getTransferAccess(forceRefresh);
  };
  const openThreadResources = (kind: "changes" | "attachments") => {
    if (kind === "changes") {
      dismissComposerKeyboardForOverlay();
      if (threadResources?.value !== null && threadResources?.value !== undefined) {
        presentThreadChanges(threadResources.value.changes);
        return;
      }
      void onLoadThreadResources?.().then(
        (value) => presentThreadChanges(value.changes),
        (cause: unknown) => dialog.alert("Changes unavailable", cause instanceof Error ? cause.message : "Could not load changes"),
      );
      return;
    }
    timelineOverlay.begin("thread-resources");
    dismissComposerKeyboardForOverlay();
    setThreadResourceSheet("attachments");
    void onLoadThreadResources?.().catch(() => undefined);
  };
  const closeThreadResources = () => {
    setThreadResourceSheet(null);
    timelineOverlay.end("thread-resources");
  };
  const openDocumentLinkFromCwd = (href: string, sourceCwd: string) => {
    const loopback = parseLoopbackLink(href);
    if (loopback !== null && onOpenLoopbackLink !== undefined) {
      void onOpenLoopbackLink(loopback).catch((cause: unknown) => {
        dialog.alert("Could not open localhost", cause instanceof Error ? cause.message : "The forwarded URL could not be opened.");
      });
      return true;
    }
    if (getTransferAccess === undefined) return false;
    const target = resolvePreviewableDocumentLink(href, sourceCwd);
    if (target === null) return false;
    const request = { ...target, getTransferAccess: getStableTransferAccess };
    if (target.kind === "text") openCodeDocument(request);
    else openDocument(request);
    return true;
  };
  const openThreadDocumentLink = (href: string) => openDocumentLinkFromCwd(href, cwd);
  const fixUnsupportedBlock = async (block: RenderBlock) => {
    if (onFixUnsupportedBlock === undefined) throw new Error("Renderer repair is unavailable");
    await onFixUnsupportedBlock(block);
  };
  const forkThroughTurn = async (turnId: string) => {
    if (onFork === undefined) throw new Error("Thread fork is unavailable");
    await onFork({ boundary: { kind: "through", turnId }, ephemeral: false });
  };
  const loadStableTurnItems = async (turnId: string) => {
    if (onLoadTurnItems === undefined) throw new Error("Turn activity is unavailable");
    await onLoadTurnItems(turnId);
  };
  const renderTimelineItem = ({ item }: LegendListRenderItemProps<TimelineItem>) => {
    const boundaryKey = item.kind === "turn" || item.kind === "meta"
      ? item.key
      : `${item.scope}\u0000${item.id}`;
    const boundaryContext = item.kind === "turn"
      ? `Thread: ${item.threadId}\nTurn: ${item.id}`
      : `Timeline item: ${boundaryKey}`;
    const usage = item.kind === "turn" ? projectedTurnMetadata(item.turn)?.usage ?? null : null;
    return (
    <RecoverableRenderBoundary scope="bubble" label="Conversation item" context={boundaryContext} resetKey={boundaryKey}>
    <MarkdownLocalLinkProvider onOpen={openThreadDocumentLink}>
    <PrivateImageAccessProvider scope={composerScope} {...(getTransferAccess === undefined ? {} : { getAccess: getStableTransferAccess })}>
    <View style={[styles.timelineItem, !timelineCompact && styles.timelineItemWide]}>
      {item.kind === "turn" && (
        <TurnTimelineItem
          turn={item}
          compact={timelineCompact}
          usage={usage}
          forceExpanded={threadSearchActive}
          pendingRequest={item.turn.status === "inProgress" ? pendingRequest : null}
          pendingRequestCount={pendingRequestCount}
          {...(onRespondToRequest === undefined ? {} : { onRespondToRequest: respondToRequest })}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess: getStableTransferAccess })}
          {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock: fixUnsupportedBlock })}
          {...(onFork === undefined ? {} : { onForkThroughTurn: forkThroughTurn })}
          {...(onLoadTurnItems === undefined ? {} : { onLoadItems: loadStableTurnItems })}
        />
      )}
      {item.kind === "optimistic" && <OptimisticTurn item={item} {...(onRetryFailedMessage === undefined ? {} : { onRetry: onRetryFailedMessage })} />}
      {item.kind === "meta" && (
        <View style={styles.turnMeta}>
          <Ionicons
            name={item.status === "failed" ? "close" : item.status === "interrupted" ? "stop" : item.status === "inProgress" ? "ellipsis-horizontal" : "checkmark"}
            size={15}
            color={item.status === "failed" ? colors.red : item.status === "inProgress" ? colors.amber : colors.green}
          />
          <Text style={styles.turnMetaText}>{formatTurnMeta(item.status, item.durationMs, item.completedAt)}</Text>
        </View>
      )}
    </View>
    </PrivateImageAccessProvider>
    </MarkdownLocalLinkProvider>
    </RecoverableRenderBoundary>
    );
  };

  const scrollToThreadSearchIndex = (index: number) => {
    void timelineRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
  };

  const restoreThreadSearchOrigin = () => {
    const offset = searchOriginOffsetRef.current;
    if (offset === null) return;
    searchOriginOffsetRef.current = null;
    if (timelineIndexRetryTimerRef.current !== null) clearTimeout(timelineIndexRetryTimerRef.current);
    timelineIndexRetryTimerRef.current = setTimeout(() => {
      timelineIndexRetryTimerRef.current = null;
      timelineRef.current?.scrollToOffset({
        offset: Math.max(0, timelineContentHeightRef.current - timelineViewportHeightRef.current - offset),
        animated: false,
      });
    }, 96);
  };
  const updateThreadSearch = (value: string) => {
    const nextActive = value.trim() !== "";
    if (!threadSearchActive && nextActive && searchOriginOffsetRef.current === null) {
      searchOriginOffsetRef.current = scrollOffsetRef.current;
    } else if (threadSearchActive && !nextActive) {
      restoreThreadSearchOrigin();
    }
    setThreadSearch(value);
  };
  const closeThreadSearch = () => {
    updateThreadSearch("");
    setThreadSearchVisible(false);
  };

  const moveThreadSearch = (delta: -1 | 1) => {
    if (threadSearchMatches.length === 0) return;
    const next = (threadSearchMatch + delta + threadSearchMatches.length) % threadSearchMatches.length;
    setThreadSearchMatch(next);
    scrollToThreadSearchIndex(next);
  };

  const scheduleInitialTimelinePosition = (measuredHeight?: number) => {
    const resolvedHeight = measuredHeight ?? timelineContentHeightRef.current;
    const pendingOffset = pendingRestoreOffsetRef.current;
    if (pendingOffset === null || timeline.length === 0 || timelineViewportHeightRef.current === 0) return;
    const scope = composerScope;
    if (pendingOffset <= 1) {
      scrollOffsetRef.current = 0;
      updateFollowingLatest(true);
      awayFromLatestRef.current = false;
      setAwayFromLatest(false);
      pendingRestoreOffsetRef.current = null;
      scrollRestoredRef.current = true;
      setTimelinePositionedScope(scope);
      return;
    }
    if (resolvedHeight === 0) return;
    if (timelinePositionTimerRef.current !== null) clearTimeout(timelinePositionTimerRef.current);
    requestAnimationFrame(() => {
      const contentHeight = timelineContentHeightRef.current;
      timelineRef.current?.scrollToOffset({
        offset: Math.max(0, contentHeight - timelineViewportHeightRef.current - pendingOffset),
        animated: false,
      });
      scrollOffsetRef.current = pendingOffset;
      updateFollowingLatest(pendingOffset <= LATEST_TIMELINE_THRESHOLD_PX);
      awayFromLatestRef.current = pendingOffset > LATEST_TIMELINE_THRESHOLD_PX;
      setAwayFromLatest(awayFromLatestRef.current);
      pendingRestoreOffsetRef.current = null;
      scrollRestoredRef.current = true;
      setTimelinePositionedScope(scope);
    });
  };
  const requestOlderTurns = () => {
    if (
      timelineOverlay.isActive()
      || !scrollRestoredRef.current
      || timelineInteractionScopeRef.current !== composerScope
      || olderLoadInFlightRef.current
      || loadState.nextCursor === null
      || loadState.loadingOlder
      || onLoadOlder === undefined
    ) return;
    const scope = composerScope;
    olderLoadInFlightRef.current = true;
    void onLoadOlder().finally(() => {
      olderLoadInFlightRef.current = false;
    });
  };

  const requestNewerTurns = () => {
    if (
      timelineOverlay.isActive()
      || !scrollRestoredRef.current
      || timelineInteractionScopeRef.current !== composerScope
      || loadState.residentOffset === 0
      || onRevealNewer === undefined
    ) return;
    void onRevealNewer();
  };

  const persistTimelineOffset = (offset: number) => {
    scrollOffsetRef.current = offset;
    sessionConversationScrollOffsets.set(composerScope, offset);
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (saveScrollOffset === undefined || draftConnectionId === null || draftThreadId === null) return;
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null;
      void saveScrollOffset(draftConnectionId, draftThreadId, offset).catch(() => undefined);
    }, 250);
  };

  const markTimelineAtLatest = () => {
    persistTimelineOffset(0);
    awayFromLatestRef.current = false;
    updateFollowingLatest(true);
    setAwayFromLatest(false);
    if (unread > 0) onViewedLatest?.();
  };

  const jumpTimelineToLatest = () => {
    // Do not hide the button optimistically. A virtualized list can defer or cancel an
    // animated scroll while variable-height cells are being materialized.
    // The real onScroll position confirms the jump and clears the badge.
    updateFollowingLatest(true);
    momentumActiveRef.current = false;
    void timelineRef.current?.scrollToEnd({ animated: false });
  };

  const reconcileTimelineEndPosition = (contentHeight: number, viewportHeight: number, offsetY: number, settleFollowing: boolean) => {
    const distance = Math.max(0, contentHeight - viewportHeight - offsetY);
    persistTimelineOffset(distance);
    if (!scrollRestoredRef.current) return;
    if (settleFollowing && distance <= LATEST_TIMELINE_THRESHOLD_PX) {
      markTimelineAtLatest();
      return;
    }
    if (distance > LATEST_TIMELINE_THRESHOLD_PX) {
      updateFollowingLatest(false);
      if (!awayFromLatestRef.current) {
        awayFromLatestRef.current = true;
        setAwayFromLatest(true);
      }
    }
  };

  const clearTimelineRuntime = () => {
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (timelinePositionTimerRef.current !== null) clearTimeout(timelinePositionTimerRef.current);
    if (timelineSettleTimerRef.current !== null) clearTimeout(timelineSettleTimerRef.current);
    if (timelineIndexRetryTimerRef.current !== null) clearTimeout(timelineIndexRetryTimerRef.current);
    scrollSaveTimerRef.current = null;
    timelinePositionTimerRef.current = null;
    timelineSettleTimerRef.current = null;
    timelineIndexRetryTimerRef.current = null;
    timelineOverlay.reset();
  };
  const transitionConversationScope = useEffectEvent(() => {
    const previous = mountedConversationScopeRef.current;
    if (previous.scope === composerScope) return;
    clearTimelineRuntime();
    if (scrollRestoredRef.current) {
      sessionConversationScrollOffsets.set(previous.scope, scrollOffsetRef.current);
      if (previous.saveScrollOffset !== undefined && previous.connectionId !== null && previous.threadId !== null) {
        void previous.saveScrollOffset(previous.connectionId, previous.threadId, scrollOffsetRef.current).catch(() => undefined);
      }
    }
    mountedConversationScopeRef.current = {
      scope: composerScope,
      connectionId: draftConnectionId,
      threadId: draftThreadId,
      saveScrollOffset,
    };

    const persistedOffset = composerState?.connectionId === draftConnectionId
      && composerState.threadId === draftThreadId
      ? composerState.scrollOffset
      : null;
    const restoreOffset = sessionConversationScrollOffsets.get(composerScope) ?? persistedOffset ?? 0;
    pendingRestoreOffsetRef.current = restoreOffset;
    scrollOffsetRef.current = restoreOffset;
    scrollRestoredRef.current = false;
    timelineContentHeightRef.current = 0;
    firstVisibleTimelineIndexRef.current = null;
    lastTimelineOffsetYRef.current = null;
    timelineInteractionScopeRef.current = "";
    olderLoadInFlightRef.current = false;
    momentumActiveRef.current = false;
    searchOriginOffsetRef.current = null;
    followingLatestRef.current = false;
    awayFromLatestRef.current = false;

    setTimelinePositionedScope("");
    setTimelineInteractionScope("");
    setTimelineTailFollowEnabled(false);
    setAwayFromLatest(false);
    setComposerTrayVisible(false);
    setThreadResourceSheet(null);
    fullscreenOverlay.dismissScope(previous.scope);
    setProjectPickerVisible(false);
    setProjectChangeBusy(false);
    setProjectChangeError(null);
    setMenuVisible(false);
    setThreadRenameVisible(false);
    setThreadSearchVisible(false);
    setThreadSearch("");
    setThreadSearchMatch(0);
    setControlError(null);
    draftSelectionRef.current = { start: 0, end: 0 };
    composerContentHeightRef.current = 0;
    setComposerInputHeight(draft === "" ? COMPOSER_MIN_HEIGHT : composerHeightForContent(draft, 0));
  });
  useLayoutEffect(() => {
    transitionConversationScope();
  }, [composerScope, draftConnectionId, draftThreadId]);

  const cleanUpTimeline = useEffectEvent(() => {
    clearTimelineRuntime();
    const current = mountedConversationScopeRef.current;
    pendingRestoreOffsetRef.current = null;
    if (scrollRestoredRef.current) sessionConversationScrollOffsets.set(current.scope, scrollOffsetRef.current);
    if (current.saveScrollOffset !== undefined && current.connectionId !== null && current.threadId !== null) {
      void current.saveScrollOffset(current.connectionId, current.threadId, scrollOffsetRef.current).catch(() => undefined);
    }
  });
  useEffect(() => {
    return cleanUpTimeline;
  }, []);

  const handleAndroidBack = useEffectEvent(() => onBack?.());
  const androidBackEnabled = Platform.OS === "android" && compact && onBack !== undefined;
  useEffect(() => {
    if (!androidBackEnabled) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handleAndroidBack();
      return true;
    });
    return () => subscription.remove();
  }, [androidBackEnabled]);

  const composerSeedTaskKey = demo
    || !composerStateMissing
    || loadDraft === undefined
    || draftConnectionId === null
    || draftThreadId === null
      ? null
      : `composer-seed:${composerScope}`;
  useAsyncResource<boolean>("active-composer-seed", composerSeedTaskKey ?? "inactive", async () => {
    if (composerSeedTaskKey === null) return false;
    // Migration/read owns the transition into the TanStack row. React only
    // observes that row and never mirrors the native composer state locally.
    await loadDraft?.(draftConnectionId as string, draftThreadId as string);
    return true;
  });

  const updateDraft = (text: string) => {
    if (demo) setDemoDraft(text);
    if (text === "") composerContentHeightRef.current = 0;
    setComposerInputHeight(composerHeightForContent(text, composerContentHeightRef.current));
    if (saveDraft === undefined || draftConnectionId === null || draftThreadId === null) return;
    void saveDraft(draftConnectionId, draftThreadId, text).catch(() => undefined);
  };

  const updateAttachments = (next: ComposerAttachment[]) => {
    if (demo) setDemoAttachments(next);
    if (saveDraftAttachments === undefined || draftConnectionId === null || draftThreadId === null) return;
    void saveDraftAttachments(draftConnectionId, draftThreadId, next).catch(() => undefined);
  };

  const insertSkillInvocation = (skill: { name: string; path: string }) => {
    const selection = draftSelectionRef.current;
    const invocation = `$${skill.name} `;
    const current = draft;
    const next = `${current.slice(0, selection.start)}${invocation}${current.slice(selection.end)}`;
    const cursor = selection.start + invocation.length;
    updateDraft(next);
    draftSelectionRef.current = { start: cursor, end: cursor };
    voiceController?.setPendingSelection(composerScope, { start: cursor, end: cursor });
    setMenuVisible(false);
    timelineOverlay.end("composer-menu");
  };

  const insertImageAnnotations = (annotationText: string) => {
    const selection = draftSelectionRef.current;
    const current = draft;
    const before = current.slice(0, selection.start);
    const after = current.slice(selection.end);
    const prefix = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const suffix = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const insertion = `${prefix}${annotationText}${suffix}`;
    const next = `${before}${insertion}${after}`;
    const cursor = before.length + insertion.length;
    updateDraft(next);
    draftSelectionRef.current = { start: cursor, end: cursor };
    voiceController?.setPendingSelection(composerScope, { start: cursor, end: cursor });
  };
  useImagePreviewAnnotationHandler(insertImageAnnotations);

  const send = (textOverride?: string, preference: ComposerSendPreference = "start") => {
    // Voice completion passes its final draft explicitly. Reading `draft`
    // here would use the render captured when recording started and can send
    // the pre-transcription text instead of the latest transcript.
    const text = (textOverride ?? draft).trim();
    const sentAttachments = attachments;
    if ((!text && sentAttachments.length === 0) || onSend === undefined) return;
    const scope = composerScope;
    // Delivery mode is a one-shot command for this draft. Normal Send uses the
    // durable queue while a turn is active and starts immediately when idle;
    // opening the long-press menu must never mutate a persisted default.
    const mode: SendMode = resolveComposerSendMode(preference, threadLifecycleActive, currentTurnId);
    const skills = controls.skills.filter((skill) => selectedSkills.includes(skill.path)).map(({ name, path }) => ({ name, path }));
    const operation = onSend(text, mode, {
      ...(selectedModel === null ? {} : { model: selectedModel }),
      ...(selectedEffort === null ? {} : { effort: selectedEffort }),
      ...(selectedPersonality === null ? {} : { personality: selectedPersonality }),
      ...(selectedPermissions === null ? {} : { permissions: selectedPermissions }),
      ...(skills.length === 0 ? {} : { skills }),
      ...(sentAttachments.length === 0 ? {} : { attachments: sentAttachments }),
    });
    updateDraft("");
    updateAttachments([]);
    if (mode.type !== "queue") {
      // Sending is an explicit request to resume tail-following. Coordinate
      // the jump with LegendList's native keyboard integration instead of
      // waiting for a later content-size mutation to snap the viewport.
      updateFollowingLatest(true);
      requestAnimationFrame(() => {
        void timelineRef.current?.scrollToEnd({ animated: false });
      });
    }
    void operation.then(() => {
      if (mode.type === "queue" && onListQueue !== undefined) {
        void onListQueue().catch(() => undefined);
      }
    }).catch(() => {
      // Native persistence failed before Kotlin accepted ownership. Restore
      // the composer; successful submissions are rendered exclusively from
      // the TanStack delivery/queue collections.
      if (mountedConversationScopeRef.current.scope === scope) {
        updateDraft(text);
        updateAttachments(sentAttachments);
        return;
      }
      // The user already navigated away. Restore the failed submission in its
      // owning thread without mutating the newly selected composer's local UI.
      if (saveDraft !== undefined && draftConnectionId !== null && draftThreadId !== null) {
        void saveDraft(draftConnectionId, draftThreadId, text).catch(() => undefined);
      }
      if (saveDraftAttachments !== undefined && draftConnectionId !== null && draftThreadId !== null) {
        void saveDraftAttachments(draftConnectionId, draftThreadId, sentAttachments).catch(() => undefined);
      }
    });
  };

  const openControls = (initialPage: ComposerMenuPage) => {
    setComposerTrayVisible(false);
    timelineOverlay.begin("composer-menu");
    dismissComposerKeyboardForOverlay();
    setMenuInitialPage(initialPage);
    setMenuVisible(true);
    // A failed/background prefetch may be retried, but an already loaded sheet
    // never refetches its model, skill and permission lists.
    if ((controlsResource === null || controlsResource.status === "error") && !controlsLoading) requestControls();
  };
  const closeControls = () => {
    setMenuVisible(false);
    timelineOverlay.end("composer-menu");
  };
  const openQuickControlMenu = (scope: "model-menu" | "permissions-menu") => {
    setComposerTrayVisible(false);
    timelineOverlay.begin(scope);
    dismissComposerKeyboardForOverlay();
    if ((controlsResource === null || controlsResource.status === "error") && !controlsLoading) requestControls();
  };
  const closeQuickControlMenu = (scope: "model-menu" | "permissions-menu") => {
    timelineOverlay.end(scope);
  };
  const openProjectPicker = () => {
    if (onChangeProject === undefined) return;
    timelineOverlay.begin("project-picker");
    dismissComposerKeyboardForOverlay();
    setProjectChangeError(null);
    setProjectPickerVisible(true);
  };
  const closeProjectPicker = () => {
    setProjectPickerVisible(false);
    timelineOverlay.end("project-picker");
  };
  const selectProject = async (nextCwd: string | null) => {
    if (onChangeProject === undefined || projectChangeBusy) return;
    const scope = composerScope;
    setProjectChangeBusy(true);
    setProjectChangeError(null);
    const cause = await onChangeProject(nextCwd).then(() => null, (error: unknown) => error);
    if (mountedConversationScopeRef.current.scope !== scope) return;
    setProjectChangeBusy(false);
    if (cause === null) {
      closeProjectPicker();
    } else {
      setProjectChangeError(cause instanceof Error ? cause.message : "Could not change project");
    }
  };
  const openThreadRename = () => {
    timelineOverlay.begin("thread-rename");
    setThreadRenameVisible(true);
  };
  const closeThreadRename = () => {
    setThreadRenameVisible(false);
    timelineOverlay.end("thread-rename");
  };
  const openSubagents = (initialThreadId: string | null = null) => {
    if (draftConnectionId === null || draftThreadId === null || onReadSubagentThread === undefined) return;
    fullscreenOverlay.present(({ close }) => (
      <SubagentSheet
        connectionId={draftConnectionId}
        parentThreadId={draftThreadId}
        parentThread={remoteThread ?? null}
        summaries={subagents}
        summaryDatabase={subagentSummaryDatabase}
        threadDetails={subagentThreadDetails}
        onReadThread={onReadSubagentThread}
        initialThreadId={initialThreadId}
        {...(onRefreshSubagents === undefined ? {} : { onRefresh: async () => await onRefreshSubagents(draftThreadId) })}
        renderThread={({ summary, thread: subagentThread, compact: subagentCompact, onBack: onBackToSubagents, onOpenSubagent }) => (
          <RecoverableRenderBoundary
            scope="surface"
            label="Subagent conversation"
            context={`Connection: ${draftConnectionId}\nThread: ${subagentThread.id}`}
            resetKey={`${draftConnectionId}:${subagentThread.id}`}
            {...(onBackToSubagents === undefined ? {} : { onDismiss: onBackToSubagents })}
          >
          <ConversationPane
            thread={subagentDemoThread(summary, subagentThread, draftConnectionId)}
            server={server}
            compact={subagentCompact}
            readOnly
            {...(onBackToSubagents === undefined ? {} : { onBack: onBackToSubagents })}
            remoteThread={subagentThread}
            remoteSealedTurns={subagentThread.turns.filter((turn) => turn.status !== "inProgress")}
            remoteLiveTurns={subagentThread.turns.filter((turn) => turn.status === "inProgress")}
            cwd={subagentThread.cwd}
            subagents={subagents}
            subagentSummaryDatabase={subagentSummaryDatabase}
            subagentThreadDetails={subagentThreadDetails}
            onReadSubagentThread={onReadSubagentThread}
            onOpenSubagentThread={onOpenSubagent}
            {...(onRefreshSubagents === undefined ? {} : { onRefreshSubagents })}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock: fixUnsupportedBlock })}
          />
          </RecoverableRenderBoundary>
        )}
        onClose={close}
      />
    ));
  };
  const openTerminal = () => {
    if (draftConnectionId === null) return;
    fullscreenOverlay.present(({ close }) => (
      <TerminalWorkspace connectionId={draftConnectionId} cwd={cwd ?? null} onClose={close} />
    ));
  };
  const fileAttachmentEnabled = fileTransferController !== null
    && getTransferAccess !== undefined
    && draftThreadId !== null
    && fileTransferResource?.status !== "authorizing"
    && fileTransferResource?.status !== "running";
  const uploadSelectedAttachment = async (
    selected: SelectedUpload,
    onUploaded?: (attachment: ComposerAttachment) => void,
  ): Promise<ComposerAttachment | null> => {
    if (fileTransferController === null || getTransferAccess === undefined || draftThreadId === null) return null;
    let uploaded: ComposerAttachment | null = null;
    const commitUploaded = onUploaded ?? ((attachment: ComposerAttachment) => {
      updateAttachments([...attachments.filter((candidate) => candidate.id !== attachment.id), attachment]);
    });
    const remotePath = attachmentUploadPath(draftThreadId, selected.name);
    try {
      await fileTransferController.start({
        scope: composerScope,
        mode: "upload",
        rootId: ATTACHMENT_ROOT_ID,
        remotePath,
        overwrite: false,
        upload: selected,
        directory: null,
        getAccess: getStableTransferAccess,
        onUploaded: (attachment) => {
          uploaded = attachment;
          commitUploaded(attachment);
        },
      });
      return uploaded;
    } catch (cause) {
      dialog.alert(
        "Could not attach file",
        cause instanceof Error ? cause.message : "File upload failed",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: () => void uploadSelectedAttachment(selected) },
        ],
      );
      return null;
    }
  };
  const attachCodeReview = async (comments: readonly CodeReviewComment[]): Promise<boolean> => {
    if (comments.length === 0) return false;
    const selected = createTextUpload(
      `codex-review-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
      "text/markdown",
      serializeCodeReviewAttachment(comments),
    );
    return await uploadSelectedAttachment(selected) !== null;
  };
  function presentThreadChanges(changes: ThreadChangeResource[]) {
    fullscreenOverlay.present(({ close }) => (
      <CodeReviewWorkspace
        changes={changes}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceScope={`${composerScope}\u0000review`}
        voiceResource={reviewVoiceResource}
        voiceController={voiceController}
        getTransferAccess={getStableTransferAccess}
        onAttach={attachCodeReview}
        onClose={close}
        {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
        {...(onStartVoiceTranscription === undefined ? {} : { onStartVoiceTranscription })}
      />
    ));
  }
  const openCodeDocument = (request: DocumentPreviewRequest) => {
    fullscreenOverlay.present(({ close }) => (
      <CodeReviewWorkspace
        key={`${request.path}:${request.line ?? ""}:${request.column ?? ""}`}
        changes={codeReviewFilesForDocument(threadResources?.value?.changes ?? [], request.path)}
        initialPath={request.path}
        {...(request.line === undefined ? {} : { initialLine: request.line })}
        {...(request.column === undefined ? {} : { initialColumn: request.column })}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceScope={`${composerScope}\u0000review`}
        voiceResource={reviewVoiceResource}
        voiceController={voiceController}
        getTransferAccess={getStableTransferAccess}
        onAttach={attachCodeReview}
        onClose={close}
        onDownload={() => void downloadDocument(request)}
        {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
        {...(onStartVoiceTranscription === undefined ? {} : { onStartVoiceTranscription })}
      />
    ));
  };
  const pickComposerAttachment = async () => {
    setComposerTrayVisible(false);
    if (!fileAttachmentEnabled) return;
    timelineOverlay.begin("file-picker");
    dismissComposerKeyboardForOverlay();
    const selected = await pickUploadFile().catch((cause): null => {
      dialog.alert("Could not choose file", cause instanceof Error ? cause.message : "System file picker failed");
      return null;
    });
    timelineOverlay.end("file-picker");
    if (selected !== null) await uploadSelectedAttachment(selected);
  };
  const pickQueuedAttachment = async (): Promise<ComposerAttachment | null> => {
    if (!fileAttachmentEnabled) return null;
    timelineOverlay.begin("queue-file-picker");
    dismissComposerKeyboardForOverlay();
    const selected = await pickUploadFile().catch((cause): null => {
      dialog.alert("Could not choose file", cause instanceof Error ? cause.message : "System file picker failed");
      return null;
    });
    timelineOverlay.end("queue-file-picker");
    if (selected === null) return null;
    return await uploadSelectedAttachment(selected, () => undefined);
  };
  const openAccessoryAction = (action: ComposerAccessoryAction) => {
    if (action === "files") {
      void pickComposerAttachment();
      return;
    }
    openControls(action);
    if (action === "goal") void onGetGoal?.();
    else if (action === "runtime") void onListTerminals?.();
  };
  const useAnchoredComposerMenu = Platform.OS === "android";
  const anchoredComposerActions: ActionMenuItem[] = [
    { id: "files", label: "Attach file", icon: "attach-outline", disabled: !fileAttachmentEnabled },
    { id: "skills", label: "Skills", icon: "sparkles-outline" },
    { id: "goal", label: "Goal", icon: "flag-outline" },
    { id: "runtime", label: "Runtime", icon: "terminal-outline", disabled: onListTerminals === undefined && onCreateTunnel === undefined && portForwarding === undefined },
  ];
  const handleAnchoredComposerAction = (id: string) => {
    if (id === "files" || id === "skills" || id === "goal" || id === "runtime") {
      openAccessoryAction(id);
    }
  };
  const deliveryActions: ActionMenuItem[] = [
    { id: "start", label: "Send now", icon: "send-outline", disabled: threadLifecycleActive },
    { id: "queue", label: "Queue after current turn", icon: "time-outline", disabled: !threadLifecycleActive },
    { id: "steer", label: "Steer active turn", icon: "navigate-outline", disabled: currentTurnId === null },
  ];
  const handleDeliveryAction = (id: string) => {
    if (id === "start" || id === "queue" || id === "steer") send(undefined, id);
  };
  const selectModel = (model: string, effort: string) => {
    const scope = composerScope;
    const previousModel = selectedModel;
    const previousEffort = selectedEffort;
    setSelectedModel(model);
    setSelectedEffort(effort);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ model, effort }).catch((cause) => {
      setSelectedModel((current) => current === model ? previousModel : current);
      setSelectedEffort((current) => current === effort ? previousEffort : current);
      if (mountedConversationScopeRef.current.scope === scope) {
        setControlError(cause instanceof Error ? cause.message : "Could not update model settings");
      }
    });
  };

  const selectEffort = (effort: string) => {
    const scope = composerScope;
    const previous = selectedEffort;
    setSelectedEffort(effort);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ effort }).catch((cause) => {
      setSelectedEffort((current) => current === effort ? previous : current);
      if (mountedConversationScopeRef.current.scope === scope) {
        setControlError(cause instanceof Error ? cause.message : "Could not update thinking effort");
      }
    });
  };

  const selectPermissions = (permissions: string | null) => {
    const scope = composerScope;
    const previous = selectedPermissions;
    setSelectedPermissions(permissions);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ permissions }).catch((cause) => {
      setSelectedPermissions((current) => current === permissions ? previous : current);
      if (mountedConversationScopeRef.current.scope === scope) {
        setControlError(cause instanceof Error ? cause.message : "Could not update permissions");
      }
    });
  };

  const bindVoiceController = () => {
    if (voiceController === null) return;
    voiceController.bind({
      scope: composerScope,
      source: () => draft,
      selection: () => draftSelectionRef.current,
      thread: remoteThread,
      updateDraft,
      send,
      ...(onStartVoiceTranscription === undefined
        ? {}
        : { startRemote: onStartVoiceTranscription }),
    });
  };

  const finishVoice = async (sendAfter: boolean) => {
    await voiceController?.finish(sendAfter);
  };
  const retryVoice = async () => {
    bindVoiceController();
    await voiceController?.retry();
  };
  const toggleVoice = async () => {
    bindVoiceController();
    await voiceController?.toggle();
  };

  if (thread === null) {
    return (
      <View style={styles.emptyConversation}>
        <Ionicons name="chatbubbles-outline" size={36} color={colors.textDim} />
        <Text style={styles.emptyText}>Select a thread</Text>
      </View>
    );
  }

  const serverActivity = server === undefined ? null : connectionActivity(server.status);
  const conversationActivity = serverActivity
    ?? (loadState.phase === "loading" || loadState.phase === "refreshing" || !timelinePositioned ? "updating" : null);
  const conversationSubtitle = conversationActivity === "connecting"
    ? "connecting…"
    : conversationActivity === "updating"
      ? "updating…"
      : currentTurnId !== null
        ? "typing…"
        : threadContextLabel(server?.name ?? "", cwd);
  const conversationSubtitleColor = conversationActivity !== null
    ? connectionActivityColor(conversationActivity)
    : currentTurnId !== null
      ? colors.accent
      : colors.textMuted;
  const stoppingResponse = currentTurnId !== null && voicePhase === "idle" && draft.trim() === "" && attachments.length === 0;
  const sendDisabled = voicePhase === "finishing"
    || (voicePhase === "idle" && !stoppingResponse && draft.trim() === "" && attachments.length === 0);
  return (
    <AppFullscreenOverlayBoundary scope={composerScope} lifecycle={fullscreenOverlayLifecycle}>
    <SubagentNavigationContext.Provider value={onOpenSubagentThread
      ?? (draftConnectionId !== null && draftThreadId !== null && onReadSubagentThread !== undefined
        ? (threadId) => openSubagents(threadId)
        : null)}>
    <LargeContentViewerHost>
    <View
      testID="thread-detail-pane-shell"
      style={styles.conversation}
      onLayout={({ nativeEvent }) => {
        const paneWidth = Math.max(0, Math.floor(nativeEvent.layout.width));
        setConversationPaneWidth((current) => current === paneWidth ? current : paneWidth);
        const next = paneWidth < 520;
        setNarrowConversationPane((current) => current === next ? current : next);
      }}
    >
    <View testID="thread-detail-pane" style={styles.conversationKeyboard}>
      <View testID="conversation-header" style={styles.conversationHeader}>
        {compact && (
          <Pressable onPress={onBack} style={styles.headerIcon} accessibilityLabel="Back to threads">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        )}
        <View style={styles.conversationIdentity}>
          <Text testID="conversation-title" numberOfLines={1} ellipsizeMode="tail" style={styles.conversationTitle}>
            {emojiSafeTitle(thread.title)}
          </Text>
          <Text testID="conversation-subtitle" numberOfLines={1} ellipsizeMode="middle" style={[styles.conversationSubtitle, { color: conversationSubtitleColor }]}> 
            {conversationSubtitle}
          </Text>
        </View>
        <Pressable onPress={() => { if (threadSearchVisible) closeThreadSearch(); else setThreadSearchVisible(true); }} style={styles.headerIcon} accessibilityLabel="Search in thread">
          <Ionicons name="search" size={21} color={colors.text} />
        </Pressable>
        <UsagePopover
          thread={remoteThread ?? null}
          model={effectiveModel}
          compactionCount={sessionCompactionCount}
          rateLimits={accountRateLimits}
          placement="bottom"
          align="end"
          {...(onRefreshAccountRateLimits === undefined ? {} : { onRefresh: onRefreshAccountRateLimits })}
        >
          <Pressable accessibilityLabel="Context usage and account limits" style={styles.headerIcon}>
            <ContextRing percent={currentThreadContextUsage(remoteThread)?.usedPercent ?? 0} size={22} />
          </Pressable>
        </UsagePopover>
        {!readOnly && <ThreadHeaderMenu
          key={thread.id}
          threadId={thread.id}
          archived={archived}
          pinned={pinned}
          onOpenMenu={dismissComposerKeyboardForOverlay}
          onOpenTerminal={openTerminal}
          onRenameRequest={openThreadRename}
          {...(onTogglePin === undefined ? {} : { onTogglePin })}
          {...(archived
            ? (onUnarchive === undefined ? {} : { onUnarchive })
            : (onArchive === undefined ? {} : { onArchive }))}
          {...(onCompact === undefined ? {} : { onCompact })}
          {...(onFork === undefined ? {} : { onFork })}
          {...(onDelete === undefined ? {} : { onDelete })}
        />}
      </View>

      {threadSearchVisible && (
        <View style={styles.threadSearchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            autoFocus
            accessibilityLabel="Search current thread"
            value={threadSearch}
            onChangeText={(value) => {
              updateThreadSearch(value);
              setThreadSearchMatch(0);
              requestAnimationFrame(() => scrollToThreadSearchIndex(0));
            }}
            placeholder="Find in thread"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
          />
          <Text style={styles.threadSearchCount}>{threadSearchMatches.length === 0 ? "0" : `${threadSearchMatch + 1}/${threadSearchMatches.length}`}</Text>
          {!compact && <Pressable accessibilityLabel="Previous match" onPress={() => moveThreadSearch(-1)} style={styles.headerIcon}><Ionicons name="chevron-up" size={19} color={colors.text} /></Pressable>}
          <Pressable accessibilityLabel="Next match" onPress={() => moveThreadSearch(1)} style={styles.headerIcon}><Ionicons name="chevron-down" size={19} color={colors.text} /></Pressable>
          <Pressable accessibilityLabel="Close thread search" onPress={closeThreadSearch} style={styles.headerIcon}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
        </View>
      )}

      <KeyboardGestureArea
        enableSwipeToDismiss
        interpolator="ios"
        offset={conversationInsets.bottom}
        style={styles.conversationKeyboardBody}
        onTouchStart={() => setComposerTrayVisible(false)}
      >
      <ThreadCwdContext.Provider value={cwd}>
      <ThreadCodeDocumentContext.Provider value={openCodeDocument}>
      <RichContentWidthProvider width={richContentWidth}>
      <View style={styles.timelineShell}>
      <ThreadTimelineList
        ref={timelineRef}
        freeze={timelineOverlayFreeze}
        testID="conversation-timeline"
        data={displayedTimeline}
        extraData={`${threadSearch}:${threadSearchMatch}:${windowLayout.measurementRevision}`}
        renderRevision={`${composerScope}:${windowLayout.measurementRevision}`}
        style={StyleSheet.flatten([styles.conversationScroll, !timelinePositioned && styles.timelineConcealed])}
        contentContainerStyle={[styles.conversationContent, timelineCompact ? styles.conversationContentCompact : styles.conversationContentWide]}
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={conversationInsets.bottom}
        maintainScrollAtEndEnabled={timelineTailFollowEnabled}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPositionEnabled={!threadSearchActive}
        getItemType={(item) => item.kind}
        scrollEventThrottle={16}
        onLoad={({ elapsedTimeInMs }) => {
          recordTiming("timeline_first_draw_ms", elapsedTimeInMs);
          scheduleInitialTimelinePosition();
        }}
        onLayout={({ nativeEvent }) => {
          timelineViewportHeightRef.current = nativeEvent.layout.height;
          if (timelineOverlay.isActive()) {
            timelineOverlay.restore(false);
            return;
          }
          scheduleInitialTimelinePosition();
        }}
        onScrollBeginDrag={({ nativeEvent }) => {
          if (threadSearchActive || timelineOverlay.isActive()) return;
          timelineInteractionScopeRef.current = composerScope;
          lastTimelineOffsetYRef.current = nativeEvent.contentOffset.y;
          updateFollowingLatest(false);
          momentumActiveRef.current = false;
          if (timelineSettleTimerRef.current !== null) clearTimeout(timelineSettleTimerRef.current);
          setTimelineInteractionScope(composerScope);
        }}
        onScroll={({ nativeEvent }) => {
          timelineViewportHeightRef.current = nativeEvent.layoutMeasurement.height;
          timelineContentHeightRef.current = nativeEvent.contentSize.height;
          if (timelineOverlay.observeNativeOffset(nativeEvent.contentOffset.y) || threadSearchActive) return;
          const previousOffsetY = lastTimelineOffsetYRef.current;
          const scrollingTowardOlder = previousOffsetY !== null && nativeEvent.contentOffset.y < previousOffsetY;
          lastTimelineOffsetYRef.current = nativeEvent.contentOffset.y;
          if (shouldPrefetchOlderPage(firstVisibleTimelineIndexRef.current, scrollingTowardOlder)) requestOlderTurns();
          const distance = Math.max(0, nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y);
          scrollOffsetRef.current = distance;
          if (!scrollRestoredRef.current) return;
          const away = distance > LATEST_TIMELINE_THRESHOLD_PX;
          const wasAway = awayFromLatestRef.current;
          if (awayFromLatestRef.current !== away) {
            awayFromLatestRef.current = away;
            setAwayFromLatest(away);
          }
          if (!away && wasAway && followingLatestRef.current) markTimelineAtLatest();
        }}
        onScrollEndDrag={({ nativeEvent }) => {
          if (threadSearchActive || timelineOverlay.isActive()) return;
          reconcileTimelineEndPosition(nativeEvent.contentSize.height, nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y, false);
          if (timelineSettleTimerRef.current !== null) clearTimeout(timelineSettleTimerRef.current);
          timelineSettleTimerRef.current = setTimeout(() => {
            timelineSettleTimerRef.current = null;
            if (!momentumActiveRef.current && scrollOffsetRef.current <= LATEST_TIMELINE_THRESHOLD_PX) markTimelineAtLatest();
          }, 96);
        }}
        onMomentumScrollBegin={() => {
          if (threadSearchActive || timelineOverlay.isActive()) return;
          momentumActiveRef.current = true;
          if (timelineSettleTimerRef.current !== null) clearTimeout(timelineSettleTimerRef.current);
          timelineSettleTimerRef.current = null;
        }}
        onMomentumScrollEnd={({ nativeEvent }) => {
          if (threadSearchActive || timelineOverlay.isActive()) return;
          momentumActiveRef.current = false;
          reconcileTimelineEndPosition(nativeEvent.contentSize.height, nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y, true);
        }}
        onContentSizeChange={(_width, height) => {
          timelineContentHeightRef.current = height;
          if (timelineOverlay.isActive()) {
            timelineOverlay.restore(false);
            return;
          }
          if (threadSearchActive) return;
          if (pendingRestoreOffsetRef.current !== null) {
            // Variable-height cells only expose a reliable total height after
            // LegendList has materialized its tail. Keep that jump concealed.
            scheduleInitialTimelinePosition(height);
          }
        }}
        onStartReached={!threadSearchActive && timelineInteracted ? requestOlderTurns : undefined}
        onStartReachedThreshold={0.5}
        onEndReached={!threadSearchActive && timelineInteracted ? requestNewerTurns : undefined}
        onEndReachedThreshold={0.25}
        viewabilityConfig={timelineViewabilityConfig}
        onViewableItemsChanged={onTimelineViewableItemsChanged}
        keyExtractor={timelineItemKey}
        ListHeaderComponent={loadState.loadingOlder ? (
          <View style={styles.timelineHeaderContent}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null}
        ListEmptyComponent={
          <View style={styles.emptyConversation}>
            {emptyRemoteThread && !threadSearchActive ? (
              <View testID="new-chat-empty-state" style={styles.newChatEmptyState}>
                <Text style={styles.newChatPrompt}>What would you like to work on?</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Change project, currently ${projectLabel(cwd) || "server default"}`}
                  onPress={openProjectPicker}
                  style={({ pressed }) => [styles.newChatProjectButton, pressed && styles.pressed]}
                >
                  <Text numberOfLines={1} style={styles.newChatProjectText}>in {projectLabel(cwd) || "server default"}</Text>
                  <Ionicons name="chevron-down" size={17} color={colors.accent} />
                </Pressable>
              </View>
            ) : (
              <>
                {!threadSearchActive && (loadState.phase === "loading" || loadState.phase === "refreshing") ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                <Text style={styles.emptyText}>{threadSearchActive ? "No matches" : loadState.phase === "error" ? loadState.error ?? "Could not load messages" : loadState.phase === "loading" || loadState.phase === "refreshing" ? "Loading messages…" : "Start by typing a message"}</Text>
              </>
            )}
          </View>
        }
        renderItem={renderTimelineItem}
      />
      {!timelinePositioned && timeline.length > 0 && (
        <View pointerEvents="none" testID="timeline-positioning-loader" style={styles.timelineLoadingOverlay}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      )}
      </View>
      </RichContentWidthProvider>
      </ThreadCodeDocumentContext.Provider>
      </ThreadCwdContext.Provider>
      </KeyboardGestureArea>

      <KeyboardStickyView
        enabled
        offset={{ closed: 0, opened: conversationInsets.bottom }}
        style={styles.composerSticky}
      >
      {awayFromLatest && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={newItemCount > 0 ? `Jump to latest, ${newItemCount} new turns` : "Jump to latest"}
          testID="jump-to-latest"
          style={({ pressed }) => [styles.jumpToLatest, { bottom: composerDockHeight + spacing.xs }, pressed && styles.pressed]}
          onPress={jumpTimelineToLatest}
        >
          <Ionicons name="chevron-down" size={22} color={colors.onPrimaryContainer} />
          {newItemCount > 0 && (
            <View style={styles.jumpToLatestBadge}>
              <Text accessibilityLiveRegion="polite" style={styles.jumpToLatestBadgeText}>{newItemCount > 99 ? "99+" : newItemCount}</Text>
            </View>
          )}
        </Pressable>
      )}

      {!readOnly && pendingRequest !== null && !timeline.some((item) => item.kind === "turn" && item.turn.status === "inProgress") && (
        <ApprovalPrompt
          key={pendingRequest.requestKey}
          request={pendingRequest}
          requestCount={pendingRequestCount}
          {...(onRespondToRequest === undefined ? {} : { onRespond: onRespondToRequest })}
        />
      )}
      <View
        testID="composer-dock"
        style={styles.composerDock}
        onLayout={(event) => {
          const { nativeEvent } = event;
          const nextHeight = Math.ceil(nativeEvent.layout.height);
          setComposerDockHeight((current) => Math.abs(current - nextHeight) < 1 ? current : nextHeight);
        }}
      >
      <ScrollView testID="composer-context-strip" horizontal showsHorizontalScrollIndicator={false} style={styles.composerContextStrip} contentContainerStyle={styles.composerContextContent}>
        {readOnly ? <View testID="readonly-model-chip" style={styles.composerContextChip}>
          <Ionicons name="sparkles-outline" size={15} color={colors.textMuted} />
          <ComposerContextLabel
            loading={modelLabelPending}
            testID="composer-model-label"
            text={modelLabelPending ? "Loading model…" : `${effectiveModelLabel} · ${effectiveEffort ?? "default"}`}
          />
        </View> : <ModelThinkingMenu
          accessibilityLabel={`Model and thinking: ${effectiveModelLabel}, ${effectiveEffort ?? "server default"}`}
          triggerStyle={styles.composerContextChip}
          triggerChildren={<>
            <Ionicons name="sparkles-outline" size={15} color={colors.textMuted} />
            <ComposerContextLabel
              loading={modelLabelPending}
              testID="composer-model-label"
              text={modelLabelPending ? "Loading model…" : `${effectiveModelLabel} · ${effectiveEffort ?? "default"}`}
            />
          </>}
          models={controls.models}
          loading={controlsLoading}
          error={effectiveControlError}
          selectedModel={effectiveModel}
          selectedEffort={effectiveEffort}
          selectedPersonality={selectedPersonality}
          onOpen={() => openQuickControlMenu("model-menu")}
          onClose={() => closeQuickControlMenu("model-menu")}
          onFallbackPress={() => openControls("model")}
          onSelectModel={selectModel}
          onSelectEffort={selectEffort}
          onSelectPersonality={setSelectedPersonality}
        />}
        {readOnly ? <View testID="readonly-permissions-chip" style={styles.composerContextChip}>
          <Ionicons name="shield-checkmark-outline" size={15} color={colors.textMuted} />
          <ComposerContextLabel
            loading={permissionLabelPending}
            testID="composer-permissions-label"
            text={permissionLabelPending ? "Loading access…" : effectivePermissionLabel}
          />
        </View> : <PermissionsMenu
          accessibilityLabel={`Permissions: ${effectivePermissionLabel}`}
          triggerStyle={styles.composerContextChip}
          triggerChildren={<>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.textMuted} />
            <ComposerContextLabel
              loading={permissionLabelPending}
              testID="composer-permissions-label"
              text={permissionLabelPending ? "Loading access…" : effectivePermissionLabel}
            />
          </>}
          permissions={controls.permissions}
          loading={controlsLoading}
          error={effectiveControlError}
          selectedPermissions={effectivePermissions}
          onOpen={() => openQuickControlMenu("permissions-menu")}
          onClose={() => closeQuickControlMenu("permissions-menu")}
          onFallbackPress={() => openControls("permissions")}
          onSelectPermissions={selectPermissions}
        />}
        {onLoadThreadResources !== undefined && <Pressable
          accessibilityRole="button"
          accessibilityLabel={sessionChangesLabel}
          accessibilityState={{ disabled: sessionChangesEmpty }}
          disabled={sessionChangesEmpty}
          onPress={() => openThreadResources("changes")}
          style={[styles.composerContextChip, sessionChangesEmpty && styles.disabled]}
        >
          <Ionicons name="git-compare-outline" size={15} color={sessionChangesEmpty ? colors.textDim : colors.textMuted} />
          {threadResourcesPending || sessionChangesEmpty || threadResources?.status === "error" && threadResources.value === null
            ? <ComposerContextLabel loading={threadResourcesPending} testID="composer-changes-label" text={sessionChangesLabel} />
            : <ComposerContextCount label="Changes" value={sessionChangeCount} testID="composer-changes-label" />}
        </Pressable>}
        {onLoadThreadResources !== undefined && <Pressable
          accessibilityRole="button"
          accessibilityLabel={sessionAttachmentsLabel}
          accessibilityState={{ disabled: sessionAttachmentsEmpty }}
          disabled={sessionAttachmentsEmpty}
          onPress={() => openThreadResources("attachments")}
          style={[styles.composerContextChip, sessionAttachmentsEmpty && styles.disabled]}
        >
          <Ionicons name="attach-outline" size={15} color={sessionAttachmentsEmpty ? colors.textDim : colors.textMuted} />
          {threadResourcesPending || sessionAttachmentsEmpty || threadResources?.status === "error" && threadResources.value === null
            ? <ComposerContextLabel loading={threadResourcesPending} testID="composer-attachments-label" text={sessionAttachmentsLabel} />
            : <ComposerContextCount label="Attachments" value={sessionAttachmentCount} testID="composer-attachments-label" />}
        </Pressable>}
        {visibleSubagents.length > 0 && onReadSubagentThread !== undefined && <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Subagents: ${visibleSubagents.length}`}
          onPress={() => openSubagents()}
          style={styles.composerContextChip}
        >
          <Ionicons name="people-outline" size={15} color={visibleSubagents.some((summary) => summary.status.type === "active") ? colors.green : colors.textMuted} />
          <ComposerContextCount label="Subagents" value={visibleSubagents.length} />
        </Pressable>}
      </ScrollView>
      {!readOnly && <>
      {inlineQueue.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open queue, ${inlineQueue.length} messages`} onPress={() => openControls("queue")} style={styles.inlineQueueTray}>
          <View style={styles.inlineQueueHeader}>
            <Ionicons name="reorder-three-outline" size={17} color={colors.accent} />
            <Text style={styles.inlineQueueTitle}>Queue · {inlineQueue.length}</Text>
            <Ionicons name="chevron-up" size={15} color={colors.textMuted} />
          </View>
          {inlineQueue.slice(0, 2).map((entry) => <Text key={entry.id} numberOfLines={1} style={styles.inlineQueueText}>{entry.text}</Text>)}
        </Pressable>
      )}
      {voiceError !== null && <Text style={styles.composerError}>{voiceError}</Text>}
      {attachments.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.composerAttachments} contentContainerStyle={styles.composerAttachmentsContent}>
          {attachments.map((attachment) => (
            <View key={attachment.id} style={styles.composerAttachmentChip}>
              <Ionicons name={attachment.kind === "image" ? "image-outline" : attachment.kind === "audio" ? "musical-note-outline" : "document-attach-outline"} size={16} color={colors.textMuted} />
              <Text numberOfLines={1} style={styles.attachmentText}>{attachment.name}</Text>
              <Pressable hitSlop={12} accessibilityLabel={`Remove ${attachment.name}`} onPress={() => updateAttachments(attachments.filter((candidate) => candidate.id !== attachment.id))}>
                <Ionicons name="close" size={17} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {composerTrayVisible && !useAnchoredComposerMenu && (
        <ComposerAccessoryTray
          fileEnabled={fileAttachmentEnabled}
          runtimeEnabled={onListTerminals !== undefined || onCreateTunnel !== undefined || portForwarding !== undefined}
          onSelect={openAccessoryAction}
        />
      )}
      <View testID="composer-row" style={styles.composer}>
        {useAnchoredComposerMenu ? (
          <ActionMenu
            accessibilityLabel="Composer menu"
            actions={anchoredComposerActions}
            placement="top"
            align="start"
            onOpenChange={(open) => {
              if (open) dismissComposerKeyboardForOverlay();
            }}
            onSelect={handleAnchoredComposerAction}
            style={styles.composerMenuAnchor}
          >
            <Pressable accessibilityLabel="Composer menu" style={styles.composerMenu}>
              <Ionicons name="add" size={22} color={colors.text} />
            </Pressable>
          </ActionMenu>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={composerTrayVisible ? "Close composer menu" : "Composer menu"}
            accessibilityState={{ expanded: composerTrayVisible }}
            onPress={() => setComposerTrayVisible((current) => !current)}
            style={({ pressed }) => [styles.composerMenu, composerTrayVisible && styles.composerMenuActive, pressed && styles.pressed]}
          >
            <Ionicons name={composerTrayVisible ? "close" : "add"} size={22} color={colors.text} />
          </Pressable>
        )}
        <View
          testID="composer-input-shell"
          onLayout={({ nativeEvent }) => {
            const previousWidth = composerInputWidthRef.current;
            composerInputWidthRef.current = nativeEvent.layout.width;
            if (previousWidth <= 0 && nativeEvent.layout.width > 0) setComposerInputHeight(COMPOSER_MIN_HEIGHT);
          }}
          style={[styles.composerInputShell, { height: visibleComposerInputHeight }]}
        > 
          {voicePhase === "idle" ? (
            <TextInput
              voiceInput={false}
              accessibilityLabel="Message Codex"
              value={draft}
              onChangeText={updateDraft}
              onSubmitEditing={() => send()}
              selection={pendingVoiceSelection ?? undefined}
              onSelectionChange={({ nativeEvent }) => {
                draftSelectionRef.current = nativeEvent.selection;
                if (
                  pendingVoiceSelection !== null
                  && pendingVoiceSelection.start === nativeEvent.selection.start
                  && pendingVoiceSelection.end === nativeEvent.selection.end
                ) voiceController?.clearPendingSelection(composerScope);
              }}
              maxLength={MAX_TURN_TEXT_CHARS}
              placeholder="Message Codex…"
              placeholderTextColor={colors.textDim}
              multiline
              textAlignVertical="top"
              onContentSizeChange={({ nativeEvent }) => {
                composerContentHeightRef.current = nativeEvent.contentSize.height;
                if (composerInputWidthRef.current <= 0) return;
                setComposerInputHeight(composerHeightForContent(draft, nativeEvent.contentSize.height));
              }}
              scrollEnabled={visibleComposerInputHeight >= COMPOSER_MAX_HEIGHT}
              style={styles.composerInput}
            />
          ) : (
            <VoiceCaptureStatus
              phase={voicePhase}
              backend={voiceBackend}
              startedAt={voiceResource?.updatedAt ?? 0}
              controller={voiceController}
              scope={composerScope}
            />
          )}
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            disabled={voicePhase === "finishing" && !voiceRetryAvailable}
            onPress={() => void (voiceRetryAvailable ? retryVoice() : voicePhase === "idle" ? toggleVoice() : finishVoice(false))}
            style={[styles.composerIcon, voicePhase === "finishing" && !voiceRetryAvailable && styles.disabled]}
            accessibilityLabel={voiceRetryAvailable ? "Retry voice transcription" : voicePhase === "idle" ? "Voice input" : "Stop voice input and insert transcript"}
          >
            <Ionicons name={voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop-circle"} size={20} color={voiceRetryAvailable || voicePhase === "idle" ? colors.text : colors.red} />
          </Pressable>
          {Platform.OS === "android" ? <ActionMenu
            accessibilityLabel="Delivery mode"
            actions={deliveryActions}
            trigger="long-press"
            placement="top"
            onOpenChange={(open) => {
              if (open) dismissComposerKeyboardForOverlay();
            }}
            onSelect={handleDeliveryAction}
            style={styles.composerSendMenuAnchor}
          ><Pressable
            disabled={sendDisabled}
            onPress={() => {
              if (voicePhase !== "idle") void finishVoice(true);
              else if (currentTurnId !== null && onInterrupt !== undefined && draft.trim() === "" && attachments.length === 0) void onInterrupt(currentTurnId);
              else send();
            }}
            style={({ pressed }) => [
              styles.sendButton,
              pressed && styles.sendButtonPressed,
              sendDisabled && styles.disabled,
              stoppingResponse && styles.stopButton,
            ]}
            accessibilityState={{ disabled: sendDisabled }}
            accessibilityLabel={voicePhase !== "idle" ? "Finish voice input and send transcript" : stoppingResponse ? "Stop response" : "Send message"}
          >
            <Ionicons name={voicePhase === "finishing" ? "hourglass-outline" : stoppingResponse ? "stop" : "arrow-up"} size={19} color={stoppingResponse ? "#ffffff" : colors.onPrimary} />
          </Pressable></ActionMenu> : <Pressable
            disabled={sendDisabled}
            onPress={() => {
              if (voicePhase !== "idle") void finishVoice(true);
              else if (currentTurnId !== null && onInterrupt !== undefined && draft.trim() === "" && attachments.length === 0) void onInterrupt(currentTurnId);
              else send();
            }}
            style={({ pressed }) => [
              styles.sendButton,
              pressed && styles.sendButtonPressed,
              sendDisabled && styles.disabled,
              stoppingResponse && styles.stopButton,
            ]}
            accessibilityState={{ disabled: sendDisabled }}
            accessibilityLabel={voicePhase !== "idle" ? "Finish voice input and send transcript" : stoppingResponse ? "Stop response" : "Send message"}
          >
            <Ionicons name={voicePhase === "finishing" ? "hourglass-outline" : stoppingResponse ? "stop" : "arrow-up"} size={19} color={stoppingResponse ? "#ffffff" : colors.onPrimary} />
          </Pressable>}
        </View>
      </View>
      </>}
      </View>
      </KeyboardStickyView>

      <ComposerMenu
        visible={menuVisible}
        thread={remoteThread ?? null}
        initialPage={menuInitialPage}
        onClose={closeControls}
        controls={controls}
        queuedPrompts={visibleQueuedPrompts}
        activeTurnId={currentTurnId}
        terminalsResource={terminalsResource}
        goalResource={goalResource}
        voiceScope={composerScope}
        voiceResource={voiceResource}
        voiceController={voiceController}
        tunnelResource={tunnelResource}
        {...(portForwarding === undefined ? {} : { portForwarding })}
        loading={controlsLoading}
        error={effectiveControlError}
        selectedModel={effectiveModel}
        selectedEffort={effectiveEffort}
        selectedPersonality={selectedPersonality}
        selectedPermissions={effectivePermissions}
        onSelectModel={selectModel}
        onSelectEffort={selectEffort}
        onSelectPersonality={setSelectedPersonality}
        onSelectPermissions={selectPermissions}
        onInvokeSkill={insertSkillInvocation}
        {...(onEditQueued === undefined ? {} : { onEditQueued })}
        {...(onCancelQueued === undefined ? {} : { onCancelQueued })}
        {...(onMoveQueued === undefined ? {} : { onMoveQueued })}
        {...(onSteerQueued === undefined ? {} : { onSteerQueued })}
        {...(!fileAttachmentEnabled ? {} : { onAttachQueued: pickQueuedAttachment })}
        {...(onListTerminals === undefined ? {} : { onListTerminals })}
        {...(onTerminateTerminal === undefined ? {} : { onTerminateTerminal })}
        {...(onSetGoal === undefined ? {} : { onSetGoal })}
        {...(onClearGoal === undefined ? {} : { onClearGoal })}
        {...(onStartReview === undefined ? {} : { onStartReview })}
        {...(onCreateTunnel === undefined ? {} : { onCreateTunnel })}
        {...(onRevokeTunnel === undefined ? {} : { onRevokeTunnel })}
      />
      <NewThreadProjectSheet
        visible={projectPickerVisible}
        cwd={cwd}
        projects={projects}
        busy={projectChangeBusy}
        error={projectChangeError}
        onSelect={selectProject}
        onClose={closeProjectPicker}
      />
      <ThreadRenameSheet
        visible={threadRenameVisible}
        title={thread.title}
        onClose={closeThreadRename}
        {...(onRename === undefined ? {} : { onRename })}
      />
      <ThreadResourcesSheet
        visible={threadResourceSheet !== null}
        resource={threadResources}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceScope={`${composerScope}\u0000review`}
        voiceResource={reviewVoiceResource}
        voiceController={voiceController}
        getTransferAccess={getStableTransferAccess}
        onAttachReview={attachCodeReview}
        {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadThreadChangeDiff })}
        {...(onStartVoiceTranscription === undefined ? {} : { onStartVoiceTranscription })}
        {...(onLoadThreadResources === undefined ? {} : { onReload: onLoadThreadResources })}
        onClose={closeThreadResources}
      />
    </View>
    </View>
    </LargeContentViewerHost>
    </SubagentNavigationContext.Provider>
    </AppFullscreenOverlayBoundary>
  );
}

type ThreadResourceDocumentRoute = {
  request: DocumentPreviewRequest;
  result: DocumentPreviewResult;
  revision: number;
};

function ThreadResourcesSheet({
  visible,
  resource,
  cwd,
  thread,
  voiceScope,
  voiceResource,
  voiceController,
  getTransferAccess,
  onLoadThreadChangeDiff,
  onStartVoiceTranscription,
  onAttachReview,
  onReload,
  onClose,
}: {
  visible: boolean;
  resource: ThreadResourcesRow | null;
  cwd: string;
  thread: Thread | null;
  voiceScope: string;
  voiceResource: VoiceInputRow | null;
  voiceController: VoiceInputController | null;
  getTransferAccess: GetTransferAccess;
  onLoadThreadChangeDiff?(path: string): Promise<ThreadChangeDiffValue>;
  onStartVoiceTranscription?(listener: (event: VoiceTranscriptionEvent) => void, options?: VoiceTranscriptionOptions): Promise<VoiceTranscriptionSession>;
  onAttachReview(comments: readonly CodeReviewComment[]): Promise<boolean>;
  onReload?(): Promise<ThreadResourcesValue>;
  onClose(): void;
}) {
  const dialog = useAppDialog();
  const openDocument = useDocumentPreview();
  const downloadDocument = useDocumentDownload();
  const fullscreenOverlay = useAppFullscreenOverlay();
  const previewRevisionRef = useRef(0);
  const previewLoadRef = useRef<AbortController | null>(null);
  const [documentStack, setDocumentStack] = useState<ThreadResourceDocumentRoute[]>([]);
  const [documentViewportWidth, setDocumentViewportWidth] = useState(0);
  const changes = resource?.value?.changes ?? [];
  const attachments = resource?.value?.attachments ?? [];
  const title = `Attachments · ${attachments.length}`;
  const document = documentStack.at(-1) ?? null;
  const reload = () => {
    if (onReload === undefined || resource?.status === "loading") return;
    void onReload().catch((cause) => dialog.alert("Refresh failed", cause instanceof Error ? cause.message : "Could not refresh session resources"));
  };
  const updatePreviewResult = (revision: number, result: DocumentPreviewResult) => {
    setDocumentStack((current) => current.map((entry) => entry.revision === revision ? { ...entry, result } : entry));
  };
  const loadPreview = (request: DocumentPreviewRequest, replace: boolean) => {
    previewRevisionRef.current += 1;
    const revision = previewRevisionRef.current;
    previewLoadRef.current?.abort();
    const controller = new AbortController();
    previewLoadRef.current = controller;
    const route: ThreadResourceDocumentRoute = { request, revision, result: { phase: "loading" } };
    setDocumentStack((current) => replace ? [...current.slice(0, -1), route] : [...current, route]);
    void loadDocumentPreview(request, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted || previewRevisionRef.current !== revision) return;
        updatePreviewResult(revision, {
          phase: "ready",
          source: loaded.source,
          segments: request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
          truncated: loaded.truncated,
        });
      },
      (cause) => {
        if (controller.signal.aborted || previewRevisionRef.current !== revision) return;
        updatePreviewResult(revision, { phase: "error", message: cause instanceof Error ? cause.message : "Document preview failed" });
      },
    );
  };
  const openPreview = (request: DocumentPreviewRequest) => {
    if (request.kind === "download") {
      void downloadDocument(request);
      return;
    }
    if (request.kind === "image") {
      openDocument(request);
      return;
    }
    if (request.kind === "text") {
      fullscreenOverlay.present(({ close }) => (
        <CodeReviewWorkspace
          key={`${request.path}:${request.line ?? ""}:${request.column ?? ""}`}
          changes={codeReviewFilesForDocument(changes, request.path)}
          initialPath={request.path}
          {...(request.line === undefined ? {} : { initialLine: request.line })}
          {...(request.column === undefined ? {} : { initialColumn: request.column })}
          cwd={cwd}
          thread={thread}
          voiceScope={voiceScope}
          voiceResource={voiceResource}
          voiceController={voiceController}
          getTransferAccess={getTransferAccess}
          onAttach={onAttachReview}
          onClose={close}
          onDownload={() => void downloadDocument(request)}
          {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
          {...(onStartVoiceTranscription === undefined ? {} : { onStartVoiceTranscription })}
        />
      ));
      return;
    }
    loadPreview(request, false);
  };
  const closeSheet = () => {
    previewRevisionRef.current += 1;
    previewLoadRef.current?.abort();
    previewLoadRef.current = null;
    setDocumentStack([]);
    onClose();
  };
  const navigateBack = () => {
    previewRevisionRef.current += 1;
    previewLoadRef.current?.abort();
    previewLoadRef.current = null;
    setDocumentStack((current) => current.slice(0, -1));
  };
  const openPath = (name: string, sourcePath: string) => {
    const resolvedPath = resolveRemoteDocumentPath(sourcePath, cwd);
    if (resolvedPath === null) {
      dialog.alert("File unavailable", "The companion returned an invalid file path.");
      return;
    }
    openPreview({ kind: remoteFileKind(name, resolvedPath), name, path: resolvedPath, getTransferAccess });
  };
  const openAttachment = (attachment: ThreadAttachmentResource) => {
    if (attachment.path !== null) {
      openPath(attachment.name, attachment.path);
      return;
    }
    if (attachment.url !== null && isSafeHttpUrl(attachment.url)) void Linking.openURL(attachment.url);
    else dialog.alert("Attachment unavailable", "This attachment has no openable source.");
  };
  const openNestedDocument = (href: string) => {
    if (document === null) return false;
    const target = resolvePreviewableDocumentLink(href, remoteDocumentDirectory(document.request.path));
    if (target === null) return false;
    const request = { ...target, getTransferAccess };
    if (target.kind === "text") openPreview(request);
    else openPreview(request);
    return true;
  };
  const retryPreview = () => {
    if (document !== null) loadPreview(document.request, true);
  };
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) (document === null ? closeSheet : navigateBack)(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      <View pointerEvents={document === null ? "auto" : "none"} style={[styles.threadResourceRoute, document !== null && styles.threadResourceRouteHidden]}>
        <View style={styles.menuTitleRow}>
          <View style={styles.sheetHeaderIconSlot}>
            <Ionicons name="attach-outline" size={21} color={colors.textMuted} />
          </View>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sheetTitle}>{title}</Text>
          <View style={styles.flex} />
          <Pressable accessibilityLabel="Refresh session resources" disabled={onReload === undefined || resource?.status === "loading"} onPress={reload} style={[styles.headerIcon, (onReload === undefined || resource?.status === "loading") && styles.disabled]}>
            {resource?.status === "loading" ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="refresh" size={20} color={colors.text} />}
          </Pressable>
          <Pressable accessibilityLabel="Close attachments" onPress={closeSheet} style={styles.headerIcon}>
            <Ionicons name="close" size={21} color={colors.text} />
          </Pressable>
        </View>
        <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.threadResourcesContent} keyboardShouldPersistTaps="handled">
          {resource?.status === "error" && <Text selectable style={styles.errorText}>{resource.error ?? "Could not load session resources"}</Text>}
          {attachments.map((attachment) => (
            <ThreadAttachmentResourceRow key={attachment.key} attachment={attachment} onPress={() => openAttachment(attachment)} />
          ))}
          {resource?.status !== "loading" && attachments.length === 0 && (
            <View style={styles.threadResourcesEmpty}>
              <Ionicons name="attach-outline" size={28} color={colors.textDim} />
              <Text style={styles.menuNotice}>No attachments in this thread.</Text>
            </View>
          )}
        </AppSheetScrollView>
      </View>

      {document !== null && (
        <View style={styles.threadResourceRoute}>
          <View style={styles.menuTitleRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to attachments" onPress={navigateBack} style={styles.headerIcon}>
              <Ionicons name="arrow-back" size={21} color={colors.text} />
            </Pressable>
            <View style={styles.sheetHeaderIconSlot}>
              <Ionicons name={document.request.kind === "html" ? "globe-outline" : "document-text-outline"} size={20} color={colors.textMuted} />
            </View>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.sheetTitle}>{document.request.name}</Text>
            <View style={styles.flex} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Download ${document.request.name}`} onPress={() => void downloadDocument(document.request)} style={styles.headerIcon}>
              <Ionicons name="download-outline" size={20} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close attachments" onPress={closeSheet} style={styles.headerIcon}>
              <Ionicons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>
          {document.result.phase === "loading" && (
            <View style={styles.threadResourcePreviewCenter}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.menuNotice}>Loading document…</Text>
            </View>
          )}
          {document.result.phase === "error" && (
            <View style={styles.threadResourcePreviewCenter}>
              <Text selectable style={styles.errorText}>{document.result.message}</Text>
              <Pressable accessibilityRole="button" onPress={retryPreview} style={styles.primaryAction}>
                <Ionicons name="refresh" size={18} color={colors.onPrimary} />
                <Text style={styles.primaryActionText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {document.result.phase === "ready" && document.request.kind === "html" && (
            <WebView
              testID="thread-resource-html-preview"
              source={{ html: isolatedHtmlDocument(document.result.source), baseUrl: "about:blank" }}
              style={styles.threadResourceWebView}
              javaScriptEnabled={false}
              domStorageEnabled={false}
              allowFileAccess={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={({ url }) => {
                if (url === "about:blank") return true;
                if (isSafeHttpUrl(url)) void Linking.openURL(url);
                return false;
              }}
            />
          )}
          {document.result.phase === "ready" && document.request.kind !== "html" && (
            <AppSheetScrollView
              style={styles.menuScroll}
              contentContainerStyle={styles.threadResourceDocumentContent}
              keyboardShouldPersistTaps="handled"
              onLayout={({ nativeEvent }) => {
                const nextWidth = Math.max(0, Math.floor(nativeEvent.layout.width - spacing.md * 2));
                setDocumentViewportWidth((current) => current === nextWidth ? current : nextWidth);
              }}
            >
              {document.request.kind === "text"
                ? <NativeCodeBlock
                    value={document.result.source}
                    language={nativeCodeLanguageForPath(document.request.path)}
                    maxHeight={TOOL_RESULT_MAX_HEIGHT}
                    fillAvailableWidth
                  />
                : (
                  <RichContentWidthProvider width={documentViewportWidth > 0 ? documentViewportWidth : null}>
                    <MarkdownLocalLinkProvider onOpen={openNestedDocument}>
                      {document.result.segments.map((segment, index) => <RichMarkdown key={index} source={segment} />)}
                    </MarkdownLocalLinkProvider>
                  </RichContentWidthProvider>
                )}
              {document.result.truncated && <Text style={styles.menuNotice}>Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download the file to read the rest.</Text>}
            </AppSheetScrollView>
          )}
        </View>
      )}
    </AppSheet>
  );
}

function ThreadChangeResourceRow({ change, cwd, onPress }: { change: ThreadChangeResource; cwd: string; onPress(): void }) {
  const missing = change.availability === "deleted";
  const unavailable = change.availability === "unavailable";
  const icon = missing ? "trash-outline" : change.kind === "add" ? "add-circle-outline" : change.kind === "delete" ? "remove-circle-outline" : "document-text-outline";
  const color = missing || change.kind === "delete" ? colors.red : change.kind === "add" ? colors.green : colors.textMuted;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open changed file ${change.path}`} onPress={onPress} style={({ pressed }) => [styles.threadResourceRow, pressed && styles.pressed]}>
      <View style={styles.threadResourceIcon}><Ionicons name={icon} size={19} color={color} /></View>
      <View style={styles.threadResourceText}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.threadResourceTitle}>{changedFileDisplayPath(change.path, cwd, 64)}</Text>
        <View style={styles.threadResourceMeta}>
          <Text style={[styles.threadResourceStat, styles.diffStatAdd]}>+{change.additions}</Text>
          <Text style={[styles.threadResourceStat, styles.diffStatDelete]}>−{change.deletions}</Text>
          {missing && <Text style={styles.threadResourceDeleted}>File was deleted</Text>}
          {unavailable && <Text style={styles.threadResourceUnavailable}>File unavailable</Text>}
        </View>
      </View>
      <Ionicons name={missing ? "trash-outline" : unavailable ? "alert-circle-outline" : "chevron-forward"} size={17} color={missing ? colors.red : colors.textDim} />
    </Pressable>
  );
}

function ThreadAttachmentResourceRow({ attachment, onPress }: { attachment: ThreadAttachmentResource; onPress(): void }) {
  const icon = attachment.kind === "image" ? "image-outline" : attachment.kind === "audio" ? "musical-note-outline" : "document-attach-outline";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open attachment ${attachment.name}`} onPress={onPress} style={({ pressed }) => [styles.threadResourceRow, pressed && styles.pressed]}>
      <View style={styles.threadResourceIcon}><Ionicons name={icon} size={19} color={colors.textMuted} /></View>
      <View style={styles.threadResourceText}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.threadResourceTitle}>{attachment.name}</Text>
        <Text numberOfLines={1} style={styles.threadResourceSubtitle}>{attachment.origin === "user" ? "You" : "Codex"} · {attachment.kind}</Text>
      </View>
      <Ionicons name={attachment.path === null ? "open-outline" : remoteFileKind(attachment.name, attachment.path) === "download" ? "download-outline" : "chevron-forward"} size={17} color={colors.textDim} />
    </Pressable>
  );
}

function ThreadHeaderMenu({
  threadId,
  archived,
  pinned,
  onOpenMenu,
  onOpenTerminal,
  onRenameRequest,
  onArchive,
  onUnarchive,
  onCompact,
  onFork,
  onDelete,
  onTogglePin,
}: {
  threadId: string;
  archived: boolean;
  pinned: boolean;
  onOpenMenu?(): void;
  onOpenTerminal?(): void;
  onRenameRequest(): void;
  onArchive?(): Promise<void>;
  onUnarchive?(): Promise<void>;
  onCompact?(): Promise<void>;
  onFork?(options: ThreadForkOptions): Promise<void>;
  onDelete?(): Promise<void>;
  onTogglePin?(): Promise<void>;
}) {
  const dialog = useAppDialog();
  const [webMenuVisible, setWebMenuVisible] = useState(false);
  const actions: ActionMenuItem[] = [
    { id: "terminal", label: "Open terminal", icon: "terminal-outline", disabled: onOpenTerminal === undefined },
    { id: "copy-session-id", label: "Copy session ID", icon: "copy-outline" },
    { id: "rename", label: "Rename", icon: "pencil-outline" },
    { id: "pin", label: pinned ? "Unpin thread" : "Pin thread", icon: "pin-outline", selected: pinned, disabled: onTogglePin === undefined },
    { id: "fork", label: "Fork thread", icon: "git-branch-outline", disabled: onFork === undefined },
    { id: "compact", label: "Compact context", icon: "contract-outline", disabled: onCompact === undefined },
    { id: "archive", label: archived ? "Unarchive thread" : "Archive thread", icon: archived ? "archive" : "archive-outline", disabled: archived ? onUnarchive === undefined : onArchive === undefined },
    { id: "delete", label: "Delete thread", icon: "trash-outline", destructive: true, disabled: onDelete === undefined },
  ];
  const run = (action: (() => Promise<void>) | undefined, label: string) => {
    if (action === undefined) return;
    void action().catch((cause) => dialog.alert(`${label} failed`, cause instanceof Error ? cause.message : "Thread action failed"));
  };
  const handleAction = (id: string) => {
    if (id === "terminal") onOpenTerminal?.();
    else if (id === "copy-session-id") void copySessionId(threadId).catch((cause) => dialog.alert("Copy failed", cause instanceof Error ? cause.message : "Could not copy session ID"));
    else if (id === "rename") onRenameRequest();
    else if (id === "pin") run(onTogglePin, pinned ? "Unpin" : "Pin");
    else if (id === "fork" && onFork !== undefined) run(() => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
    else if (id === "compact") run(onCompact, "Compact");
    else if (id === "archive") run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
    else if (id === "delete" && onDelete !== undefined) {
      dialog.alert("Delete thread?", "This permanently deletes the thread on the selected server.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => run(onDelete, "Delete") },
      ]);
    }
  };
  if (Platform.OS === "web") {
    return (
      <>
        <Pressable accessibilityLabel="Thread menu" onPress={() => setWebMenuVisible(true)} style={styles.headerIcon}>
          <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
        </Pressable>
        <AppSheet isOpen={webMenuVisible} onOpenChange={setWebMenuVisible} contentProps={{ index: 0, enableDynamicSizing: true }}>
          <Text style={styles.sheetTitle}>Thread</Text>
          <MenuAction icon="terminal-outline" title="Open terminal" subtitle="" onPress={() => { setWebMenuVisible(false); onOpenTerminal?.(); }} />
          <MenuAction icon="copy-outline" title="Copy session ID" subtitle="" onPress={() => { setWebMenuVisible(false); handleAction("copy-session-id"); }} />
          <MenuAction icon="pencil-outline" title="Rename" subtitle="" onPress={() => { setWebMenuVisible(false); onRenameRequest(); }} />
          <MenuAction icon="push-pin" title={pinned ? "Unpin thread" : "Pin thread"} subtitle="" onPress={() => { setWebMenuVisible(false); run(onTogglePin, pinned ? "Unpin" : "Pin"); }} />
          <MenuAction icon="git-branch-outline" title="Fork thread" subtitle="" onPress={() => { setWebMenuVisible(false); if (onFork !== undefined) run(() => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork"); }} />
          <MenuAction icon="contract-outline" title="Compact context" subtitle="" onPress={() => { setWebMenuVisible(false); run(onCompact, "Compact"); }} />
          <MenuAction icon={archived ? "archive" : "archive-outline"} title={archived ? "Unarchive thread" : "Archive thread"} subtitle="" onPress={() => { setWebMenuVisible(false); run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive"); }} />
          <MenuAction danger icon="trash-outline" title="Delete thread" subtitle="" onPress={() => { setWebMenuVisible(false); handleAction("delete"); }} />
        </AppSheet>
      </>
    );
  }
  return (
    <ActionMenu
      accessibilityLabel="Thread menu"
      actions={actions}
      {...(onOpenMenu === undefined ? {} : { onOpenChange: (open: boolean) => { if (open) onOpenMenu(); } })}
      onSelect={handleAction}
      style={styles.headerMenuAnchor}
    >
      <Pressable style={styles.headerIcon} accessibilityLabel="Thread menu">
        <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
      </Pressable>
    </ActionMenu>
  );
}

function ThreadRenameSheet({
  visible,
  title,
  onClose,
  onRename,
}: {
  visible: boolean;
  title: string;
  onClose(): void;
  onRename?(name: string): Promise<void>;
}) {
  const [name, setName] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Thread action failed");
    }
    setSaving(false);
  };
  return (
    <AppSheet isOpen={visible} onOpenChange={(open) => { if (!open) onClose(); }} contentProps={{ index: 0, enableDynamicSizing: true }}>
      <Text style={styles.sheetTitle}>Rename thread</Text>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput autoFocus selectTextOnFocus accessibilityLabel="Thread name" value={name} onChangeText={setName} onSubmitEditing={() => {
        if (!saving && name.trim() !== "" && onRename !== undefined) void run(() => onRename(name.trim()));
      }} style={styles.fieldInput} />
      <Pressable accessibilityRole="button" accessibilityLabel="Rename" disabled={saving || name.trim() === "" || onRename === undefined} onPress={() => void run(() => onRename?.(name.trim()) ?? Promise.resolve())} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Rename</Text>
      </Pressable>
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </AppSheet>
  );
}

const QUEUE_DRAG_ROW_STEP = 76;

function QueueDragHandle({ disabled, onDrop }: { disabled: boolean; onDrop(offset: number): void }) {
  const translation = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translation.get() }] }));
  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(120)
    .onUpdate((event) => { translation.set(event.translationY); })
    .onEnd((event) => {
      const offset = Math.round(event.translationY / QUEUE_DRAG_ROW_STEP);
      translation.set(withTiming(0, { duration: 140 }));
      if (offset !== 0) runOnJS(onDrop)(offset);
    })
    .onFinalize(() => { translation.set(withTiming(0, { duration: 140 })); });
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View accessibilityLabel="Drag queued prompt" style={[styles.queueDragHandle, dragStyle]}>
        <Ionicons name="reorder-three" size={22} color={disabled ? colors.textDim : colors.textMuted} />
      </Reanimated.View>
    </GestureDetector>
  );
}

function QueueManagerSheet({
  visible,
  onClose,
  embedded = false,
  items,
  activeTurnId,
  onEdit,
  onCancel,
  onMove,
  onSteer,
  onAttach,
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  items: QueuedPrompt[];
  activeTurnId: string | null;
  onEdit?(commandId: string, text: string, attachments: ComposerAttachment[]): Promise<void>;
  onCancel?(commandId: string): Promise<void>;
  onMove?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteer?(commandId: string, expectedTurnId: string): Promise<void>;
  onAttach?(): Promise<ComposerAttachment | null>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingAttachments, setEditingAttachments] = useState<ComposerAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Queue action failed");
    }
    setBusy(false);
  };
  const moveBy = async (item: QueuedPrompt, index: number, offset: number) => {
    if (onMove === undefined || item.state !== "queued") return;
    const target = Math.max(0, Math.min(items.length - 1, index + offset));
    const direction: -1 | 1 = target < index ? -1 : 1;
    for (let step = 0; step < Math.abs(target - index); step += 1) {
      await onMove(item.commandId, direction);
    }
  };
  const beginEdit = (item: QueuedPrompt) => {
    setEditingId(item.commandId);
    setEditingText(item.text);
    setEditingAttachments(item.attachments);
  };
  const attach = async () => {
    const attachment = await onAttach?.() ?? null;
    if (attachment === null) return;
    setEditingAttachments((current) => [
      ...current.filter((candidate) => candidate.id !== attachment.id),
      attachment,
    ]);
  };
  const content = (
    <>
          {!embedded && <View style={styles.menuTitleRow}>
            <Text style={styles.sheetTitle}>Queued prompts</Text>
            <View style={styles.flex} />
            <Pressable accessibilityLabel="Close queue" onPress={onClose} style={styles.headerIcon}>
              <Ionicons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>}
          {items.length === 0 && <Text style={styles.menuNotice}>Nothing is waiting for this thread.</Text>}
          <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent} keyboardShouldPersistTaps="handled">
            {items.map((item, index) => (
              <View key={item.commandId} style={styles.queueRow}>
                {editingId === item.commandId ? (
                  <>
                    <TextInput
                      accessibilityLabel="Queued prompt text"
                      multiline
                      maxLength={MAX_TURN_TEXT_CHARS}
                      value={editingText}
                      onChangeText={setEditingText}
                      placeholder="Message Codex…"
                      placeholderTextColor={colors.textDim}
                      textAlignVertical="top"
                      style={[styles.fieldInput, styles.queueEditorInput]}
                    />
                    {editingAttachments.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.queueAttachmentList}>
                      {editingAttachments.map((attachment) => (
                        <View key={attachment.id} style={styles.composerAttachmentChip}>
                          <Ionicons name={attachment.kind === "image" ? "image-outline" : attachment.kind === "audio" ? "mic-outline" : "document-outline"} size={16} color={colors.textMuted} />
                          <Text numberOfLines={1} style={styles.queueAttachmentName}>{attachment.name}</Text>
                          <Pressable accessibilityLabel={`Remove ${attachment.name}`} hitSlop={10} onPress={() => setEditingAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id))}>
                            <Ionicons name="close" size={16} color={colors.textMuted} />
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>}
                    <View style={styles.queueActions}>
                      <Pressable accessibilityLabel="Attach to queued prompt" disabled={busy || onAttach === undefined} onPress={() => void attach()} style={styles.queueTextButton}><Ionicons name="attach-outline" size={18} color={colors.text} /><Text style={styles.queueTextButtonLabel}>Attach</Text></Pressable>
                      <View style={styles.flex} />
                      <Pressable disabled={busy} onPress={() => setEditingId(null)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
                      <Pressable disabled={busy || editingText.trim() === "" && editingAttachments.length === 0 || onEdit === undefined} onPress={() => void run(() => onEdit?.(item.commandId, editingText, editingAttachments) ?? Promise.resolve())} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Save</Text></Pressable>
                    </View>
                  </>
                ) : (
                  <View style={styles.queueCompactRow}>
                    <QueueDragHandle disabled={busy || item.state !== "queued" || onMove === undefined} onDrop={(offset) => void run(() => moveBy(item, index, offset))} />
                    <View style={styles.queueBody}>
                      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.queueText}>{item.text || item.attachments.map(({ name }) => name).join(", ")}</Text>
                      <View style={styles.queueMetaRow}>
                        <Text numberOfLines={1} style={styles.queueTime}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {item.state}</Text>
                        {item.attachments.length > 0 && <Text numberOfLines={1} style={styles.queueTime}> · {item.attachments.length} attachment{item.attachments.length === 1 ? "" : "s"}</Text>}
                      </View>
                    </View>
                    {activeTurnId !== null && <Pressable accessibilityLabel="Steer queued prompt" disabled={busy || item.state !== "queued" || onSteer === undefined} onPress={() => void run(() => onSteer?.(item.commandId, activeTurnId) ?? Promise.resolve())} style={styles.queueSteerButton}><Ionicons name="navigate-outline" size={16} color={colors.onPrimary} /><Text style={styles.queueSteerLabel}>Steer</Text></Pressable>}
                    <Pressable accessibilityLabel="Edit queued prompt" disabled={busy || item.state !== "queued" || onEdit === undefined} onPress={() => beginEdit(item)} style={styles.headerIcon}><Ionicons name="create-outline" size={19} color={colors.text} /></Pressable>
                    <Pressable accessibilityLabel="Delete queued prompt" disabled={busy || item.state === "uncertain" || onCancel === undefined} onPress={() => void run(() => onCancel?.(item.commandId) ?? Promise.resolve())} style={styles.headerIcon}><Ionicons name="trash-outline" size={19} color={colors.red} /></Pressable>
                  </View>
                )}
                {editingId !== item.commandId && item.lastError !== null && <Text style={styles.errorText}>{item.lastError}</Text>}
              </View>
            ))}
          </AppSheetScrollView>
          {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </>
  );
  return embedded ? content : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      {content}
    </AppSheet>
  );
}

function BackgroundTerminalsSheet({
  visible,
  onClose,
  embedded = false,
  resource,
  onList,
  onTerminate,
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  resource: BackgroundTerminalsRow | null;
  onList?(): Promise<BackgroundTerminal[]>;
  onTerminate?(processId: string): Promise<boolean>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = resource?.items ?? [];
  const effectiveError = error ?? resource?.error ?? null;
  const reload = async () => { if (onList !== undefined) await onList(); };
  const terminate = async (processId: string) => {
    if (onTerminate === undefined) return;
    setBusyId(processId);
    setError(null);
    try {
      if (await onTerminate(processId)) await reload();
      else setError("Process was already gone");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not terminate process");
    }
    setBusyId(null);
  };
  const content = (
    <>
          {!embedded && <View style={styles.menuTitleRow}>
            <Text style={styles.sheetTitle}>Background terminals</Text>
            <View style={styles.flex} />
            <Pressable accessibilityLabel="Refresh terminals" onPress={() => void reload()} style={styles.headerIcon}><Ionicons name="refresh" size={20} color={colors.text} /></Pressable>
            <Pressable accessibilityLabel="Close terminals" onPress={onClose} style={styles.headerIcon}><Ionicons name="close" size={21} color={colors.text} /></Pressable>
          </View>}
          {items.length === 0 && <Text style={styles.menuNotice}>No background processes in this thread.</Text>}
          <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
            {items.map((item) => (
              <View key={item.processId} style={styles.queueRow}>
                <Text selectable numberOfLines={3} style={styles.queueText}>{item.command}</Text>
                <Text selectable numberOfLines={1} style={styles.queueTime}>{item.cwd} · PID {item.osPid ?? item.processId}</Text>
                <Text style={styles.queueTime}>{item.cpuPercent === null ? "CPU —" : `CPU ${item.cpuPercent.toFixed(1)}%`} · {item.rssKb === null ? "RAM —" : `RAM ${item.rssKb} KiB`}</Text>
                <Pressable accessibilityLabel={`Terminate ${item.processId}`} disabled={busyId !== null || onTerminate === undefined} onPress={() => void terminate(item.processId)} style={styles.dangerButton}>
                  <Text style={styles.primaryButtonText}>{busyId === item.processId ? "Terminating…" : "Terminate"}</Text>
                </Pressable>
              </View>
            ))}
          </AppSheetScrollView>
          {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
    </>
  );
  return embedded ? content : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      {content}
    </AppSheet>
  );
}

function ThreadGoalDialog({
  visible,
  onClose,
  goal,
  resourceError,
  onSet,
  onClear,
  voiceScope,
  voiceResource,
  voiceController,
}: {
  visible: boolean;
  onClose(): void;
  goal: ThreadGoal | null;
  resourceError: string | null;
  onSet(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClear(): Promise<boolean>;
  voiceScope: string;
  voiceResource: VoiceInputRow | null;
  voiceController: VoiceInputController | null;
}) {
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(goal?.tokenBudget === null || goal?.tokenBudget === undefined ? "" : String(goal.tokenBudget));
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voicePhase = voiceResource?.phase ?? "idle";
  const effectiveError = error ?? voiceResource?.error ?? resourceError;
  const applyGoal = (next: ThreadGoal | null) => {
    setObjective(next?.objective ?? "");
    setTokenBudget(next?.tokenBudget === null || next?.tokenBudget === undefined ? "" : String(next.tokenBudget));
  };
  const close = () => {
    if (voicePhase === "idle" || voiceController === null) {
      onClose();
      return;
    }
    void voiceController.finish(false).then(onClose);
  };
  const save = () => {
    const validation = validateGoalEditorDraft(objective, tokenBudget, goal?.status ?? "active");
    if (validation.error !== null) {
      setError(validation.error);
      return;
    }
    setBusy(true);
    setError(null);
    const input = validation.value;
    const operation = onSet(input);
    void operation.then((next) => {
      applyGoal(next);
      onClose();
    }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not save goal");
    }).then(() => setBusy(false));
  };
  const clear = () => {
    setBusy(true);
    setError(null);
    const operation = onClear();
    void operation.then((cleared) => {
      if (cleared) {
        applyGoal(null);
        setConfirmClear(false);
        onClose();
      } else setError("Goal was already cleared");
    }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not clear goal");
    }).then(() => setBusy(false));
  };
  const usagePercent = goal?.tokenBudget === null || goal?.tokenBudget === undefined || goal.tokenBudget === 0
    ? null
    : Math.min(100, Math.round(goal.tokensUsed / goal.tokenBudget * 100));
  return (
    <Dialog isOpen={visible} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress={!busy} />
        <KeyboardAvoidingView behavior="padding">
          <Dialog.Content style={styles.goalDialogContent}>
            <Dialog.Close accessibilityLabel="Close goal dialog" isDisabled={busy} />

            <View style={styles.goalDialogIntro}>
              <Dialog.Title>{goal === null ? "Create goal" : "Edit goal"}</Dialog.Title>
              {goal !== null && (
                <Dialog.Description>
                  {goal.tokensUsed.toLocaleString()} tokens · {formatDuration(goal.timeUsedSeconds * 1_000)}
                  {usagePercent === null ? "" : ` · ${usagePercent}% of budget`}
                </Dialog.Description>
              )}
            </View>

            <TextField isRequired isInvalid={effectiveError !== null}>
              <Label>What should Codex work toward?</Label>
              <TextInput
                voiceScope={voiceScope}
                autoFocus
                accessibilityLabel="Goal objective"
                multiline
                value={objective}
                onChangeText={(value) => {
                  setObjective(value);
                  if (error !== null) setError(null);
                }}
                placeholder="Describe the outcome…"
                placeholderTextColor={colors.textDim}
                style={styles.goalObjectiveInput}
              />
              {effectiveError !== null && <FieldError>{effectiveError}</FieldError>}
            </TextField>

            <Accordion selectionMode="single" variant="surface" hideSeparator>
              <Accordion.Item value="advanced">
                <Accordion.Trigger accessibilityLabel="Advanced goal options">
                  <Text>Advanced</Text>
                  <Accordion.Indicator />
                </Accordion.Trigger>
                <Accordion.Content>
                  <TextField>
                    <Label>Token budget</Label>
                    <TextInput
                      voiceInput={false}
                      accessibilityLabel="Goal token budget"
                      keyboardType="number-pad"
                      maxLength={15}
                      value={tokenBudget}
                      onChangeText={(value) => {
                        setTokenBudget(value);
                        if (error !== null) setError(null);
                      }}
                      placeholder="No limit"
                      placeholderTextColor={colors.textDim}
                      style={styles.fieldInput}
                    />
                  </TextField>
                </Accordion.Content>
              </Accordion.Item>
            </Accordion>

            {goal !== null && confirmClear && <Text style={styles.goalClearPrompt}>Remove this goal from the thread?</Text>}
            <View style={styles.goalDialogActions}>
              {goal !== null && (
                <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => confirmClear ? clear() : setConfirmClear(true)}>
                  {confirmClear ? "Remove" : "Clear goal"}
                </Button>
              )}
              <View style={styles.flex} />
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={close}>Cancel</Button>
              <Button size="sm" variant="primary" isDisabled={busy || objective.trim() === "" || voicePhase !== "idle"} onPress={save}>
                {busy ? "Saving…" : goal === null ? "Create" : "Save"}
              </Button>
            </View>
          </Dialog.Content>
        </KeyboardAvoidingView>
      </Dialog.Portal>
    </Dialog>
  );
}

function ReviewSheet({
  visible,
  onClose,
  embedded = false,
  onStartReview,
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  onStartReview?(target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
}) {
  const [targetType, setTargetType] = useState<ReviewTarget["type"]>("uncommittedChanges");
  const [targetValue, setTargetValue] = useState("");
  const [delivery, setDelivery] = useState<ReviewDelivery>("inline");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    let target: ReviewTarget;
    try {
      target = buildReviewTarget(targetType, targetValue);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid review target");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const operation = onStartReview === undefined ? Promise.resolve("demo-review-thread") : onStartReview(target, delivery);
    void operation.then((reviewThreadId) => {
      setResult(delivery === "detached" ? `Review started in ${reviewThreadId}` : "Inline review started");
    }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not start review");
    }).then(() => setBusy(false));
  };
  const needsValue = targetType !== "uncommittedChanges";
  const content = (
    <>
          {!embedded && <View style={styles.menuTitleRow}>
            <Text style={styles.sheetTitle}>Review</Text>
            <View style={styles.flex} />
            <Pressable accessibilityLabel="Close review controls" onPress={onClose} style={styles.headerIcon}><Ionicons name="close" size={21} color={colors.text} /></Pressable>
          </View>}
          <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.controlSectionLabel}>Review target</Text>
            <ControlOption title="Uncommitted changes" selected={targetType === "uncommittedChanges"} onPress={() => { setTargetType("uncommittedChanges"); setTargetValue(""); }} />
            <ControlOption title="Base branch" selected={targetType === "baseBranch"} onPress={() => setTargetType("baseBranch")} />
            <ControlOption title="Commit" selected={targetType === "commit"} onPress={() => setTargetType("commit")} />
            <ControlOption title="Custom instructions" selected={targetType === "custom"} onPress={() => setTargetType("custom")} />
            {needsValue && (
              <TextInput
                voiceInput={targetType === "custom"}
                accessibilityLabel="Review target value"
                multiline={targetType === "custom"}
                value={targetValue}
                onChangeText={setTargetValue}
                placeholder={targetType === "baseBranch" ? "main" : targetType === "commit" ? "commit SHA" : "What should the review focus on?"}
                placeholderTextColor={colors.textDim}
                style={[styles.fieldInput, targetType === "custom" && { minHeight: 76 }]}
              />
            )}
            <Text style={styles.controlSectionLabel}>Delivery</Text>
            <SegmentedControl
              appearance="dark"
              values={["Inline", "New thread"]}
              selectedIndex={delivery === "inline" ? 0 : 1}
              onValueChange={(value) => setDelivery(value === "New thread" ? "detached" : "inline")}
              style={styles.modeSelector}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Start review" disabled={busy || (needsValue && targetValue.trim() === "")} onPress={() => void start()} style={[styles.primaryButton, (busy || (needsValue && targetValue.trim() === "")) && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{busy ? "Starting…" : "Start review"}</Text>
            </Pressable>
            {result !== null && <Text style={styles.successText}>{result}</Text>}
            {error !== null && <Text style={styles.errorText}>{error}</Text>}
          </AppSheetScrollView>
    </>
  );
  return embedded ? content : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      {content}
    </AppSheet>
  );
}

function buildReviewTarget(type: ReviewTarget["type"], rawValue: string): ReviewTarget {
  const value = rawValue.trim();
  if (type === "uncommittedChanges") return { type };
  if (value === "") throw new Error("Review target is required");
  if (type === "baseBranch") return { type, branch: value };
  if (type === "commit") return { type, sha: value, title: null };
  return { type, instructions: value };
}

const COMPOSER_ACCESSORY_ACTIONS: ReadonlyArray<{
  id: ComposerAccessoryAction;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { id: "files", icon: "attach-outline", label: "File" },
  { id: "skills", icon: "extension-puzzle-outline", label: "Skill" },
  { id: "goal", icon: "flag-outline", label: "Goal" },
  { id: "runtime", icon: "terminal-outline", label: "Runtime" },
];

function ComposerAccessoryTray({
  fileEnabled,
  runtimeEnabled,
  onSelect,
}: {
  fileEnabled: boolean;
  runtimeEnabled: boolean;
  onSelect(action: ComposerAccessoryAction): void;
}) {
  const enabled = (action: ComposerAccessoryAction) => action === "files"
    ? fileEnabled
    : action !== "runtime" || runtimeEnabled;
  return (
    <View testID="composer-accessory-tray" accessibilityLabel="Composer actions" style={styles.composerAccessoryTray}>
      {COMPOSER_ACCESSORY_ACTIONS.map((action) => {
        const actionEnabled = enabled(action.id);
        return (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: !actionEnabled }}
            disabled={!actionEnabled}
            onPress={() => onSelect(action.id)}
            style={({ pressed }) => [styles.composerAccessoryAction, pressed && styles.pressed, !actionEnabled && styles.disabled]}
          >
            <Ionicons name={action.icon} size={20} color={colors.text} />
            <Text numberOfLines={1} style={styles.composerAccessoryLabel}>{action.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ComposerMenu({
  visible,
  initialPage,
  onClose,
  controls,
  queuedPrompts,
  activeTurnId,
  terminalsResource,
  goalResource,
  thread,
  voiceScope,
  voiceResource,
  voiceController,
  tunnelResource,
  portForwarding,
  loading,
  error,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
  onSelectPermissions,
  onInvokeSkill,
  onEditQueued,
  onCancelQueued,
  onMoveQueued,
  onSteerQueued,
  onAttachQueued,
  onListTerminals,
  onTerminateTerminal,
  onSetGoal,
  onClearGoal,
  onStartVoiceTranscription,
  onStartReview,
  onCreateTunnel,
  onRevokeTunnel,
}: {
  visible: boolean;
  initialPage: ComposerMenuPage;
  onClose(): void;
  controls: TurnControls;
  queuedPrompts: QueuedPrompt[];
  activeTurnId: string | null;
  terminalsResource: BackgroundTerminalsRow | null;
  goalResource: ThreadGoalRow | null;
  thread: Thread | null;
  voiceScope: string;
  voiceResource: VoiceInputRow | null;
  voiceController: VoiceInputController | null;
  tunnelResource: TunnelRow | null;
  portForwarding?: PortForwardingManagerProps;
  loading: boolean;
  error: string | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedPersonality: Personality | null;
  selectedPermissions: string | null;
  onSelectModel(model: string, effort: string): void;
  onSelectEffort(effort: string): void;
  onSelectPersonality(personality: Personality | null): void;
  onSelectPermissions(permissions: string | null): void;
  onInvokeSkill(skill: { name: string; path: string }): void;
  onEditQueued?(commandId: string, text: string, attachments: ComposerAttachment[]): Promise<void>;
  onCancelQueued?(commandId: string): Promise<void>;
  onMoveQueued?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteerQueued?(commandId: string, expectedTurnId: string): Promise<void>;
  onAttachQueued?(): Promise<ComposerAttachment | null>;
  onListTerminals?(): Promise<BackgroundTerminal[]>;
  onTerminateTerminal?(processId: string): Promise<boolean>;
  onSetGoal?(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClearGoal?(): Promise<boolean>;
  onStartVoiceTranscription?(listener: (event: VoiceTranscriptionEvent) => void, options?: VoiceTranscriptionOptions): Promise<VoiceTranscriptionSession>;
  onStartReview?(target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
  onCreateTunnel?(port: number, ttlSeconds: number): Promise<TunnelPreview>;
  onRevokeTunnel?(tunnelId: string): Promise<void>;
}) {
  const page = initialPage;
  const [runtimeSection, setRuntimeSection] = useState<"terminals" | "tunnel">(onListTerminals === undefined && onCreateTunnel !== undefined ? "tunnel" : "terminals");
  const [localGoal, setLocalGoal] = useState<ThreadGoal | null>(null);
  const model = controls.models.find((candidate) => candidate.id === selectedModel) ?? controls.models[0];
  const reasoningEfforts = model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];
  if (page === "goal") {
    if (!visible) return null;
    const currentGoal = goalResource?.goal ?? localGoal;
    return (
      <ThreadGoalDialog
        key={currentGoal?.updatedAt ?? "empty"}
        visible
        onClose={onClose}
        goal={currentGoal}
        resourceError={goalResource?.error ?? null}
        voiceScope={voiceScope}
        voiceResource={voiceResource}
        voiceController={voiceController}
        onSet={onSetGoal ?? (async (input) => {
          const now = Math.floor(Date.now() / 1_000);
          const next: ThreadGoal = {
            threadId: "demo",
            objective: input.objective,
            status: input.status,
            tokenBudget: input.tokenBudget,
            tokensUsed: localGoal?.tokensUsed ?? 12_480,
            timeUsedSeconds: localGoal?.timeUsedSeconds ?? 742,
            createdAt: localGoal?.createdAt ?? now,
            updatedAt: now,
          };
          setLocalGoal(next);
          return next;
        })}
        onClear={onClearGoal ?? (async () => { const existed = localGoal !== null; setLocalGoal(null); return existed; })}
      />
    );
  }
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      <View style={styles.menuTitleRow}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sheetTitle}>{pageTitle(page)}</Text>
        <View style={styles.flex} />
        <Pressable accessibilityLabel="Close turn controls" onPress={onClose} style={styles.headerIcon}>
          <Ionicons name="close" size={21} color={colors.text} />
        </Pressable>
      </View>
      <View style={[styles.sheetPage, styles.expandedSheetPage]}>
        {(page === "model" || page === "skills" || page === "permissions") && loading && <Text style={styles.menuNotice}>Loading from remote server…</Text>}
        {(page === "model" || page === "skills" || page === "permissions") && error !== null && <Text style={styles.errorText}>{error}</Text>}
        {page === "queue" ? (
          <QueueManagerSheet
            embedded
            visible
            onClose={onClose}
            items={queuedPrompts}
            activeTurnId={activeTurnId}
            {...(onEditQueued === undefined ? {} : { onEdit: onEditQueued })}
            {...(onCancelQueued === undefined ? {} : { onCancel: onCancelQueued })}
            {...(onMoveQueued === undefined ? {} : { onMove: onMoveQueued })}
            {...(onSteerQueued === undefined ? {} : { onSteer: onSteerQueued })}
            {...(onAttachQueued === undefined ? {} : { onAttach: onAttachQueued })}
          />
        ) : page === "review" ? (
          <ReviewSheet
            embedded
            visible
            onClose={onClose}
            {...(onStartReview === undefined ? {} : { onStartReview })}
          />
        ) : page === "runtime" ? (
          <>
            {onListTerminals !== undefined && (portForwarding !== undefined || onCreateTunnel !== undefined) && (
              <SegmentedControl
                appearance="dark"
                values={["Terminal", "Ports"]}
                selectedIndex={runtimeSection === "terminals" ? 0 : 1}
                onValueChange={(value) => {
                  const next = value === "Ports" ? "tunnel" : "terminals";
                  setRuntimeSection(next);
                  if (next === "terminals") void onListTerminals();
                }}
                style={styles.runtimeSelector}
              />
            )}
            {runtimeSection === "terminals" && onListTerminals !== undefined ? (
              <BackgroundTerminalsSheet
                embedded
                visible
                onClose={onClose}
                resource={terminalsResource}
                onList={onListTerminals}
                {...(onTerminateTerminal === undefined ? {} : { onTerminate: onTerminateTerminal })}
              />
            ) : portForwarding !== undefined ? (
              <PortForwardingManager {...portForwarding} />
            ) : (
              <LocalhostPreview
                embedded
                visible
                onClose={onClose}
                resource={tunnelResource}
                {...(onCreateTunnel === undefined ? {} : { onCreate: onCreateTunnel })}
                {...(onRevokeTunnel === undefined ? {} : { onRevoke: onRevokeTunnel })}
              />
            )}
          </>
        ) : (
          <AppSheetScrollView key={page} style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent} keyboardShouldPersistTaps="handled">
            {page === "model" && (
              <>
                <Text style={styles.controlSectionLabel}>Model</Text>
                {controls.models.length === 0
                  ? <Text style={styles.menuNotice}>No models returned by the server</Text>
                  : controls.models.map((candidate) => {
                      const currentEffort = selectedEffort ?? model?.defaultEffort ?? candidate.defaultEffort;
                      const nextEffort = candidate.efforts.includes(currentEffort) ? currentEffort : candidate.defaultEffort;
                      return (
                        <ControlOption
                          key={candidate.id}
                          title={candidate.label}
                          subtitle={candidate.id}
                          selected={candidate.id === (selectedModel ?? model?.id)}
                          onPress={() => onSelectModel(candidate.id, nextEffort)}
                        />
                      );
                    })}
                {model !== undefined && (
                  <>
                    <Text style={styles.controlSectionLabel}>Thinking</Text>
                    {reasoningEfforts.map((effort) => (
                      <ControlOption key={effort} title={effort} selected={effort === (selectedEffort ?? model.defaultEffort)} onPress={() => onSelectEffort(effort)} />
                    ))}
                  </>
                )}
                {model?.supportsPersonality === true && (
                  <>
                    <Text style={styles.controlSectionLabel}>Personality</Text>
                    <ControlOption title="Server default" selected={selectedPersonality === null} onPress={() => onSelectPersonality(null)} />
                    {(["friendly", "pragmatic", "none"] as const).map((personality) => (
                      <ControlOption key={personality} title={personality} selected={personality === selectedPersonality} onPress={() => onSelectPersonality(personality)} />
                    ))}
                  </>
                )}
              </>
            )}
            {page === "skills" && (controls.skills.length === 0
              ? <Text style={styles.menuNotice}>No skills returned for {cwdLabel(controls)}</Text>
              : controls.skills.map((skill) => (
                  <ControlOption
                    key={skill.path}
                    title={skill.name}
                    subtitle={skill.description}
                    selected={false}
                    disabled={!skill.enabled}
                    onPress={() => { onInvokeSkill(skill); onClose(); }}
                  />
                )))}
            {page === "permissions" && (
              <>
                <ControlOption title="Server default" selected={selectedPermissions === null} onPress={() => onSelectPermissions(null)} />
                {controls.permissions.map((permission) => (
                  <ControlOption
                    key={permission.id}
                    title={permissionProfileLabel(permission.id)}
                    subtitle={permission.description === null ? permission.id : `${permission.description} · ${permission.id}`}
                    selected={permission.id === selectedPermissions}
                    disabled={!permission.allowed}
                    onPress={() => onSelectPermissions(permission.id)}
                  />
                ))}
              </>
            )}
          </AppSheetScrollView>
        )}
      </View>
    </AppSheet>
  );
}

function MenuAction({
  icon,
  title,
  subtitle,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap | "push-pin";
  title: string;
  subtitle: string;
  danger?: boolean;
  onPress?(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={onPress === undefined}
      style={({ pressed }) => [styles.menuAction, pressed && styles.pressed, onPress === undefined && styles.disabled]}
      onPress={onPress}
    >
      <View style={styles.menuActionIcon}>
        {icon === "push-pin"
          ? <MaterialIcons name="push-pin" size={21} color={danger ? colors.red : colors.textMuted} />
          : <Ionicons name={icon} size={21} color={danger ? colors.red : colors.textMuted} />}
      </View>
      <View style={styles.menuActionText}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.menuActionTitle, danger && { color: colors.red }]}>{title}</Text>
        {subtitle !== "" && <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menuActionSubtitle}>{subtitle}</Text>}
      </View>
      {onPress !== undefined && <Ionicons name="chevron-forward" size={18} color={colors.textDim} />}
    </Pressable>
  );
}

function ControlOption({ accessibilityLabel, title, subtitle, selected, attention = false, disabled = false, onPress }: { accessibilityLabel?: string; title: string; subtitle?: string; selected: boolean; attention?: boolean; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel ?? title}${selected ? ", selected" : ""}`} accessibilityState={{ selected, disabled }} disabled={disabled} style={({ pressed }) => [styles.controlOption, selected && (attention ? styles.controlOptionAttention : styles.controlOptionSelected), pressed && styles.pressed, disabled && styles.disabled]} onPress={onPress}>
      <View style={styles.controlOptionText}>
        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menuActionTitle}>{title}</Text>
        {subtitle !== undefined && <Text numberOfLines={2} style={styles.menuActionSubtitle}>{subtitle}</Text>}
      </View>
      <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={20} color={selected ? (attention ? colors.amber : colors.accent) : colors.textDim} />
    </Pressable>
  );
}

function pageTitle(page: ComposerMenuPage): string {
  if (page === "model") return "Model & Thinking";
  if (page === "skills") return "Skills";
  if (page === "permissions") return "Permissions";
  if (page === "queue") return "Queued prompts";
  if (page === "goal") return "Goal & progress";
  if (page === "review") return "Review";
  return "Runtime";
}

function cwdLabel(controls: TurnControls): string {
  return controls.skills.length === 0 ? "this workspace" : "the selected workspace";
}

function ApprovalPrompt({ request, requestCount, embedded = false, onRespond }: { request: PendingServerRequest; requestCount: number; embedded?: boolean; onRespond?(request: PendingServerRequest, result: unknown): Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const respond = async (result: unknown) => {
    if (onRespond === undefined) return;
    setSubmitting(true);
    setError(null);
    try {
      await onRespond(request, result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resolve request");
    }
    setSubmitting(false);
  };
  const method = request.method;
  const params = request.params;
  const waiting = submitting || request.state === "resolving";
  const questions = method === "item/tool/requestUserInput" && Array.isArray(params.questions)
    ? params.questions.filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value))
    : [];
  const command = typeof params.command === "string" ? params.command : null;
  const cwd = typeof params.cwd === "string" ? params.cwd : null;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const elicitationMessage = method === "mcpServer/elicitation/request" && typeof params.message === "string" ? params.message : null;
  const elicitationFields = method === "mcpServer/elicitation/request" ? mcpElicitationFields(params) : [];
  const elicitationMode = method === "mcpServer/elicitation/request" && typeof params.mode === "string" ? params.mode : null;
  const elicitationUrl = elicitationMode === "url" && typeof params.url === "string" && isSafeHttpUrl(params.url) ? params.url : null;
  const submitElicitation = () => {
    try {
      const content = Object.fromEntries(elicitationFields.map((field) => {
        const raw = answers[field.id] ?? field.defaultValue;
        if (field.required && raw.trim() === "") throw new Error(`${field.label} is required`);
        return [field.id, parseElicitationValue(field.type, raw)];
      }));
      void respond({ action: "accept", content, _meta: null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid form value");
    }
  };
  return (
    <View style={[styles.approvalCard, embedded && styles.approvalInline]}>
      <View style={styles.approvalTitleRow}>
        <Ionicons name="shield-checkmark-outline" size={21} color={colors.amber} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.approvalTitle}>{approvalTitle(method)}</Text>
        {requestCount > 1 && <Text style={styles.approvalQueueCount}>1/{requestCount}</Text>}
        {waiting && <Text style={styles.approvalPending}>RESOLVING…</Text>}
      </View>
      {reason !== null && <Text numberOfLines={1} style={styles.approvalReason}>{reason}</Text>}
      {elicitationMessage !== null && <Text numberOfLines={2} style={styles.approvalReason}>{elicitationMessage}</Text>}
      {command !== null && <Text selectable numberOfLines={2} style={styles.approvalCommand}>{command}</Text>}
      {cwd !== null && <Text selectable numberOfLines={1} style={styles.approvalCwd}>⌁ {basename(cwd)}</Text>}
      {questions.map((question) => {
        const id = typeof question.id === "string" ? question.id : "question";
        const label = typeof question.question === "string" ? question.question : id;
        const options = Array.isArray(question.options) ? question.options : [];
        return (
          <View key={id} style={styles.approvalQuestion}>
            <Text style={styles.menuActionTitle}>{label}</Text>
            {options.length > 0 && (
              <ScrollView horizontal contentContainerStyle={styles.answerOptions}>
                {options.map((option, index) => {
                  const value = option !== null && typeof option === "object" && "label" in option && typeof option.label === "string" ? option.label : `Option ${index + 1}`;
                  return <ControlOption key={value} title={value} selected={answers[id] === value} onPress={() => setAnswers((current) => ({ ...current, [id]: value }))} />;
                })}
              </ScrollView>
            )}
            <TextInput
              accessibilityLabel={`Answer ${label}`}
              secureTextEntry={question.isSecret === true}
              value={answers[id] ?? ""}
              onChangeText={(value) => setAnswers((current) => ({ ...current, [id]: value }))}
              style={styles.approvalInput}
            />
          </View>
        );
      })}
      {elicitationFields.map((field) => (
        <View key={field.id} style={styles.approvalQuestion}>
          <Text style={styles.menuActionTitle}>{field.label}{field.required ? " *" : ""}</Text>
          {field.description !== null && <Text style={styles.menuActionSubtitle}>{field.description}</Text>}
          {field.options.length > 0 ? (
            <ScrollView horizontal contentContainerStyle={styles.answerOptions}>
              {field.options.map((option) => (
                <ControlOption
                  key={option.value}
                  title={option.label}
                  selected={(answers[field.id] ?? field.defaultValue) === option.value}
                  onPress={() => setAnswers((current) => ({ ...current, [field.id]: option.value }))}
                />
              ))}
            </ScrollView>
          ) : (
            <TextInput
              accessibilityLabel={`Answer ${field.label}`}
              keyboardType={field.type === "number" || field.type === "integer" ? "numeric" : "default"}
              value={answers[field.id] ?? field.defaultValue}
              onChangeText={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
              style={styles.approvalInput}
            />
          )}
        </View>
      ))}
      {elicitationUrl !== null && (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(elicitationUrl)}>
          <Text numberOfLines={2} style={styles.rawLink}>Open secure form · {elicitationUrl}</Text>
        </Pressable>
      )}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.approvalActions}>
        {method === "item/tool/requestUserInput" ? (
          <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ answers: Object.fromEntries(questions.map((question) => {
            const id = typeof question.id === "string" ? question.id : "question";
            return [id, { answers: [answers[id] ?? ""] }];
          })) })} style={[styles.primaryButton, styles.approvalButton]}><Text style={styles.primaryButtonText}>Submit</Text></Pressable>
        ) : method === "item/permissions/requestApproval" ? (
          <>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ permissions: {}, scope: "turn" })} style={[styles.approvalDeclineButton, styles.approvalButton]}><Text style={styles.approvalDeclineText}>Decline</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ permissions: params.permissions ?? {}, scope: "turn" })} style={[styles.primaryButton, styles.approvalButton]}><Text style={styles.primaryButtonText}>Allow turn</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ permissions: params.permissions ?? {}, scope: "session" })} style={[styles.secondaryButton, styles.approvalButton]}><Text style={styles.secondaryButtonText}>For session</Text></Pressable>
          </>
        ) : method === "mcpServer/elicitation/request" ? (
          <>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ action: "decline", content: null, _meta: null })} style={[styles.approvalDeclineButton, styles.approvalButton]}><Text style={styles.approvalDeclineText}>Decline</Text></Pressable>
            {(elicitationFields.length > 0 || elicitationUrl !== null) && (
              <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={elicitationMode === "url" ? () => void respond({ action: "accept", content: null, _meta: null }) : submitElicitation} style={[styles.primaryButton, styles.approvalButton]}>
                <Text style={styles.primaryButtonText}>{elicitationMode === "url" ? "Done" : "Submit"}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ decision: "decline" })} style={[styles.approvalDeclineButton, styles.approvalButton]}><Text style={styles.approvalDeclineText}>Decline</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ decision: "accept" })} style={[styles.primaryButton, styles.approvalButton]}><Text style={styles.primaryButtonText}>Accept once</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={waiting} hitSlop={4} onPress={() => void respond({ decision: "acceptForSession" })} style={[styles.secondaryButton, styles.approvalButton]}><Text style={styles.secondaryButtonText}>For session</Text></Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function approvalTitle(method: string): string {
  if (method === "item/commandExecution/requestApproval") return "Command approval";
  if (method === "item/fileChange/requestApproval") return "File change approval";
  if (method === "item/tool/requestUserInput") return "Codex needs input";
  if (method === "item/permissions/requestApproval") return "Additional permissions";
  return "External tool request";
}

function LocalhostPreview({
  visible,
  onClose,
  onCreate,
  onRevoke,
  resource,
  embedded = false,
}: {
  visible: boolean;
  onClose(): void;
  onCreate?(port: number, ttlSeconds: number): Promise<TunnelPreview>;
  onRevoke?(tunnelId: string): Promise<void>;
  resource: TunnelRow | null;
  embedded?: boolean;
}) {
  const [target, setTarget] = useState("localhost:3000");
  const [ttl, setTtl] = useState("300");
  const tunnel = resource?.tunnel ?? null;
  const loading = resource?.status === "creating" || resource?.status === "revoking";
  const [error, setError] = useState<string | null>(null);
  const effectiveError = error ?? resource?.error ?? null;
  const close = () => {
    const active = tunnel;
    setError(null);
    if (active !== null) void onRevoke?.(active.id).finally(onClose);
    else onClose();
  };
  const create = async () => {
    if (onCreate === undefined) return;
    setError(null);
    try {
      await onCreate(localhostTargetPort(target), Number(ttl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open localhost preview");
    }
  };
  const content = (
      <View style={[styles.previewRoot, embedded && styles.previewEmbeddedRoot]}>
        {!embedded && <View style={styles.previewHeader}>
          <Pressable accessibilityLabel="Close localhost preview" onPress={close} style={styles.headerIcon}>
            <Ionicons name="close" size={25} color={colors.text} />
          </Pressable>
          <View style={styles.previewIdentity}>
            <Text numberOfLines={1} style={styles.conversationTitle}>Localhost preview</Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.conversationSubtitle}>{tunnel === null ? "Explicit server-scoped tunnel" : `Expires ${new Date(tunnel.expiresAt).toLocaleTimeString()}`}</Text>
          </View>
          {tunnel !== null && <View style={styles.livePill}><Text style={styles.livePillText}>● LIVE</Text></View>}
        </View>}
        {tunnel === null ? (
          <View style={styles.previewSetup}>
            <Ionicons name="globe-outline" size={38} color={colors.accent} />
            <Text style={styles.sheetTitle}>Open a bounded localhost tunnel</Text>
            <Text style={styles.menuNotice}>Only 127.0.0.1 on the selected Codex server is reachable. The tunnel expires automatically.</Text>
            <Text style={styles.fieldLabel}>Local service</Text>
            <TextInput voiceInput={false} accessibilityLabel="Local service" autoCapitalize="none" autoCorrect={false} value={target} onChangeText={setTarget} placeholder="localhost:3000" placeholderTextColor={colors.textDim} style={styles.fieldInput} />
            <Text style={styles.fieldLabel}>Keep open</Text>
            <View style={styles.tunnelTtlChoices}>
              {[{ label: "5 min", value: "300" }, { label: "15 min", value: "900" }, { label: "1 hour", value: "3600" }].map((choice) => (
                <Pressable key={choice.value} onPress={() => setTtl(choice.value)} style={[styles.tunnelTtlChip, ttl === choice.value && styles.tunnelTtlChipSelected]}>
                  <Text style={styles.composerContextText}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput accessibilityLabel="Tunnel TTL" keyboardType="number-pad" value={ttl} onChangeText={setTtl} style={styles.fieldInput} />
            {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="Open localhost tunnel" disabled={loading} onPress={() => void create()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{loading ? "Opening…" : "Open preview"}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.flex}>
            {error !== null && <Text style={styles.previewError}>{error}</Text>}
            <WebView
              style={styles.previewWebView}
              source={{ uri: tunnel.url, headers: { Authorization: tunnel.authorization } }}
              originWhitelist={[new URL(tunnel.url).origin]}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled={false}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              renderLoading={() => <ActivityIndicator style={styles.previewLoading} color={colors.accent} />}
              onHttpError={(event) => setError(event.nativeEvent.statusCode === 502 ? "Nothing is listening on that local service" : `Preview returned HTTP ${event.nativeEvent.statusCode}`)}
              onError={(event) => setError(event.nativeEvent.description)}
            />
          </View>
        )}
      </View>
  );
  return visible ? content : null;
}

function localhostTargetPort(rawTarget: string): number {
  const target = rawTarget.trim();
  if (/^\d+$/u.test(target)) {
    const port = Number(target);
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) return port;
  }
  let parsed: URL;
  try {
    parsed = new URL(target.includes("://") ? target : `http://${target}`);
  } catch {
    throw new Error("Use localhost:3000 or paste a localhost URL");
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname) || parsed.port === "") {
    throw new Error("Only an explicit localhost port can be opened");
  }
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535");
  return port;
}

function Card({
  title,
  icon,
  status,
  copyText,
  collapsible = false,
  initiallyExpanded = true,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  status?: string;
  copyText?: () => string;
  collapsible?: boolean;
  initiallyExpanded?: boolean;
  children: ReactNode;
}) {
  const itemKey = useContext(ExpansionItemKeyContext);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:card`, initiallyExpanded);
  const forceExpanded = useContext(ForceExpandCardsContext);
  const activeToolCall = useContext(ActiveToolCallContext);
  const isRunning = status === "inProgress" || status === "running" || activeToolCall;
  const visiblyExpanded = forceExpanded || expanded;
  return (
    <View testID="protocol-card" collapsable={false} style={styles.card}>
      <View testID="protocol-card-header" collapsable={false} style={styles.cardHeader}>
        <Pressable
          accessibilityRole={collapsible ? "button" : undefined}
          accessibilityLabel={collapsible ? `${visiblyExpanded ? "Collapse" : "Expand"} ${title}` : undefined}
          disabled={!collapsible}
          hitSlop={collapsible ? 10 : undefined}
          onPress={() => setExpanded(!visiblyExpanded)}
          style={styles.cardHeaderToggle}
        >
          <View testID="protocol-card-icon" style={styles.cardIconSlot}><Ionicons name={icon} size={14} color={colors.textMuted} /></View>
          {isRunning
            ? <WaveText key="running-title" text={title} style={styles.cardTitle} containerStyle={styles.cardTitleWave} />
            : <Text key="settled-title" numberOfLines={1} style={styles.cardTitle}>{title}</Text>}
          <View style={styles.flex} />
          {status && !isRunning && (
            <View accessible accessibilityLabel={`Status ${status}`} style={styles.cardStatusIcon}>
              {status === "failed" || status === "error"
                  ? <Ionicons name="alert-circle" size={15} color={colors.red} />
                  : <View style={styles.cardStatusDot} />}
            </View>
          )}
          {collapsible && <Ionicons name={visiblyExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textDim} />}
        </Pressable>
        {copyText !== undefined && !collapsible && <CopyButton getText={copyText} />}
      </View>
      {(!collapsible || visiblyExpanded) && <View style={styles.cardContent}>{children}</View>}
    </View>
  );
}

function usePersistentExpansion(
  localKey: string,
  initialValue: boolean,
): [boolean, (value: boolean | ((current: boolean) => boolean)) => void] {
  // ExpansionItemKey already includes the connection/thread/turn identity.
  // The bounded external cache survives LegendList recycling without a broad
  // React context update whenever an unrelated live turn changes.
  const [value, setValueState] = useState(() => persistentExpansionStates.get(localKey) ?? initialValue);
  const setValue = (next: boolean | ((current: boolean) => boolean)) => {
    setValueState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writePersistentExpansionState(localKey, resolved);
      return resolved;
    });
  };
  return [value, setValue];
}

function CopyButton({ text, getText, compact = false }: { text?: string; getText?: () => string; compact?: boolean }) {
  return (
    <Pressable accessibilityLabel="Copy" hitSlop={7} onPress={() => void Clipboard.setStringAsync(getText?.() ?? text ?? "")} style={compact ? styles.copyButtonCompact : styles.copyButton}>
      <Ionicons name="copy-outline" size={compact ? 13 : 15} color={colors.textMuted} />
    </Pressable>
  );
}

function MessageContextMenu({ copyText, forkEnabled, onFork, children }: { copyText: string; forkEnabled: boolean; onFork?(): Promise<void>; children: React.ReactNode }) {
  const dialog = useAppDialog();
  const canCopy = copyText !== "";
  const canFork = forkEnabled && onFork !== undefined;
  const actions: ActionMenuItem[] = [
    { id: "copy", label: "Copy", icon: "copy-outline", disabled: !canCopy },
    { id: "fork", label: "Fork", icon: "git-branch-outline", disabled: !canFork },
  ];
  const handleAction = (id: string) => {
    if (id === "copy") {
      void Clipboard.setStringAsync(copyText);
      return;
    }
    if (id === "fork" && canFork && onFork !== undefined) {
      void onFork().catch((cause) => dialog.alert("Fork failed", cause instanceof Error ? cause.message : "Could not fork thread"));
    }
  };
  return (
    <ActionMenu
      accessibilityLabel="Message actions"
      actions={actions}
      trigger="long-press"
      placement="top"
      align="start"
      onSelect={handleAction}
      style={styles.messageContextRoot}
    >
      <GesturePressable
        accessible={false}
        cancelable
        delayLongPress={350}
      >
        {children}
      </GesturePressable>
    </ActionMenu>
  );
}

function OptimisticTurn({ item, onRetry }: { item: Extract<TimelineItem, { kind: "optimistic" }>; onRetry?(commandId: string): Promise<void> }) {
  const failed = item.status === "failed";
  const delivered = item.status === "delivered";
  const deliveryLabel = failed
    ? "Failed"
    : delivered
      ? "Sent"
      : item.status === "uncertain"
        ? "Checking delivery"
        : "Sending";
  const [retrying, setRetrying] = useState(false);
  const dialog = useAppDialog();
  const retry = () => {
    if (onRetry === undefined || retrying) return;
    setRetrying(true);
    void onRetry(item.id).catch((cause: unknown) => {
      setRetrying(false);
      dialog.alert("Retry failed", cause instanceof Error ? cause.message : "Could not retry message");
    });
  };
  return (
    <View testID="turn-group" style={styles.turnGroup}>
      <View style={styles.userTurnCluster}>
      <RecoverableRenderBoundary scope="bubble" label="Pending user message" context={`Delivery: ${item.id}`} resetKey={`${item.scope}:${item.id}`}>
      <MessageContextMenu copyText={item.text} forkEnabled={false}>
        <View style={styles.userMessageRow}>
          <Text style={styles.messageTime}>{formatClockTime(item.createdAt / 1_000)}</Text>
          <View testID="user-bubble" style={styles.userBubble}>
            {item.attachments.length > 0 && <View style={styles.optimisticAttachments}>
              {item.attachments.map((attachment) => (
                <View key={attachment.id} style={styles.attachmentChip}>
                  <Ionicons name={attachment.kind === "image" ? "image-outline" : attachment.kind === "audio" ? "mic-outline" : "document-outline"} size={15} color={colors.textMuted} />
                  <Text numberOfLines={1} style={styles.queueAttachmentName}>{attachment.name}</Text>
                </View>
              ))}
            </View>}
            {item.text !== "" && <Text selectable style={styles.userBubbleText}>{item.text}</Text>}
          </View>
        </View>
      </MessageContextMenu>
      </RecoverableRenderBoundary>
      <View
        accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
        testID="optimistic-turn-footer"
        style={[styles.turnFooter, styles.turnFooterEnd]}
      >
        {failed
          ? <View style={[styles.turnStatusDot, styles.turnStatusFailed]} />
          : delivered
            ? <View style={[styles.turnStatusDot, styles.turnStatusCompleted]} />
            : <CalmSpinner size={9} color={colors.textMuted} durationMs={3_000} />}
        <Text style={styles.turnMetaText}>{deliveryLabel}</Text>
        {failed && onRetry !== undefined && (
          <Pressable
            accessibilityLabel="Retry message"
            disabled={retrying}
            hitSlop={7}
            onPress={retry}
            style={({ pressed }) => [styles.retryMessageButton, pressed && styles.pressed, retrying && styles.disabled]}
          >
            {retrying
              ? <CalmSpinner size={9} color={colors.textMuted} durationMs={1_400} />
              : <Ionicons name="refresh" size={14} color={colors.accent} />}
            <Text style={styles.retryMessageText}>Retry</Text>
          </Pressable>
        )}
      </View>
      {failed && (
        <Text accessibilityLiveRegion="polite" selectable style={styles.optimisticError}>
          {item.lastError === null
            ? "Message was rejected. Edit it and retry."
            : `Message was rejected: ${item.lastError}`}
        </Text>
      )}
      </View>
    </View>
  );
}

type CachedTurnProjection = {
  topologyRevision: string;
  renderWindow: ReturnType<typeof selectTurnRenderWindow>;
  userRevision: string;
  userBlocks: RenderBlock[];
  latestAgentRevision: string;
  latestAgentBlock: RenderBlock | null;
  liveActivityRevision: string;
  liveActivityBlocks: RenderBlock[];
};

const turnProjectionCache = new Map<string, CachedTurnProjection>();
const TURN_PROJECTION_CACHE_MAX_ENTRIES = 64;

function cachedThreadItemBlock(
  turn: Extract<TimelineItem, { kind: "turn" }>,
  item: Thread["turns"][number]["items"][number],
  index: number,
): RenderBlock {
  const revision = threadItemRenderRevision(item);
  const cached = liveBlockProjectionCache.get(item);
  if (cached?.revision === revision) return cached.block;
  const block = projectThreadItem(turn, item, index);
  liveBlockProjectionCache.set(item, { revision, block });
  return block;
}

function cachedTurnProjection(turn: Extract<TimelineItem, { kind: "turn" }>): CachedTurnProjection {
  const rawTurn = turn.turn;
  const lastItem = rawTurn.items.at(-1);
  const key = `${turn.scope}\u0000${turn.id}`;
  const topologyRevision = `${rawTurn.status}\u0000${rawTurn.items.length}\u0000${lastItem?.id ?? ""}\u0000${lastItem?.type ?? ""}`;
  const previous = turnProjectionCache.get(key);
  const renderWindow = previous?.topologyRevision === topologyRevision
    ? previous.renderWindow
    : selectTurnRenderWindow(rawTurn);
  const userRevision = renderWindow.userItemIndexes.map((index) => threadItemRenderRevision(rawTurn.items[index])).join("\u0001");
  const userBlocks = previous?.userRevision === userRevision
    ? previous.userBlocks
    : renderWindow.userItemIndexes.flatMap((index) => {
        const item = rawTurn.items[index];
        return item === undefined ? [] : [cachedThreadItemBlock(turn, item, index)];
      });
  const latestAgentItem = renderWindow.latestAgentIndex < 0 ? undefined : rawTurn.items[renderWindow.latestAgentIndex];
  const latestAgentRevision = threadItemRenderRevision(latestAgentItem);
  const latestAgentBlock = previous?.latestAgentRevision === latestAgentRevision
    ? previous.latestAgentBlock
    : latestAgentItem === undefined
      ? null
      : cachedThreadItemBlock(turn, latestAgentItem, renderWindow.latestAgentIndex);
  const liveActivityRevision = renderWindow.liveActivityIndexes.map((index) => threadItemRenderRevision(rawTurn.items[index])).join("\u0001");
  const liveActivityBlocks = previous?.liveActivityRevision === liveActivityRevision
    ? previous.liveActivityBlocks
    : renderWindow.liveActivityIndexes.flatMap((index) => {
        const item = rawTurn.items[index];
        return item === undefined ? [] : [cachedThreadItemBlock(turn, item, index)];
      });
  const next = { topologyRevision, renderWindow, userRevision, userBlocks, latestAgentRevision, latestAgentBlock, liveActivityRevision, liveActivityBlocks };
  turnProjectionCache.delete(key);
  turnProjectionCache.set(key, next);
  while (turnProjectionCache.size > TURN_PROJECTION_CACHE_MAX_ENTRIES) {
    const oldest = turnProjectionCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    turnProjectionCache.delete(oldest);
  }
  return next;
}

function TurnTimelineItem({
  turn,
  compact,
  usage = null,
  forceExpanded = false,
  pendingRequest,
  pendingRequestCount,
  onRespondToRequest,
  getTransferAccess,
  onFixUnsupportedBlock,
  onForkThroughTurn,
  onLoadItems,
}: {
  turn: Extract<TimelineItem, { kind: "turn" }>;
  compact: boolean;
  usage?: TurnUsageProjection | null;
  forceExpanded?: boolean;
  pendingRequest: PendingServerRequest | null;
  pendingRequestCount: number;
  onRespondToRequest?(request: PendingServerRequest, result: unknown): Promise<void>;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
  onForkThroughTurn?(turnId: string): Promise<void>;
  onLoadItems?(turnId: string): Promise<void>;
}) {
  const rawTurn = turn.turn;
  const { renderWindow, userBlocks, latestAgentBlock, liveActivityBlocks } = cachedTurnProjection(turn);
  const liveActivityEntries = renderWindow.liveActivityIndexes.flatMap((itemIndex, projectionIndex) => {
    const block = liveActivityBlocks[projectionIndex];
    return block === undefined ? [] : [{ index: itemIndex, block }];
  });
  const liveActivitySequence = rawTurn.status === "inProgress"
    ? activeTurnSequence(liveActivityEntries, renderWindow.collapsedActivityIndexes)
    : [];
  const copyText = latestAgentBlock?.body ?? "";
  const userCopyText = userBlocks.map((block) => protocolCopyText(block)).join("\n");
  const canForkThrough = rawTurn.status !== "inProgress" && onForkThroughTurn !== undefined;
  const completedWithoutFinal = rawTurn.status === "completed" && latestAgentBlock === null;
  const agentMarkdownLayout = latestAgentBlock === null ? "intrinsic" : richMarkdownLayout(latestAgentBlock.body ?? "");
  const agentBubbleWide = rawTurn.status === "inProgress"
    || latestAgentBlock?.content?.fields["/text"] !== undefined
    || agentMarkdownLayout === "fill";
  const hasAgentContent = (rawTurn.status !== "inProgress"
    ? rawTurn.itemsView !== "full" || completedActivityItemCount(rawTurn) > 0 || latestAgentBlock !== null
    : liveActivitySequence.length > 0 || latestAgentBlock !== null)
    || pendingRequest !== null
    || completedWithoutFinal;
  const showAgentBubble = hasAgentContent || rawTurn.status !== "inProgress";
  const hasUserMedia = userBlocks.some((block) => Array.isArray(block.raw.content) && block.raw.content.some((part) => {
    if (part === null || typeof part !== "object" || Array.isArray(part)) return false;
    const type = (part as Record<string, unknown>).type;
    return type === "image" || type === "localImage";
  }));

  return (
    <PrivateAssetRecoveryProvider {...(onLoadItems === undefined ? {} : { recover: () => onLoadItems(turn.id) })}>
    <View testID="turn-group" style={styles.turnGroup}>
      {userBlocks.length > 0 && (
        <View style={styles.userTurnCluster}>
        <RecoverableRenderBoundary scope="bubble" label="User message" context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`} resetKey={`${turn.key}:user`}>
        <MessageContextMenu copyText={userCopyText} forkEnabled={canForkThrough} {...(onForkThroughTurn === undefined ? {} : { onFork: () => onForkThroughTurn(turn.id) })}>
          <ImagePreviewGroup id={`${turn.key}:user`}>
          <View style={styles.userMessageRow}>
          {rawTurn.startedAt !== null && <Text style={styles.messageTime}>{formatClockTime(rawTurn.startedAt)}</Text>}
          <View testID="user-bubble" style={[styles.userBubble, hasUserMedia && styles.userBubbleMedia]}>
            <View style={styles.userMessageContent}>
              {userBlocks.map((block, index) => (
                <View key={`${block.key}:${index}`}>
                  <UserMessageContent
                    content={Array.isArray(block.raw.content) ? block.raw.content : []}
                    {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  />
                  <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
                </View>
              ))}
            </View>
          </View>
          </View>
          </ImagePreviewGroup>
        </MessageContextMenu>
        </RecoverableRenderBoundary>
        </View>
      )}
      {showAgentBubble && (
        <RecoverableRenderBoundary scope="bubble" label="Agent message" context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`} resetKey={`${turn.key}:agent`}>
        <MessageContextMenu copyText={copyText} forkEnabled={canForkThrough} {...(onForkThroughTurn === undefined ? {} : { onFork: () => onForkThroughTurn(turn.id) })}>
          <ImagePreviewGroup id={`${turn.key}:agent`}>
          <View style={styles.agentMessageRow}>
          <View testID="codex-bubble" style={[styles.codexBubble, agentBubbleWide && styles.codexBubbleWide]}>
          {rawTurn.status !== "inProgress" && (
            <CompletedTurnHistory
              item={turn}
              compact={compact}
              forceExpanded={forceExpanded}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              {...(onLoadItems === undefined ? {} : { onLoadItems })}
            />
          )}
          {rawTurn.status !== "inProgress" && latestAgentBlock !== null && (
            <AgentResponseMarkdown block={latestAgentBlock} layout={agentMarkdownLayout} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
          )}
          {rawTurn.status === "inProgress" && liveActivitySequence.map((part, index) => part.kind === "collapsedActivity"
            ? <CollapsedTurnActivity
                key={`${part.key}:${index}`}
                item={turn}
                indexes={part.indexes}
                compact={compact}
                forceExpanded={forceExpanded}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            : part.kind === "agent"
              ? <LiveAgentResponse key={`${part.key}:${index}`} cacheKey={part.block.key} source={part.block.body ?? ""} />
              : <TurnActivitySegment
                key={`${part.key}:${index}`}
                turnKey={turn.key}
                part={part}
                turnStatus={rawTurn.status}
                compact={compact}
                forceExpanded={forceExpanded}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />)}
          {pendingRequest !== null && (
            <ApprovalPrompt
              key={pendingRequest.requestKey}
              embedded
              request={pendingRequest}
              requestCount={pendingRequestCount}
              {...(onRespondToRequest === undefined ? {} : { onRespond: onRespondToRequest })}
            />
          )}
          {completedWithoutFinal && <Text style={styles.agentPlaceholder}>Completed without final response</Text>}
          {!hasAgentContent && <Text style={styles.agentPlaceholder}>{rawTurn.status === "failed" ? "The turn failed before Codex returned a response." : "Stopped before a response was completed."}</Text>}
          </View>
          {rawTurn.completedAt !== null && <Text style={styles.messageTime}>{formatClockTime(rawTurn.completedAt)}</Text>}
          </View>
          </ImagePreviewGroup>
        </MessageContextMenu>
        </RecoverableRenderBoundary>
      )}
      <TurnFooter
        status={rawTurn.status}
        durationMs={rawTurn.durationMs}
        completedAt={rawTurn.completedAt}
        usage={usage}
      />
    </View>
    </PrivateAssetRecoveryProvider>
  );
}

type LiveContentMode = "markdown" | "code";

function StableLiveTextSegment({ text, mode }: { text: string; mode: LiveContentMode }) {
  return mode === "markdown"
    ? <RichMarkdown source={text} />
    : <Text selectable style={styles.codeLine}>{text}</Text>;
}

function AppendOnlyLiveContent({ cacheKey, source, mode }: { cacheKey: string; source: string; mode: LiveContentMode }) {
  const projection = projectCachedLiveText(cacheKey, source);
  return (
    <View
      testID={mode === "markdown" ? "live-agent-response" : "live-tool-output"}
      style={[styles.liveAgentResponse, mode === "markdown" && styles.liveMarkdownResponse]}
    >
      {projection.segments.map((segment, index) => <StableLiveTextSegment key={`${cacheKey}:${index}`} text={segment} mode={mode} />)}
      {projection.remainder !== "" && <StableLiveTextSegment text={projection.remainder} mode={mode} />}
    </View>
  );
}

function LiveAgentResponse({ cacheKey, source }: { cacheKey: string; source: string }) {
  return <AppendOnlyLiveContent cacheKey={cacheKey} source={source} mode="markdown" />;
}

function CollapsedTurnActivity({
  item,
  indexes,
  compact,
  forceExpanded,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  item: Extract<TimelineItem, { kind: "turn" }>;
  indexes: number[];
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const rawTurn = item.turn;
  const [expanded, setExpanded] = usePersistentExpansion(`${item.key}:prior-activity:${indexes[0] ?? "empty"}`, false);
  const [visibleBlockCount, setVisibleBlockCount] = useRecyclingState(16);
  const isExpanded = forceExpanded || expanded;
  const activityKinds = indexes.flatMap((index) => {
    const rawItem = rawTurn.items[index];
    return rawItem === undefined ? [] : [rawItem.type];
  });
  const blocks = !isExpanded
    ? []
    : indexes.slice(0, visibleBlockCount).flatMap((index) => {
        const rawItem = rawTurn.items[index];
        return rawItem === undefined ? [] : [projectThreadItem(item, rawItem, index)];
      });

  return (
    <TurnActivity
      expanded={isExpanded}
      forceExpandCards={forceExpanded}
      label={`${turnActivityLabel(activityKinds, compact)} · ${indexes.length}`}
      onToggle={() => setExpanded(!isExpanded)}
    >
      {blocks.map((block, index) => block.kind === "agentMessage"
        ? <RichMarkdown key={`${block.key}:${index}`} source={block.body ?? ""} />
        : <ExpansionItemKeyContext.Provider key={`${block.key}:${index}`} value={`${item.key}:${block.key}`}>
            <ProtocolBlock
              block={block}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          </ExpansionItemKeyContext.Provider>)}
      {visibleBlockCount < indexes.length && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleBlockCount((current) => Math.min(indexes.length, current + 16))}
          style={styles.activityMoreButton}
        >
          <Text style={styles.activityMoreText}>Show {Math.min(16, indexes.length - visibleBlockCount)} more</Text>
        </Pressable>
      )}
    </TurnActivity>
  );
}

function CompletedTurnHistory({
  item,
  compact,
  forceExpanded,
  getTransferAccess,
  onFixUnsupportedBlock,
  onLoadItems,
}: {
  item: Extract<TimelineItem, { kind: "turn" }>;
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
  onLoadItems?(turnId: string): Promise<void>;
}) {
  const rawTurn = item.turn;
  const [expanded, setExpanded] = usePersistentExpansion(`${item.key}:completed-history`, false);
  const [loading, setLoading] = useRecyclingState(false);
  const [error, setError] = useRecyclingState<string | null>(null);
  const [visibleBlockCount, setVisibleBlockCount] = useRecyclingState(16);
  const requestedTurnRef = useRef<string | null>(null);
  const isExpanded = forceExpanded || expanded;
  const activityItems = selectTurnRenderWindow(rawTurn).collapsedActivityIndexes.flatMap((index) => {
    const rawItem = rawTurn.items[index];
    return rawItem === undefined ? [] : [{ rawItem, index }];
  });
  const metadataKinds = turnMetadataKinds(rawTurn);
  const activitySummary = projectedTurnMetadata(rawTurn)?.activity;
  const activityKinds = [
    ...(activityItems.length > 0 ? activityItems.map(({ rawItem }) => rawItem.type) : activitySummary?.kinds ?? []),
    ...metadataKinds,
  ];
  const activityCount = activityItems.length > 0
    ? activityItems.length + metadataKinds.length
    : (activitySummary?.count ?? 0) + metadataKinds.length;
  const blocks = !isExpanded || rawTurn.itemsView !== "full"
    ? []
    : [
        ...activityItems.slice(0, visibleBlockCount).map(({ rawItem, index }) => projectThreadItem(item, rawItem, index)),
        ...(forceExpanded || visibleBlockCount >= activityItems.length ? turnMetadataBlocks(item.key, rawTurn) : []),
      ];
  const load = () => {
    if (requestedTurnRef.current === rawTurn.id || rawTurn.itemsView === "full" || onLoadItems === undefined) return;
    requestedTurnRef.current = rawTurn.id;
    setLoading(true);
    setError(null);
    void onLoadItems(rawTurn.id).catch((cause: unknown) => {
      requestedTurnRef.current = null;
      setError(cause instanceof Error ? cause.message : "Could not load activity");
    }).finally(() => setLoading(false));
  };
  if (rawTurn.itemsView === "full" && activityCount === 0) return null;
  return (
    <TurnActivity
      expanded={isExpanded}
      forceExpandCards={forceExpanded}
      loading={loading}
      label={loading
        ? "Loading activity…"
        : error !== null
          ? "Activity unavailable"
          : rawTurn.itemsView === "full"
            ? `${turnActivityLabel(activityKinds, compact)} · ${activityCount}`
            : activityCount > 0
              ? `${turnActivityLabel(activityKinds, compact)} · ${activityCount}`
              : "Activity"}
      onToggle={() => {
        const next = !isExpanded;
        setExpanded(next);
        if (next) load();
      }}
    >
      {error !== null && <Text style={styles.agentPlaceholder}>{error}</Text>}
      {blocks.map((block, index) => block.kind === "agentMessage"
        ? <RichMarkdown key={`${block.key}:${index}`} source={block.body ?? ""} />
        : <ExpansionItemKeyContext.Provider key={`${block.key}:${index}`} value={`${item.key}:${block.key}`}>
            <ProtocolBlock
              block={block}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          </ExpansionItemKeyContext.Provider>)}
      {rawTurn.itemsView === "full" && visibleBlockCount < activityItems.length && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleBlockCount((current) => Math.min(activityItems.length, current + 16))}
          style={styles.activityMoreButton}
        >
          <Text style={styles.activityMoreText}>Show {Math.min(16, activityItems.length - visibleBlockCount)} more</Text>
        </Pressable>
      )}
    </TurnActivity>
  );
}

function projectThreadItem(
  row: Extract<TimelineItem, { kind: "turn" }>,
  rawItem: Thread["turns"][number]["items"][number],
  index: number,
): RenderBlock {
  return toRenderBlock(normalizeThreadItem(connectionId(row.connectionId), row.threadId, row.turn.id, rawItem, index));
}

function threadItemRenderRevision(item: Thread["turns"][number]["items"][number] | undefined): string {
  if (item === undefined) return "missing";
  const value = item as unknown as Record<string, unknown>;
  return [
    item.id,
    item.type,
    value.status,
    value.phase,
    textSample(value.command),
    textSample(value.text),
    textSample(value.aggregatedOutput),
    textSample(value.error),
    stringArrayRevision(value.summary),
    stringArrayRevision(value.content),
    userContentRevision(value.content),
    stringArrayRevision(value.progress),
    objectArrayRevision(value.changes),
    structuredEdgeRevision(value.arguments),
    structuredEdgeRevision(value.result),
    structuredEdgeRevision(value.contentItems),
    structuredEdgeRevision(value.agentsStates),
  ].join("\u0000");
}

function userContentRevision(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return `${value.length}:${userContentPartRevision(value[0])}:${userContentPartRevision(value.at(-1))}`;
}

function userContentPartRevision(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const part = value as Record<string, unknown>;
  return `${String(part.type ?? "")}:${String(part.path ?? "")}:${textSample(part.url)}:${textSample(part.text)}`;
}

function stringArrayRevision(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return `${value.length}:${textSample(value[0])}:${textSample(value.at(-1))}`;
}

function objectArrayRevision(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const first = value[0];
  const last = value.at(-1);
  return `${value.length}:${objectEdgeRevision(first)}:${objectEdgeRevision(last)}`;
}

function objectEdgeRevision(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return textSample(value);
  const entry = value as Record<string, unknown>;
  return `${String(entry.path ?? "")}:${String(entry.kind ?? "")}:${textSample(entry.diff)}`;
}

function structuredEdgeRevision(value: unknown): string {
  if (typeof value === "string") return textSample(value);
  if (value === null || typeof value !== "object") return String(value ?? "");
  if (Array.isArray(value)) {
    return `${value.length}:${structuredEdgeRevision(value[0])}:${structuredEdgeRevision(value.at(-1))}`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const firstKey = keys[0];
  const lastKey = keys.at(-1);
  return `${keys.length}:${firstKey ?? ""}=${firstKey === undefined ? "" : structuredLeafRevision(record[firstKey])}:${lastKey ?? ""}=${lastKey === undefined ? "" : structuredLeafRevision(record[lastKey])}`;
}

function structuredLeafRevision(value: unknown): string {
  if (typeof value === "string") return textSample(value);
  if (Array.isArray(value)) return `${value.length}:${textSample(value[0])}:${textSample(value.at(-1))}`;
  if (value !== null && typeof value === "object") return `object:${Object.keys(value).length}`;
  return String(value ?? "");
}

function completedActivityItemCount(turn: Thread["turns"][number]): number {
  return Math.max(
    selectTurnRenderWindow(turn).collapsedActivityIndexes.length,
    projectedTurnMetadata(turn)?.activity?.count ?? 0,
  );
}

function turnMetadataKinds(turn: Thread["turns"][number]): string[] {
  const metadata = projectedTurnMetadata(turn);
  if (metadata === null) return [];
  return [
    ...(metadata.plan === undefined ? [] : ["turnPlan"]),
    ...(metadata.diff === undefined ? [] : ["turnDiff"]),
  ];
}

function TurnActivitySegment({
  turnKey,
  part,
  turnStatus,
  compact,
  forceExpanded,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  turnKey: string;
  part: Extract<TurnSequencePart, { kind: "activity" }>;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const thinkingOnly = part.blocks.length > 0 && part.blocks.every((block) => block.kind === "reasoning");
  const agentNavigationOnly = part.blocks.length > 0 && part.blocks.every((block) => (
    block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity"
  ));
  const shouldAutoExpand = turnStatus === "inProgress" && !part.followedByAgent;
  const [expanded, setExpanded] = usePersistentExpansion(`${turnKey}:${part.key}`, false);
  const visiblyExpanded = forceExpanded || shouldAutoExpand || expanded;
  if (thinkingOnly) {
    return (
      <View testID="thinking-status-section" style={styles.thinkingStatusSection}>
        {part.blocks.map((block, index) => (
          <ActiveToolCallContext.Provider key={block.key} value={turnStatus === "inProgress" && index === part.blocks.length - 1}>
            <ProtocolBlock block={block} />
          </ActiveToolCallContext.Provider>
        ))}
      </View>
    );
  }
  if (agentNavigationOnly) {
    return (
      <View testID="subagent-activity-navigation" style={styles.agentNavigationList}>
        {part.blocks.map((block) => (
          <ExpansionItemKeyContext.Provider key={block.key} value={`${turnKey}:${block.key}`}>
            <ProtocolBlock
              block={block}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          </ExpansionItemKeyContext.Provider>
        ))}
      </View>
    );
  }
  return (
    <TurnActivity
      expanded={visiblyExpanded}
      forceExpandCards={forceExpanded}
      label={turnActivityLabel(part.blocks.map((block) => block.kind), compact)}
      onToggle={() => setExpanded((value) => !value)}
    >
      {part.blocks.map((block, index) => (
        <ActiveToolCallContext.Provider key={block.key} value={shouldAutoExpand && index === part.blocks.length - 1}>
          <ExpansionItemKeyContext.Provider value={`${turnKey}:${block.key}`}>
            <ProtocolBlock
              block={block}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          </ExpansionItemKeyContext.Provider>
        </ActiveToolCallContext.Provider>
      ))}
    </TurnActivity>
  );
}

function TurnActivity({ expanded, forceExpandCards = false, loading = false, label, onToggle, children }: { expanded: boolean; forceExpandCards?: boolean; loading?: boolean; label: string; onToggle(): void; children: React.ReactNode }) {
  return (
    <View testID="turn-activity" style={[styles.turnActivity, expanded && styles.turnActivityExpanded]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity ${label}`} hitSlop={10} onPress={onToggle} style={({ pressed }) => [styles.turnActivityToggle, pressed && styles.pressed]}>
        <View style={styles.activityIconSlot}><Ionicons name="construct-outline" size={13} color={colors.textMuted} /></View>
        {loading
          ? <WaveText testID="turn-activity-loading-shimmer" text={label} style={styles.turnActivityLabel} containerStyle={styles.turnActivityLabelWave} />
          : <Text numberOfLines={1} style={styles.turnActivityLabel}>{label}</Text>}
        <View style={styles.activityChevronSlot}><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={colors.textDim} /></View>
      </Pressable>
      {expanded && (
        <ForceExpandCardsContext.Provider value={forceExpandCards}>
          <TurnActivityContentContext.Provider value>
            <View testID="turn-activity-list" style={styles.turnActivityList}>{children}</View>
          </TurnActivityContentContext.Provider>
        </ForceExpandCardsContext.Provider>
      )}
    </View>
  );
}

function TurnFooter({ status, durationMs, usage = null }: { status: "completed" | "interrupted" | "failed" | "inProgress"; durationMs: number | null; completedAt: number | null; usage?: TurnUsageProjection | null }) {
  const tokenUsage = usage?.turn.tokens ?? null;
  const estimatedCost = usage?.turn.cost ?? null;
  return (
    <View
      testID="turn-footer"
      style={styles.turnFooter}
    >
      {status === "inProgress"
        ? <CalmSpinner size={9} color={colors.textMuted} durationMs={3_000} />
        : <View style={[styles.turnStatusDot, status === "failed" ? styles.turnStatusFailed : status === "interrupted" ? styles.turnStatusStopped : styles.turnStatusCompleted]} />}
      {status === "inProgress"
        ? <Text testID="running-turn-footer-label" style={styles.turnMetaText}>Running</Text>
        : <Text style={styles.turnMetaText}>{status === "completed" ? "Completed" : status === "interrupted" ? "Stopped" : "Failed"}</Text>}
      {durationMs !== null && <Text style={styles.turnMetaText}>{formatDuration(durationMs)}</Text>}
      {tokenUsage !== null && (status === "inProgress"
        ? <AnimatedNumber accessibilityLabel={`${tokenUsage.inputTokens.toLocaleString()} input tokens`} value={tokenUsage.inputTokens} format={compactNumberFormat} prefix="↓" style={styles.turnMetaText} />
        : <Text accessibilityLabel={`${tokenUsage.inputTokens.toLocaleString()} input tokens`} style={styles.turnMetaText}>↓{compactNumber(tokenUsage.inputTokens)}</Text>)}
      {tokenUsage !== null && (status === "inProgress"
        ? <AnimatedNumber accessibilityLabel={`${tokenUsage.outputTokens.toLocaleString()} output tokens`} value={tokenUsage.outputTokens} format={compactNumberFormat} prefix="↑" style={styles.turnMetaText} />
        : <Text accessibilityLabel={`${tokenUsage.outputTokens.toLocaleString()} output tokens`} style={styles.turnMetaText}>↑{compactNumber(tokenUsage.outputTokens)}</Text>)}
      {estimatedCost !== null && <CostBreakdownPopover estimate={estimatedCost} animated={status === "inProgress"} />}
    </View>
  );
}

function CalmSpinner({ size, color, durationMs }: { size: number; color: string; durationMs: number }) {
  const reducedMotion = useReducedMotionPreference();
  const rotation = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(rotation);
    rotation.value = reducedMotion
      ? 0
      : withRepeat(withTiming(1, { duration: durationMs, easing: ReanimatedEasing.linear }), -1, false);
    return () => cancelAnimation(rotation);
  }, [durationMs, reducedMotion, rotation]);
  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 360}deg` }],
  }));
  return (
    <Reanimated.View
      testID="calm-running-spinner"
      style={[{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.25,
        borderColor: color,
        borderTopColor: "transparent",
        opacity: 0.72,
      }, rotationStyle]}
    />
  );
}

function turnActivityLabel(kinds: string[], compact = false): string {
  const labels: string[] = [];
  if (kinds.some((kind) => kind === "fileChange" || kind === "turnDiff" || kind === "diff")) labels.push("Edited files");
  if (kinds.some((kind) => kind === "commandExecution" || kind === "terminal")) labels.push("ran commands");
  if (kinds.some((kind) => kind === "webSearch")) labels.push("searched web");
  if (kinds.some((kind) => kind === "mcpToolCall" || kind === "dynamicToolCall" || kind === "tool")) labels.push("used tools");
  if (kinds.some((kind) => kind === "collabAgentToolCall" || kind === "subAgentActivity")) labels.push("coordinated agents");
  if (compact) {
    const shortLabels = labels.slice(0, 2).map((label) => label === "coordinated agents" ? "agents" : label);
    return `${shortLabels.length === 0 ? "Activity" : shortLabels.join(", ")} · ${kinds.length}`;
  }
  if (labels.length === 0) return `${kinds.length} ${kinds.length === 1 ? "activity" : "activities"}`;
  return labels.join(", ");
}

function ProtocolBlock({
  block,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const insideTurnActivity = useContext(TurnActivityContentContext);
  if (block.kind === "userMessage") {
    const content = Array.isArray(block.raw.content) ? block.raw.content : [];
    return (
      <View testID="user-bubble" style={styles.userBubble}>
        <UserMessageContent content={content} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
        <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
      </View>
    );
  }
  if (block.kind === "agentMessage") {
    return (
      <View style={styles.agentMessage}>
        <CompleteAgentMarkdown source={block.body ?? ""} layout={richMarkdownLayout(block.body ?? "")} />
        <MemoryCitationList value={block.raw.memoryCitation} />
        <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
      </View>
    );
  }
  if (block.kind === "tokenUsage") return <TokenUsageProtocolBlock block={block} />;
  if (block.kind === "fileChange") return <><FileChangeProtocolBlock block={block} /><LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /></>;
  if (block.kind === "mcpToolCall" || block.kind === "dynamicToolCall") return <><ToolCallProtocolBlock block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /><LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /></>;
  if (block.kind === "webSearch") return <><WebSearchProtocolBlock block={block} /><LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /></>;
  if (block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity") return <><AgentActivityProtocolBlock block={block} /><LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /></>;
  if (block.kind === "imageView" || block.kind === "imageGeneration") {
    return <><ImageProtocolBlock block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /><LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /></>;
  }
  if (block.kind === "unknown") return <><UnknownProtocolBlock block={block} {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })} /><LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /></>;
  const displayTitle = block.kind === "reasoning"
    ? reasoningActivityTitle(block.body, activeToolCall ? "inProgress" : block.status)
    : block.title;
  if (block.kind === "reasoning") {
    const running = activeToolCall || block.status === "inProgress" || block.status === "running";
    return (
      <View testID="thinking-status" style={[styles.thinkingStatus, insideTurnActivity && styles.thinkingStatusInActivity]}>
        <View style={styles.cardIconSlot}><Ionicons name="bulb-outline" size={14} color={colors.textMuted} /></View>
        {running
          ? <WaveText text={displayTitle} style={styles.cardTitle} containerStyle={styles.cardTitleWave} />
          : <Text numberOfLines={1} style={styles.cardTitle}>{displayTitle}</Text>}
      </View>
    );
  }
  return (
    <Card
      title={displayTitle}
      icon={protocolIcon(block.kind)}
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
      collapsible={block.collapsible}
      initiallyExpanded={!isToolActivityKind(block.kind) && (block.status === "inProgress" || block.status === "running")}
    >
      {block.body !== null && (
        block.kind === "reasoning" || block.kind === "plan" || block.kind === "turnPlan" || block.kind === "hookPrompt"
          ? <RichMarkdown source={block.body} />
          : <ProtocolBody
              body={block.body}
              code={block.kind === "commandExecution" || block.kind === "fileChange" || block.kind === "turnDiff"}
              collapsible={block.collapsible}
              {...(block.kind === "turnDiff" || block.kind === "fileChange" ? { codeVariant: "diff" as const, language: "diff" } : {})}
              {...(block.kind === "commandExecution" ? { codeVariant: "terminal" as const } : {})}
              {...(block.kind === "commandExecution" ? { expandedMaxHeight: TOOL_RESULT_MAX_HEIGHT } : {})}
            />
      )}
      {block.durationMs !== null && <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>}
      <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
    </Card>
  );
}

const CONTENT_VIEW_CHUNK_BYTES = 64 * 1024;

function AgentResponseMarkdown({ block, layout, getTransferAccess }: {
  block: RenderBlock;
  layout: RichMarkdownLayout;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const resourceScope = usePrivateFileAccessScope();
  const reference = block.content?.fields["/text"] ?? null;
  const resourceKey = reference === null || getTransferAccess === undefined
    ? null
    : `complete-markdown:${resourceScope}:${reference.id}:${reference.byteLength}`;
  const resource = useAsyncResource<string[]>(resourceKey, resourceKey ?? "none", async (publish, signal) => {
      if (reference === null || getTransferAccess === undefined) return [];
      let offset = 0;
      let remainder = "";
      let segments: string[] = [];
      while (!signal.aborted && offset < reference.byteLength) {
        const loaded = await readPrivateAssetText(
          { kind: "content", id: reference.id },
          getTransferAccess,
          {
            offset,
            limit: CONTENT_VIEW_CHUNK_BYTES,
            accept: reference.contentType,
            signal,
          },
        );
        const body = loaded.text;
        const nextOffset = loaded.nextOffset;
        if (nextOffset <= offset) throw new Error("Complete response returned an invalid range");
        const projected = projectMarkdownStream(remainder, body, nextOffset >= reference.byteLength);
        remainder = projected.remainder;
        if (projected.segments.length > 0 && !signal.aborted) {
          segments = [...segments, ...projected.segments];
          publish(segments);
          await nextRenderFrame();
        }
        offset = nextOffset;
      }
      if (!signal.aborted && remainder.length > 0) {
        const projected = projectMarkdownStream(remainder, "", true);
        if (projected.segments.length > 0) segments = [...segments, ...projected.segments];
      }
      return segments;
  }, markdownSegmentsWeight);
  const segments = resource.value ?? [];
  const loading = resource.status === "loading";
  const error = resource.error;

  if (reference === null || segments.length === 0) {
    return (
      <View style={styles.agentMarkdownDocument}>
        <CompleteAgentMarkdown source={block.body ?? ""} layout={layout} />
        {loading && <ActivityIndicator accessibilityLabel="Loading complete response" size="small" color={colors.textMuted} />}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }
  return (
    <View style={styles.agentMarkdownDocument}>
      {segments.map((segment, index) => <RichMarkdown key={`${reference.id}:${index}`} source={segment} layout={layout} />)}
      {loading && <ActivityIndicator accessibilityLabel="Loading complete response" size="small" color={colors.textMuted} />}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

function markdownSegmentsWeight(segments: string[]): number {
  return segments.reduce((bytes, segment) => bytes + segment.length * 2, 0);
}

function CompleteAgentMarkdown({ source, layout }: { source: string; layout: RichMarkdownLayout }) {
  const segments = projectCompleteMarkdown(source);
  return (
    <View style={styles.agentMarkdownDocument}>
      {segments.map((segment, index) => <RichMarkdown key={index} source={segment} layout={layout} />)}
    </View>
  );
}

function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

type LargeContentViewerSelection = LargeContentViewerRequest & {
  offset: number;
  nextOffset: number;
  text: string | null;
  loading: boolean;
  error: string | null;
};
/**
 * Owns the fullscreen output session above LegendList. Timeline rows only send
 * immutable open requests, so recycling a bubble can never destroy the modal
 * or invalidate the list's native scroll anchor.
 */
function LargeContentViewerHost({ children }: { children: ReactNode }) {
  const fullscreenOverlay = useAppFullscreenOverlay();
  const open = (request: LargeContentViewerRequest) => {
    fullscreenOverlay.present(({ close }) => (
      <LargeContentViewerSession initialRequest={request} onClose={close} />
    ));
  };
  return (
    <LargeContentViewerContext.Provider value={open}>
      {children}
    </LargeContentViewerContext.Provider>
  );
}

function LargeContentViewerSession({
  initialRequest,
  onClose,
}: {
  initialRequest: LargeContentViewerRequest;
  onClose(): void;
}) {
  const requestRevisionRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<LargeContentViewerSelection>({
    ...initialRequest,
    offset: 0,
    nextOffset: 0,
    text: null,
    loading: true,
    error: null,
  });
  const load = (request: LargeContentViewerRequest, offset: number) => {
    requestRevisionRef.current += 1;
    const revision = requestRevisionRef.current;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setSelected({ ...request, offset, nextOffset: offset, text: null, loading: true, error: null });
    void readPrivateAssetText(
      { kind: "content", id: request.reference.id },
      request.getTransferAccess,
      { offset, limit: CONTENT_VIEW_CHUNK_BYTES, accept: request.reference.contentType, signal: controller.signal },
    ).then(
      (loaded) => {
        if (controller.signal.aborted || revision !== requestRevisionRef.current) return;
        setSelected({ ...request, offset, nextOffset: loaded.nextOffset, text: loaded.text, loading: false, error: null });
      },
      (cause: unknown) => {
        if (controller.signal.aborted || revision !== requestRevisionRef.current) return;
        setSelected({ ...request, offset, nextOffset: offset, text: null, loading: false, error: cause instanceof Error ? cause.message : "Full content unavailable" });
      },
    );
  };
  useEffect(() => {
    requestRevisionRef.current += 1;
    const revision = requestRevisionRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    void readPrivateAssetText(
      { kind: "content", id: initialRequest.reference.id },
      initialRequest.getTransferAccess,
      { offset: 0, limit: CONTENT_VIEW_CHUNK_BYTES, accept: initialRequest.reference.contentType, signal: controller.signal },
    ).then(
      (loaded) => {
        if (controller.signal.aborted || revision !== requestRevisionRef.current) return;
        setSelected({ ...initialRequest, offset: 0, nextOffset: loaded.nextOffset, text: loaded.text, loading: false, error: null });
      },
      (cause: unknown) => {
        if (controller.signal.aborted || revision !== requestRevisionRef.current) return;
        setSelected({ ...initialRequest, offset: 0, nextOffset: 0, text: null, loading: false, error: cause instanceof Error ? cause.message : "Full content unavailable" });
      },
    );
    return () => controller.abort();
  }, [initialRequest]);
  const close = () => {
    requestRevisionRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    onClose();
  };
  const request = {
    pointer: selected.pointer,
    reference: selected.reference,
    presentation: selected.presentation,
    getTransferAccess: selected.getTransferAccess,
  };
  return (
    <FullContentViewer
      selection={selected}
      onClose={close}
      onPrevious={() => void load(request, Math.max(0, selected.offset - CONTENT_VIEW_CHUNK_BYTES))}
      onNext={() => void load(request, selected.nextOffset)}
    />
  );
}

function LargeContentControls({ block, getTransferAccess }: {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const open = useContext(LargeContentViewerContext);
  const references = (() => {
    if (block.content === null) return [];
    const entries = Object.entries(block.content.fields);
    if (block.content.whole !== null) entries.push(["/", block.content.whole]);
    return entries;
  })();
  if (references.length === 0) return null;
  return (
    <View style={styles.largeContentControl}>
      <View style={styles.largeContentActions}>
        {references.slice(0, 8).map(([pointer, reference], index) => (
          <Pressable
            key={`${pointer}:${reference.id}`}
            accessibilityRole="button"
            disabled={getTransferAccess === undefined || open === null}
            onPress={() => {
              if (getTransferAccess !== undefined) open?.({ pointer, reference, presentation: largeContentPresentation(pointer, reference), getTransferAccess });
            }}
            style={({ pressed }) => [styles.largeContentButton, pressed && styles.pressed]}
          >
            <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.largeContentButtonText}>{references.length === 1 ? "Open full content" : `Open ${contentPointerLabel(pointer, index)}`}</Text>
            <Text style={styles.turnMetaText}>{formatContentBytes(reference.byteLength)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function largeContentPresentation(pointer: string, reference: RenderContentReference): LargeContentViewerRequest["presentation"] {
  if (reference.contentType.startsWith("text/markdown")) return "markdown";
  if (reference.contentType.startsWith("text/x-ansi") || pointer === "/aggregatedOutput" || pointer.endsWith("/aggregatedOutput")) return "terminal";
  return "text";
}

function FullContentViewer({
  selection,
  onClose,
  onPrevious,
  onNext,
}: {
  selection: {
    pointer: string;
    reference: RenderContentReference;
    presentation: LargeContentViewerRequest["presentation"];
    offset: number;
    nextOffset: number;
    text: string | null;
    loading: boolean;
    error: string | null;
  };
  onClose(): void;
  onPrevious(): void;
  onNext(): void;
}) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const title = selection.pointer === "/" ? "Full output" : contentPointerLabel(selection.pointer, 0);
  const hasPrevious = selection.offset > 0;
  const hasNext = selection.nextOffset > selection.offset && selection.nextOffset < selection.reference.byteLength;
  const rangeEnd = Math.max(selection.offset, selection.nextOffset);
  return (
    <View testID="full-content-viewer" style={styles.fullContentViewer}>
      <View style={styles.fullContentHeader}>
        <View style={styles.fullContentHeaderIcon}>
          <Ionicons name="terminal-outline" size={22} color={colors.textMuted} />
        </View>
        <View style={styles.fullContentHeaderText}>
          <Text numberOfLines={1} style={styles.fullContentTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.fullContentMeta}>
            {selection.loading
              ? "Loading…"
              : `${selection.offset + 1}–${rangeEnd} / ${selection.reference.byteLength.toLocaleString()} bytes`}
          </Text>
        </View>
        {selection.text !== null && <CopyButton text={selection.text} />}
        <Pressable accessibilityRole="button" accessibilityLabel="Close full output" onPress={onClose} style={styles.headerIcon}>
          <Ionicons name="close" size={23} color={colors.text} />
        </Pressable>
      </View>
      <View
        style={styles.fullContentViewport}
        onLayout={(event) => {
          const nextHeight = Math.floor(event.nativeEvent.layout.height);
          setViewportHeight((current) => current === nextHeight ? current : nextHeight);
        }}
      >
        {selection.loading
          ? <View style={styles.fullContentCentered}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.menuNotice}>Loading full output…</Text></View>
          : selection.error !== null
            ? <View style={styles.fullContentCentered}><Text style={styles.errorText}>{selection.error}</Text></View>
            : selection.text !== null && viewportHeight > 0
              ? selection.presentation === "markdown"
                ? <ScrollView nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.fullContentMarkdown}><RichMarkdown source={selection.text} /></ScrollView>
                : Platform.OS === "android"
                  ? <NativeCodeBlock value={selection.text} language="text" variant={selection.presentation === "terminal" ? "terminal" : "code"} maxHeight={viewportHeight} truncate={false} />
                  : (
                      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={styles.fullContentRawHorizontal}>
                          <Text selectable style={styles.fullContentRawText}>
                            {selection.presentation === "terminal" ? stripTerminalControlSequences(selection.text) : selection.text}
                          </Text>
                        </ScrollView>
                      </ScrollView>
                    )
              : null}
      </View>
      <View style={styles.fullContentFooter}>
        <Text style={styles.fullContentFooterText}>{formatContentBytes(selection.reference.byteLength)}</Text>
        <View style={styles.largeContentPager}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous output page" disabled={!hasPrevious || selection.loading} onPress={onPrevious} style={[styles.largeContentPageButton, (!hasPrevious || selection.loading) && styles.disabled]}>
            <Ionicons name="chevron-back" size={18} color={colors.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next output page" disabled={!hasNext || selection.loading} onPress={onNext} style={[styles.largeContentPageButton, (!hasNext || selection.loading) && styles.disabled]}>
            <Ionicons name="chevron-forward" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function contentPointerLabel(pointer: string, index: number): string {
  const segment = pointer.split("/").filter(Boolean).at(-1);
  return segment === undefined ? `content ${index + 1}` : segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function formatContentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UnknownProtocolBlock({ block, onFixUnsupportedBlock }: { block: RenderBlock; onFixUnsupportedBlock?(block: RenderBlock): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rawType = typeof block.raw.type === "string" ? block.raw.type : block.kind;
  const fix = async () => {
    if (onFixUnsupportedBlock === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onFixUnsupportedBlock(block);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create renderer fix thread");
      setBusy(false);
    }
  };
  return (
    <View style={styles.unknownCard}>
      <Ionicons name="cube-outline" size={19} color={colors.amber} />
      <View style={styles.flex}>
        <Text style={styles.unknownText}>Unsupported · {rawType}</Text>
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <CopyButton getText={() => protocolCopyText(block)} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Fix unsupported block ${rawType} in new thread`} disabled={busy || onFixUnsupportedBlock === undefined} onPress={() => void fix()} style={[styles.unknownFixButton, (busy || onFixUnsupportedBlock === undefined) && styles.disabled]}>
        <Ionicons name={busy ? "hourglass-outline" : "construct-outline"} size={17} color={colors.onPrimary} />
        <Text style={styles.unknownFixText}>{busy ? "Starting" : "Fix"}</Text>
      </Pressable>
    </View>
  );
}

function TokenUsageProtocolBlock({ block }: { block: RenderBlock }) {
  const total = recordValue(block.raw.total);
  const last = recordValue(block.raw.last);
  const metrics: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; value: number | null }> = [
    { icon: "speedometer-outline", label: "Total tokens", value: numberValue(total.totalTokens) },
    { icon: "log-in-outline", label: "Input tokens", value: numberValue(total.inputTokens) },
    { icon: "log-out-outline", label: "Output tokens", value: numberValue(total.outputTokens) },
    { icon: "flash-outline", label: "Last turn tokens", value: numberValue(last.totalTokens) },
    { icon: "scan-outline", label: "Context window", value: numberValue(block.raw.modelContextWindow) },
  ];
  return (
    <View style={styles.tokenStrip}>
      <View style={styles.tokenStripTitle}>
        <Ionicons name="speedometer-outline" size={17} color={colors.textMuted} />
        <Text style={styles.cardTitle}>Token usage</Text>
      </View>
      <View style={styles.tokenMetrics}>
        {metrics.map((metric) => metric.value === null ? null : (
          <View key={metric.label} accessible accessibilityLabel={`${metric.label}: ${metric.value.toLocaleString()}`} style={styles.tokenMetric}>
            <Ionicons name={metric.icon} size={14} color={colors.textMuted} />
            <Text style={styles.tokenMetricValue}>{compactNumber(metric.value)}</Text>
          </View>
        ))}
      </View>
      <CopyButton getText={() => protocolCopyText(block)} />
    </View>
  );
}

function OpenableImage({
  label,
  source,
  variant = "generated",
  containerStyle,
  previewId,
  groupId,
  order,
  reference,
  link,
  download,
  onError,
}: {
  label: string;
  source: { uri: string; headers?: Record<string, string> };
  variant?: "generated" | "user";
  containerStyle?: StyleProp<ViewStyle>;
  previewId?: string;
  groupId?: string | null;
  order?: number;
  reference?: string | null;
  link?: string | null;
  download?: (() => Promise<void>) | null;
  onError?(): void;
}) {
  const openImagePreview = useImagePreview();
  const inheritedGroupId = useImagePreviewGroup();
  const generatedId = useId();
  const [retryRevision, setRetryRevision] = useState(0);
  const resolvedGroupId = groupId === undefined ? inheritedGroupId : groupId;
  const resolvedPreviewId = previewId ?? generatedId;
  // Native Image does not reliably preserve Authorization headers. Decode a
  // private file URI after the scoped response has been downloaded by JS.
  const privateImage = usePrivateImageUri(source.uri, source.headers, retryRevision);
  const resolvedSource = privateImage.source;
  const previewItem = {
    id: resolvedPreviewId,
    label,
    source: resolvedSource ?? source,
    reference: reference ?? source.uri,
    ...(link === undefined ? {} : { link }),
    ...(download === undefined ? {} : { download }),
    ...(order === undefined ? {} : { order }),
  };
  useRegisterImagePreviewItem(resolvedGroupId, previewItem);
  const imageContainerStyle = [variant === "user" ? styles.userImage : styles.generatedImage, containerStyle];
  if (resolvedSource === null) {
    return (
      <View style={imageContainerStyle}>
        {privateImage.failed
          ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${label}`} onPress={() => setRetryRevision((current) => current + 1)}>
                <Text style={styles.menuNotice}>Image preview failed · Retry</Text>
              </Pressable>
            )
          : <ActivityIndicator color={colors.textMuted} />}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}`} onPress={() => openImagePreview({ ...previewItem, source: resolvedSource, groupId: resolvedGroupId })} style={imageContainerStyle}>
      <Image
        accessibilityLabel={label}
        source={resolvedSource}
        resizeMode={variant === "user" ? "cover" : "contain"}
        style={styles.openableImage}
        onError={() => {
          setRetryRevision((current) => current + 1);
          onError?.();
        }}
      />
      <View style={styles.imageOpenBadge}><Ionicons name="expand-outline" size={16} color="#ffffff" /></View>
    </Pressable>
  );
}

function ImageProtocolBlock({ block, getTransferAccess }: { block: RenderBlock; getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }> }) {
  return (
    <Card title={block.title} icon="image-outline" {...(block.status === null ? {} : { status: block.status })} copyText={() => protocolCopyText(block)} collapsible initiallyExpanded={block.status === "inProgress" || block.status === "running"}>
      <ImageProtocolContent block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
    </Card>
  );
}

function ImageProtocolContent({ block, getTransferAccess }: { block: RenderBlock; getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }> }) {
  const localPath = block.kind === "imageView"
    ? typeof block.raw.path === "string" ? block.raw.path : null
    : typeof block.raw.savedPath === "string" ? block.raw.savedPath : null;
  const projectedAsset = privateImageAssetProjection(block.raw.codewideAsset);
  const remoteResult = safeImageUri(block.raw.result);
  return (
    <>
      {projectedAsset !== null && getTransferAccess !== undefined
        ? <ScopedPrivateAssetImage
            previewId={block.key}
            label={block.title}
            reference={`private-asset:${projectedAsset.id}`}
            source={{ kind: "content", id: projectedAsset.id }}
            getTransferAccess={getTransferAccess}
          />
        : localPath !== null && getTransferAccess !== undefined
        ? <ScopedRemoteImage previewId={block.key} path={localPath} getTransferAccess={getTransferAccess} />
        : remoteResult !== null
          ? <OpenableImage previewId={block.key} label={block.title} source={{ uri: remoteResult }} reference={remoteResult} />
          : <Text style={styles.menuNotice}>{localPath === null ? "No preview was returned." : `Image · ${basename(localPath)}`}</Text>}
      {block.kind === "imageGeneration" && typeof block.raw.revisedPrompt === "string" && <RichMarkdown source={block.raw.revisedPrompt} />}
    </>
  );
}

function ScopedRemoteImage({ path, getTransferAccess, containerStyle, previewId, groupId, order }: { path: string; getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>; containerStyle?: StyleProp<ViewStyle>; previewId?: string; groupId?: string | null; order?: number }) {
  return (
    <ScopedPrivateAssetImage
      source={{ kind: "path", path }}
      label={`Image ${basename(path)}`}
      reference={path}
      getTransferAccess={getTransferAccess}
      {...(previewId === undefined ? {} : { previewId })}
      {...(groupId === undefined ? {} : { groupId })}
      {...(order === undefined ? {} : { order })}
      {...(containerStyle === undefined ? {} : { containerStyle })}
    />
  );
}

function ScopedPrivateAssetImage({ source: assetSource, label, reference, getTransferAccess, containerStyle, previewId, groupId, order }: { source: PrivateAssetSource; label: string; reference: string; getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>; containerStyle?: StyleProp<ViewStyle>; previewId?: string; groupId?: string | null; order?: number }) {
  const [attempt, setAttempt] = useState(0);
  const downloadDocument = useDocumentDownload();
  const privateImage = usePrivateAssetUri(assetSource, attempt, getTransferAccess);
  if (privateImage.failed) {
    return (
      <View style={[styles.userImage, containerStyle]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${label}`} onPress={() => setAttempt((current) => current + 1)}>
          <Text style={styles.menuNotice}>Image preview failed · Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (privateImage.source === null) return <View style={[styles.userImage, containerStyle]}><ActivityIndicator color={colors.textMuted} /></View>;
  return (
    <OpenableImage
      previewId={previewId ?? reference}
      label={label}
      source={privateImage.source}
      variant="user"
      reference={reference}
      {...(assetSource.kind !== "path" ? {} : {
        download: () => downloadDocument({
          kind: "image",
          name: basename(assetSource.path),
          path: assetSource.path,
          getTransferAccess,
        }),
      })}
      {...(groupId === undefined ? {} : { groupId })}
      {...(order === undefined ? {} : { order })}
      {...(containerStyle === undefined ? {} : { containerStyle })}
      onError={() => setAttempt((current) => current + 1)}
    />
  );
}

function FileChangeProtocolBlock({ block }: { block: RenderBlock }) {
  const changeCount = Array.isArray(block.raw.changes) ? block.raw.changes.length : 0;
  return (
    <Card title={`File changes · ${changeCount}`} icon="git-compare-outline" {...(block.status === null ? {} : { status: block.status })} copyText={() => protocolCopyText(block)} collapsible initiallyExpanded={false}>
      <FileChangeProtocolDetails block={block} />
    </Card>
  );
}

function FileChangeProtocolDetails({ block }: { block: RenderBlock }) {
  const changes = Array.isArray(block.raw.changes)
    ? block.raw.changes.filter((change): change is Record<string, unknown> => change !== null && typeof change === "object" && !Array.isArray(change))
    : [];
  return (
    <>
      {changes.length === 0
        ? <Text style={styles.menuNotice}>No structured file changes were returned.</Text>
        : changes.map((change, index) => (
            <DiffFile
              key={`${String(change.path ?? "file")}-${index}`}
              path={typeof change.path === "string" ? change.path : `File ${index + 1}`}
              kind={change.kind}
              diff={typeof change.diff === "string" ? change.diff : ""}
            />
          ))}
    </>
  );
}

function DiffFile({ path, kind, diff }: { path: string; kind: unknown; diff: string }) {
  const cwd = useContext(ThreadCwdContext);
  const [expanded, setExpanded] = usePersistentExpansion(`diff:${path}`, false);
  const projection = projectFileChange(diff, kind);
  const { additions, deletions } = projection;
  const displayPath = changedFileDisplayPath(path, cwd);
  return (
    <View style={styles.diffFile}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} diff ${path}`} onPress={() => setExpanded((value) => !value)} style={styles.diffFileHeader}>
        <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.diffFilePath}>{displayPath}</Text>
        <Text numberOfLines={1} style={styles.diffKind}>{projection.kind}</Text>
        <Text style={[styles.diffStat, styles.diffStatAdd]}>+{additions}</Text>
        <Text style={[styles.diffStat, styles.diffStatDelete]}>−{deletions}</Text>
        <CopyButton text={diff} compact />
      </Pressable>
      {expanded && (
        <View style={styles.diffLines}>
            <NativeCodeBlock value={projection.renderSource} language={nativeCodeLanguageForPath(path)} variant="diff" maxHeight={TOOL_RESULT_MAX_HEIGHT} fillAvailableWidth />
        </View>
      )}
    </View>
  );
}

function ToolCallProtocolBlock({ block, getTransferAccess }: { block: RenderBlock; getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }> }) {
  return (
    <Card title={block.title} icon="extension-puzzle-outline" {...(block.status === null ? {} : { status: block.status })} copyText={() => protocolCopyText(block)} collapsible initiallyExpanded={false}>
      <ToolCallProtocolDetails block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
    </Card>
  );
}

function ToolCallProtocolDetails({ block, getTransferAccess }: { block: RenderBlock; getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }> }) {
  const argumentsText = boundedJsonStringify(block.raw.arguments ?? null);
  const progress = Array.isArray(block.raw.progress)
    ? block.raw.progress.filter((entry): entry is string => typeof entry === "string")
    : [];
  return (
    <>
      <Text style={styles.controlSectionLabel}>Arguments</Text>
      <ProtocolBody body={argumentsText} code collapsible section="arguments" />
      {progress.length > 0 && (
        <>
          <Text style={styles.controlSectionLabel}>Progress</Text>
          <ProtocolBody body={progress.map((entry) => `• ${entry}`).join("\n")} code={false} collapsible section="progress" />
        </>
      )}
      <Text style={styles.controlSectionLabel}>Result</Text>
      <ToolCallResultContent block={block} section="result" {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
      {block.durationMs !== null && <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>}
    </>
  );
}

function ToolCallResultContent({ block, section, getTransferAccess }: { block: RenderBlock; section: string; getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }> }) {
  if (block.kind === "dynamicToolCall") {
    const items = Array.isArray(block.raw.contentItems) ? block.raw.contentItems : [];
    return items.length === 0
      ? <LazyJsonProtocolBody value={{ success: block.raw.success }} section={section} />
      : <ToolRichContent items={items} section={section} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />;
  }
  if (block.raw.error !== null && block.raw.error !== undefined) return <LazyJsonProtocolBody value={block.raw.error} section={section} />;
  const result = recordValue(block.raw.result);
  const items = Array.isArray(result.content) ? result.content : [];
  const appContext = recordValue(block.raw.appContext);
  const resourceUri = typeof appContext.resourceUri === "string" ? appContext.resourceUri : null;
  return (
    <>
      {resourceUri !== null && <ToolResourceLink uri={resourceUri} label={typeof appContext.appName === "string" ? appContext.appName : "MCP App resource"} />}
      {items.length > 0 ? <ToolRichContent items={items} section={section} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} /> : result.structuredContent === undefined ? <LazyJsonProtocolBody value={block.raw.result ?? null} section={section} /> : null}
      {result.structuredContent !== null && result.structuredContent !== undefined && (
        <>
          <Text style={styles.controlSectionLabel}>Structured result</Text>
          <ProtocolBody body={boundedJsonStringify(result.structuredContent)} code collapsible expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT} section="structured-result" />
        </>
      )}
    </>
  );
}

function ToolRichContent({ items, section, getTransferAccess }: { items: unknown[]; section: string; getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }> }) {
  return (
    <View style={styles.protocolBody}>
      {items.map((raw, index) => {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return <LazyJsonProtocolBody key={index} value={raw} section={`${section}:${index}`} />;
        const item = raw as Record<string, unknown>;
        const type = typeof item.type === "string" ? item.type : "unknown";
        if (type === "text" && typeof item.text === "string") {
          const terminal = containsTerminalControlSequences(item.text);
          return terminal || toolTextNeedsCodeViewport(item.text)
            ? <ProtocolBody key={index} body={item.text} code collapsible expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT} section={`${section}:${index}`} {...(terminal ? { codeVariant: "terminal" as const } : {})} />
            : <View key={index} style={styles.toolMarkdownResult}><RichMarkdown source={item.text} /></View>;
        }
        if ((type === "inputText" || type === "input_text") && typeof item.text === "string") return <ProtocolBody key={index} body={item.text} code collapsible expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT} section={`${section}:${index}`} />;
        const projectedAsset = privateImageAssetProjection(item.codewideAsset);
        if (projectedAsset !== null && getTransferAccess !== undefined) {
          return <ScopedPrivateAssetImage key={index} previewId={`tool-asset:${projectedAsset.id}`} label={`Tool image ${index + 1}`} reference={`private-asset:${projectedAsset.id}`} source={{ kind: "content", id: projectedAsset.id }} getTransferAccess={getTransferAccess} />;
        }
        if ((type === "inputImage" || type === "input_image") && (typeof item.imageUrl === "string" || typeof item.image_url === "string")) {
          const rawUri = typeof item.imageUrl === "string" ? item.imageUrl : String(item.image_url);
          const uri = safeImageUri(rawUri);
          return uri === null
            ? <Text key={index} selectable style={styles.rawLink}>{rawUri}</Text>
            : <OpenableImage key={index} previewId={`tool-image:${index}:${uri}`} label={`Tool image ${index + 1}`} source={{ uri }} reference={uri} />;
        }
        if (type === "image" && typeof item.data === "string") {
          const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
          const uri = safeImageUri(`data:${mimeType};base64,${item.data}`);
          return uri === null
            ? <LazyJsonProtocolBody key={index} value={item} section={`${section}:${index}`} />
            : <OpenableImage key={index} previewId={`mcp-image:${index}`} label={`MCP image ${index + 1}`} source={{ uri }} reference={`MCP image ${index + 1}`} />;
        }
        if (type === "resource_link" && typeof item.uri === "string") return <ToolResourceLink key={index} uri={item.uri} label={typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "Resource"} />;
        if (type === "resource") {
          const resource = recordValue(item.resource);
          if (typeof resource.text === "string") return <RichMarkdown key={index} source={resource.text} />;
          if (typeof resource.uri === "string") return <ToolResourceLink key={index} uri={resource.uri} label="Embedded resource" />;
        }
        if (type === "inputAudio" || type === "audio") {
          const uri = typeof item.audioUrl === "string" ? item.audioUrl : null;
          const canOpen = uri !== null && isSafeHttpUrl(uri);
          return (
            <Pressable key={index} disabled={!canOpen} onPress={canOpen ? () => void Linking.openURL(uri) : undefined} style={styles.attachmentChip}>
              <Ionicons name="volume-medium-outline" size={15} color={colors.textMuted} />
              <Text selectable numberOfLines={1} style={styles.attachmentText}>{uri ?? "Audio output"}</Text>
            </Pressable>
          );
        }
        return <LazyJsonProtocolBody key={index} value={item} section={`${section}:${index}`} />;
      })}
    </View>
  );
}

function toolTextNeedsCodeViewport(value: string): boolean {
  const lines = value.split("\n");
  if (lines.some((line) => line.length > 96 || line.includes("\t"))) return true;
  if (/^(?:\s*[\[{]|\s*(?:diff --git|@@ |Traceback |Exception\b|Error:|stdout:|stderr:))/mu.test(value)) return true;
  return false;
}

function containsTerminalControlSequences(value: string): boolean {
  return value.includes("\u001b[") || value.includes("\u009b") || value.includes("\u001b]");
}

function ToolResourceLink({ uri, label }: { uri: string; label: string }) {
  const canOpen = isSafeHttpUrl(uri);
  return (
    <Pressable disabled={!canOpen} onPress={canOpen ? () => void Linking.openURL(uri) : undefined} style={styles.searchResult}>
      <Text numberOfLines={1} style={styles.menuActionTitle}>{label}</Text>
      <Text selectable numberOfLines={2} style={styles.rawLink}>{uri}</Text>
    </Pressable>
  );
}

function MemoryCitationList({ value }: { value: unknown }) {
  const citation = recordValue(value);
  const entries = Array.isArray(citation.entries)
    ? citation.entries.flatMap((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry) ? [entry as Record<string, unknown>] : [])
    : [];
  if (entries.length === 0) return null;
  return (
    <View style={styles.protocolBody}>
      <Text style={styles.controlSectionLabel}>Sources · {entries.length}</Text>
      {entries.map((entry, index) => {
        const path = typeof entry.path === "string" ? entry.path : `Source ${index + 1}`;
        const lineStart = numberValue(entry.lineStart);
        const lineEnd = numberValue(entry.lineEnd);
        const lines = lineStart === null ? "" : lineEnd === null || lineEnd === lineStart ? `:${lineStart}` : `:${lineStart}–${lineEnd}`;
        return (
          <View key={`${path}:${lineStart ?? index}`} style={styles.searchResult}>
            <Text selectable numberOfLines={1} ellipsizeMode="middle" style={styles.rawLink}>{path}{lines}</Text>
            {typeof entry.note === "string" && <Text selectable style={styles.menuActionSubtitle}>{entry.note}</Text>}
          </View>
        );
      })}
    </View>
  );
}

function WebSearchProtocolBlock({ block }: { block: RenderBlock }) {
  const query = typeof block.raw.query === "string" ? block.raw.query : "Search";
  return (
    <Card title={`Web search · ${query}`} icon="search-outline" copyText={() => protocolCopyText(block)} collapsible initiallyExpanded={false}>
      <WebSearchProtocolDetails block={block} />
    </Card>
  );
}

function WebSearchProtocolDetails({ block }: { block: RenderBlock }) {
  const results = Array.isArray(block.raw.results)
    ? block.raw.results.filter((result): result is Record<string, unknown> => result !== null && typeof result === "object" && !Array.isArray(result))
    : [];
  return (
    <>
      {results.length === 0 ? <LazyJsonProtocolBody value={block.raw.action ?? block.raw} /> : results.map((result, index) => {
        const url = typeof result.url === "string" && isSafeHttpUrl(result.url) ? result.url : null;
        const title = typeof result.title === "string" ? result.title : url ?? `Result ${index + 1}`;
        const snippet = typeof result.snippet === "string" ? result.snippet : typeof result.text === "string" ? result.text : null;
        return (
          <Pressable key={`${url ?? title}-${index}`} disabled={url === null} onPress={url === null ? undefined : () => void Linking.openURL(url)} style={styles.searchResult}>
            <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menuActionTitle}>{title}</Text>
            {snippet !== null && <Text numberOfLines={3} style={styles.menuActionSubtitle}>{snippet}</Text>}
            {url !== null && <Text numberOfLines={1} style={styles.rawLink}>{url}</Text>}
          </Pressable>
        );
      })}
    </>
  );
}

function LazyJsonProtocolBody({ value, section = "body" }: { value: unknown; section?: string }) {
  return <ProtocolBody body={boundedJsonStringify(value)} code collapsible section={section} />;
}

function AgentActivityProtocolBlock({ block }: { block: RenderBlock }) {
  const openSubagent = useContext(SubagentNavigationContext);
  const targetThreadId = subagentActivityTargetThreadId(block.raw as Thread["turns"][number]["items"][number]);
  const handlePress = targetThreadId === null || openSubagent === null
    ? undefined
    : () => openSubagent(targetThreadId);
  const canOpen = handlePress !== undefined;
  const path = typeof block.raw.agentPath === "string" ? block.raw.agentPath.trim() : "";
  const pathSegment = path.split("/").filter(Boolean).at(-1)?.replaceAll("_", " ") ?? "";
  const title = pathSegment || block.title || "Subagent";
  const activity = typeof block.raw.kind === "string" ? block.raw.kind : null;
  const subtitle = canOpen
    ? `${activity === null ? "Subagent activity" : subagentActivityLabel(activity)} · Open subagent`
    : activity === null ? "Subagent activity" : subagentActivityLabel(activity);
  const running = block.status === "inProgress" || block.status === "running";
  return (
    <Pressable
      testID="subagent-activity-link"
      {...(canOpen ? { accessibilityRole: "button" as const, accessibilityLabel: `Open subagent ${title}` } : {})}
      disabled={!canOpen}
      onPress={handlePress}
      style={({ pressed }) => [styles.agentNavigationRow, pressed && styles.pressed]}
    >
      <View style={styles.cardIconSlot}><Ionicons name="people-outline" size={14} color={colors.textMuted} /></View>
      <View style={styles.agentNavigationIdentity}>
        {running
          ? <WaveText text={title} style={styles.cardTitle} containerStyle={styles.agentNavigationTitleWave} />
          : <Text numberOfLines={1} style={styles.cardTitle}>{title}</Text>}
        <Text numberOfLines={1} style={styles.agentNavigationSubtitle}>{subtitle}</Text>
      </View>
      {block.status !== null && !running && (
        <View accessible accessibilityLabel={`Status ${block.status}`} style={styles.cardStatusIcon}>
          {block.status === "failed" || block.status === "error"
            ? <Ionicons name="alert-circle" size={15} color={colors.red} />
            : <View style={styles.cardStatusDot} />}
        </View>
      )}
      {canOpen && <Ionicons name="chevron-forward" size={14} color={colors.textDim} />}
    </Pressable>
  );
}

function subagentActivityLabel(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").trim();
  return spaced === "" ? "Subagent activity" : `${spaced[0]?.toUpperCase() ?? ""}${spaced.slice(1)}`;
}

function DocumentAttachmentChip({
  name,
  path,
  getTransferAccess,
}: {
  name: string;
  path: string;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const cwd = useContext(ThreadCwdContext);
  const openCodeDocument = useContext(ThreadCodeDocumentContext);
  const openDocument = useDocumentPreview();
  const resolvedPath = resolveRemoteDocumentPath(path, cwd);
  const kind = remoteFileKind(name, resolvedPath ?? path);
  const canOpen = getTransferAccess !== undefined && resolvedPath !== null;
  if (!canOpen) {
    return (
      <View style={styles.attachmentChip}>
        <Ionicons name="attach-outline" size={15} color={colors.textMuted} />
        <Text numberOfLines={1} style={styles.attachmentText}>{name}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      onPress={() => {
        const request = { kind, name, path: resolvedPath, getTransferAccess };
        if (kind === "text" && openCodeDocument !== null) openCodeDocument(request);
        else openDocument(request);
      }}
      style={({ pressed }) => [styles.attachmentChip, pressed && styles.pressed]}
    >
      <Ionicons name={fileKindIcon(kind)} size={15} color={colors.accent} />
      <Text numberOfLines={1} style={styles.attachmentText}>{name}</Text>
      <Ionicons name={kind === "download" ? "download-outline" : "chevron-up-outline"} size={14} color={colors.textDim} />
    </Pressable>
  );
}

function fileKindIcon(kind: DocumentPreviewKind): "document-text-outline" | "globe-outline" | "image-outline" | "download-outline" {
  if (kind === "html") return "globe-outline";
  if (kind === "image") return "image-outline";
  if (kind === "download") return "download-outline";
  return "document-text-outline";
}

function UserMessageContent({ content, getTransferAccess }: { content: unknown[]; getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }> }) {
  const parts = content.flatMap((raw) => raw !== null && typeof raw === "object" && !Array.isArray(raw) ? [raw as Record<string, unknown>] : []);
  const normalizedText = parts.flatMap((part) => part.type === "text" && typeof part.text === "string" ? [normalizeUserMessage(part.text)] : []);
  const mentionedFiles = normalizedText.flatMap((part) => part.files);
  const imageParts = parts.filter((part) => part.type === "image" || part.type === "localImage");
  const bodyParts = parts.filter((part) => part.type !== "image" && part.type !== "localImage");
  return (
    <View style={[styles.userMessageContent, imageParts.length > 0 && styles.userMessageMediaContent]}>
      {imageParts.length > 0 && (
        <UserImageGallery
          parts={imageParts}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      )}
      {bodyParts.map((part, index) => {
        const type = typeof part.type === "string" ? part.type : "unknown";
        if (type === "text" && typeof part.text === "string") {
          const normalized = normalizeUserMessage(part.text);
          return normalized.text === "" ? null : <CollapsibleUserMessage key={index} text={normalized.text} partIndex={index} />;
        }
        const label = type === "skill" && typeof part.name === "string"
          ? `Skill · ${part.name}`
          : type === "mention" && typeof part.name === "string"
            ? `File · ${part.name}`
            : (type === "localImage" || type === "localAudio") && typeof part.path === "string"
              ? `${type === "localImage" ? "Image" : "Audio"} · ${basename(part.path)}`
              : type === "audio" ? "Audio attachment" : `Attachment · ${type}`;
        if (type === "mention" && typeof part.name === "string" && typeof part.path === "string") {
          return <DocumentAttachmentChip key={index} name={part.name} path={part.path} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />;
        }
        return (
          <View key={index} style={styles.attachmentChip}>
            <Ionicons name={type.includes("Image") || type === "image" ? "image-outline" : type.includes("Audio") || type === "audio" ? "mic-outline" : "attach-outline"} size={15} color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.attachmentText}>{label}</Text>
          </View>
        );
      })}
      {mentionedFiles.map((file) => (
        <DocumentAttachmentChip key={`${file.name}\u0000${file.path}`} name={file.name} path={file.path} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
      ))}
    </View>
  );
}

function textSample(value: unknown): string {
  if (typeof value !== "string") return "";
  return `${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
}

function CollapsibleUserMessage({ text, partIndex }: { text: string; partIndex: number }) {
  const canCollapse = text.length > USER_MESSAGE_COLLAPSED_CHARS || text.split("\n").length > USER_MESSAGE_COLLAPSED_LINES;
  const [expanded, setExpanded] = usePersistentExpansion(`user-message:${partIndex}:${textFingerprint(text)}`, false);
  return (
    <View style={styles.userMessageTextBlock}>
      <RichMarkdown source={text} {...(!expanded && canCollapse ? { maxLines: USER_MESSAGE_COLLAPSED_LINES } : {})} />
      {canCollapse && (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((current) => !current)} style={styles.userMessageExpandButton}>
          <Text style={styles.userMessageExpandText}>{expanded ? "Collapse" : "Show full message"}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function UserImageGallery({ parts, getTransferAccess }: { parts: Record<string, unknown>[]; getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }> }) {
  return (
    <View testID="user-image-gallery" style={styles.userImageGallery}>
      {parts.map((part, index) => {
        const hero = parts.length === 1 || (parts.length % 2 === 1 && index === 0);
        const containerStyle = hero ? styles.userImageGalleryHero : styles.userImageGalleryTile;
        const imageSource = userImageSourceProjection(part);
        if (imageSource?.kind === "content") {
          if (getTransferAccess !== undefined) {
            return (
              <ScopedPrivateAssetImage
                key={index}
                previewId={`user-private-image:${imageSource.asset.id}`}
                label={`Attached image ${index + 1}`}
                reference={`private-asset:${imageSource.asset.id}`}
                source={{ kind: "content", id: imageSource.asset.id }}
                getTransferAccess={getTransferAccess}
                containerStyle={containerStyle}
                order={index}
              />
            );
          }
          return <View key={index} style={[styles.userImage, containerStyle]}><Text style={styles.menuNotice}>Attached image</Text></View>;
        }
        if (imageSource?.kind === "uri") {
          return <OpenableImage key={index} previewId={`user-image:${index}:${imageSource.uri}`} label={`Attached image ${index + 1}`} source={{ uri: imageSource.uri }} variant="user" containerStyle={containerStyle} order={index} reference={imageSource.uri} />;
        }
        if (imageSource?.kind === "path") {
          return getTransferAccess === undefined
            ? <View key={index} style={[styles.userImage, containerStyle]}><Text style={styles.menuNotice}>{basename(imageSource.path)}</Text></View>
            : <ScopedRemoteImage key={index} previewId={`user-local-image:${index}:${imageSource.path}`} path={imageSource.path} getTransferAccess={getTransferAccess} containerStyle={containerStyle} order={index} />;
        }
        return <View key={index} style={[styles.userImage, containerStyle]}><Text style={styles.menuNotice}>Image preview unavailable</Text></View>;
      })}
    </View>
  );
}

function protocolCopyText(block: RenderBlock): string {
  if (block.kind === "agentMessage" || block.kind === "plan" || block.kind === "turnPlan" || block.kind === "turnDiff" || block.kind === "reasoning" || block.kind === "commandExecution") {
    return block.body ?? "";
  }
  if (block.kind === "userMessage") {
    const content = Array.isArray(block.raw.content) ? block.raw.content : [];
    return content.map((part) => {
      if (part === null || typeof part !== "object" || Array.isArray(part)) return "";
      const value = part as Record<string, unknown>;
      if (typeof value.text === "string") return normalizeUserMessage(value.text).text;
      if (typeof value.path === "string") return value.path;
      if (typeof value.url === "string") return value.url;
      if (typeof value.name === "string") return value.name;
      return JSON.stringify(value);
    }).filter(Boolean).join("\n");
  }
  return boundedJsonStringify(block.raw, 96_000) || block.body || "";
}

function ProtocolBody({ body, code, collapsible, expandedMaxHeight, section = "body", language = "text", codeVariant = "code" }: { body: string; code: boolean; collapsible: boolean; expandedMaxHeight?: number; section?: string; language?: string; codeVariant?: "code" | "diff" | "terminal" }) {
  const itemKey = useContext(ExpansionItemKeyContext);
  const activeToolCall = useContext(ActiveToolCallContext);
  const collapsedLines = code ? 3 : 2;
  const bodyLines = body === "" ? 0 : body.split("\n").length;
  const canCollapse = collapsible && (body.length > COLLAPSED_BODY_CHARS || bodyLines > collapsedLines);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:body:${section}`, false);
  const limit = expanded ? EXPANDED_BODY_CHARS : COLLAPSED_BODY_CHARS;
  const bounded = expanded && body.length > limit
    ? `${body.slice(0, limit)}\n…`
    : activeToolCall && !expanded && canCollapse
      ? `…\n${body.slice(-COLLAPSED_BODY_CHARS)}`
      : body;
  const rendered = code && !expanded && canCollapse
    ? collapsedCodePreview(bounded, collapsedLines, activeToolCall)
    : bounded;
  const content = code
    ? <NativeCodeBlock value={rendered} language={language} variant={codeVariant} maxHeight={expandedMaxHeight ?? TOOL_RESULT_MAX_HEIGHT} fillAvailableWidth {...(!expanded && canCollapse ? { maxVisibleLines: collapsedLines } : {})} />
    : activeToolCall && (expanded || !canCollapse)
      ? <AppendOnlyLiveContent cacheKey={`${itemKey}:${section}`} source={rendered} mode="markdown" />
      : <Text selectable numberOfLines={!expanded && canCollapse ? collapsedLines : undefined} style={styles.agentText}>{rendered}</Text>;
  return (
    <View style={styles.protocolBody}>
      {!code && expanded && expandedMaxHeight !== undefined
        ? (
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator
              style={{ maxHeight: expandedMaxHeight, flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ flexGrow: 0 }}
            >
              {content}
            </ScrollView>
          )
        : content}
      {canCollapse && (
        <View style={styles.protocolBodyActions}>
          <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
            <Text style={styles.rawLink}>{expanded ? "Show less" : `Show more · ${bodyLines.toLocaleString()} ${bodyLines === 1 ? "line" : "lines"}`}</Text>
          </Pressable>
          <CopyButton text={body} />
        </View>
      )}
      {expanded && body.length > EXPANDED_BODY_CHARS && (
        <Text style={styles.menuNotice}>Rendering is capped for stability; Copy preserves the complete output.</Text>
      )}
    </View>
  );
}

function NewThreadServerSheet({
  visible,
  servers,
  onClose,
  onSelect,
}: {
  visible: boolean;
  servers: DemoServer[];
  onClose(): void;
  onSelect(serverId: string): Promise<void>;
}) {
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const select = async (serverId: string) => {
    if (busyServerId !== null) return;
    setBusyServerId(serverId);
    setError(null);
    try {
      await onSelect(serverId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create thread");
    }
    setBusyServerId(null);
  };
  return (
    <AppSheet isOpen={visible} onOpenChange={(open) => { if (!open) onClose(); }} contentProps={{ index: 0, enableDynamicSizing: true }}>
      <View style={styles.menuTitleRow}>
        <Text style={styles.sheetTitle}>Choose server</Text>
        <View style={styles.flex} />
        <Pressable accessibilityLabel="Close new thread" onPress={onClose} style={styles.headerIcon}>
          <Ionicons name="close" size={21} color={colors.text} />
        </Pressable>
      </View>
      <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
        {servers.map((server) => (
          <ControlOption
            key={server.id}
            title={`${server.emoji} ${server.name}`}
            subtitle={busyServerId === server.id ? "Creating…" : connectionStateLabel(server.status)}
            selected={false}
            onPress={() => void select(server.id)}
          />
        ))}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </AppSheetScrollView>
    </AppSheet>
  );
}

function NewThreadProjectSheet({
  visible,
  cwd,
  projects,
  busy,
  error,
  onSelect,
  onClose,
}: {
  visible: boolean;
  cwd: string;
  projects: readonly ThreadProject[];
  busy: boolean;
  error: string | null;
  onSelect(cwd: string | null): Promise<void>;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = normalizedQuery === ""
    ? projects
    : projects.filter((project) => `${project.label}\n${project.cwds.join("\n")}`.toLocaleLowerCase().includes(normalizedQuery));
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      <View style={styles.menuTitleRow}>
        <Text style={styles.sheetTitle}>Choose project</Text>
        <View style={styles.flex} />
        <Pressable accessibilityLabel="Close project picker" onPress={onClose} style={styles.headerIcon}>
          <Ionicons name="close" size={21} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.projectSearch}>
        <Ionicons name="search-outline" size={19} color={colors.textMuted} />
        <TextInput
          accessibilityLabel="Search projects"
          value={query}
          onChangeText={setQuery}
          placeholder="Search projects"
          placeholderTextColor={colors.textDim}
          style={styles.projectSearchInput}
        />
      </View>
      <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
        {visibleProjects.map((project) => (
          <ControlOption
            key={project.cwd}
            title={project.label}
            subtitle={project.cwd}
            selected={projectIncludesCwd(project, cwd)}
            onPress={() => {
              if (!busy && !projectIncludesCwd(project, cwd)) void onSelect(project.cwd);
            }}
          />
        ))}
        {visibleProjects.length === 0 && <Text style={styles.menuNotice}>No matching projects</Text>}
        <ControlOption
          title="Server default"
          subtitle="Let Codex choose its default working directory"
          selected={false}
          onPress={() => {
            if (!busy) void onSelect(null);
          }}
        />
        {busy && <View style={styles.projectPickerProgress}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.menuNotice}>Switching project…</Text></View>}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </AppSheetScrollView>
    </AppSheet>
  );
}

function ConnectionSheet({
  visible,
  localReady,
  localError,
  onRetryStartup,
  onClose,
  onSave,
  initialCode,
}: {
  visible: boolean;
  localReady: boolean;
  localError: string | null;
  onRetryStartup(): Promise<void>;
  onClose(): void;
  onSave(input: ConnectionInput): Promise<void>;
  initialCode: string | null;
}) {
  const [openedAt, setOpenedAt] = useState(Date.now);
  const [initialPairing] = useState(() => initialCode === null ? null : pairingParseResult(initialCode));
  const initialValue = initialPairing?.value ?? null;
  const [mode, setMode] = useState<"choose" | "review" | "manual" | "success">(initialValue === null ? "choose" : "review");
  const [displayName, setDisplayName] = useState(initialValue?.displayName ?? "");
  const [emoji, setEmoji] = useState(initialValue?.emoji ?? "🖥️");
  const [endpoint, setEndpoint] = useState(initialValue?.endpoint ?? "");
  const [token, setToken] = useState(initialValue?.pairingToken ?? "");
  const [tlsPinSha256, setTlsPinSha256] = useState(initialValue?.tlsPinSha256 ?? "");
  const [expiresAt, setExpiresAt] = useState<number | null>(initialValue?.expiresAt ?? null);
  const fullscreenOverlay = useAppFullscreenOverlay();
  const [error, setError] = useState<string | null>(initialPairing?.error ?? null);
  const [saving, setSaving] = useState(false);
  const reset = () => {
    setMode("choose");
    setDisplayName("");
    setEmoji("🖥️");
    setEndpoint("");
    setToken("");
    setTlsPinSha256("");
    setExpiresAt(null);
    setError(null);
  };
  const consumeCode = (raw: string): string | null => {
    const result = pairingParseResult(raw);
    if (result.value !== null) {
      const pairing = result.value;
      setDisplayName(pairing.displayName);
      setEmoji(pairing.emoji);
      setEndpoint(pairing.endpoint);
      setToken(pairing.pairingToken);
      setTlsPinSha256(pairing.tlsPinSha256 ?? "");
      setExpiresAt(pairing.expiresAt);
      setError(null);
      setMode("review");
      return null;
    }
    setError(result.error);
    return result.error;
  };
  const beginOpen = useEffectEvent((code: string | null) => {
    setOpenedAt(Date.now());
    reset();
    if (code !== null) consumeCode(code);
  });
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => beginOpen(initialCode));
    return () => cancelAnimationFrame(frame);
  }, [initialCode, visible]);
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };
  const pasteCode = async () => {
    setError(null);
    const value = await Clipboard.getStringAsync();
    if (value.trim() === "") {
      setError("Clipboard is empty. Copy the connection link from your host first.");
      return;
    }
    consumeCode(value);
  };
  const save = async () => {
    if (!localReady) {
      setError(localError ?? "Local storage is still preparing. Try again in a moment.");
      return;
    }
    setSaving(true);
    setError(null);
    const input: ConnectionInput = { displayName, emoji, endpoint, token, ...(tlsPinSha256.trim() === "" ? {} : { tlsPinSha256 }) };
    try {
      await onSave(input);
      setMode("success");
      await new Promise((resolve) => setTimeout(resolve, 650));
      reset();
      onClose();
    } catch (cause) {
      setError(humanPairingError(cause));
    }
    setSaving(false);
  };
  const endpointLabel = pairingEndpointLabel(endpoint);
  const minutesLeft = expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - openedAt) / 60_000));
  return (
    <>
      <AppSheet
        isOpen={visible}
        onOpenChange={(open) => { if (!open) close(); }}
        contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
      >
            <AppSheetScrollView
              style={styles.connectionSheetScroll}
              contentContainerStyle={styles.connectionSheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.pairingHeader}>
                {mode !== "choose" && mode !== "success" ? (
                  <Pressable accessibilityLabel="Back to connection methods" hitSlop={8} onPress={() => { setMode("choose"); setError(null); }} style={styles.pairingBack}>
                    <Ionicons name="chevron-back" size={21} color={colors.text} />
                  </Pressable>
                ) : <View style={styles.pairingBack} />}
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.pairingHeaderTitle}>{mode === "review" ? "Ready to connect" : mode === "manual" ? "Manual setup" : mode === "success" ? "Connected" : "Connect a server"}</Text>
                <Pressable accessibilityLabel="Close server pairing" hitSlop={8} disabled={saving} onPress={close} style={styles.pairingBack}>
                  <Ionicons name="close" size={21} color={colors.textMuted} />
                </Pressable>
              </View>

              {mode === "choose" && (
                <View style={styles.pairingBody}>
                  <View style={styles.pairingHeroIcon}><Ionicons name="link" size={28} color={colors.primary} /></View>
                  <Text style={styles.pairingLead}>Connect this phone to Codex running on another machine.</Text>
                  <Text style={styles.pairingHint}>On the host, run <Text style={styles.pairingCode}>codewide-host pair</Text>. Then scan or paste the one-time link.</Text>
                  <View style={styles.pairingActionStack}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Scan pairing QR" onPress={() => {
                      fullscreenOverlay.present(({ close: closeScanner }) => (
                        <PairingQrScanner
                          onClose={closeScanner}
                          onScan={(raw) => {
                            const message = consumeCode(raw);
                            if (message === null) closeScanner();
                            return message;
                          }}
                        />
                      ));
                    }} style={styles.pairingPrimaryAction}>
                      <Ionicons name="qr-code-outline" size={22} color={colors.onPrimary} />
                      <Text style={styles.pairingPrimaryText}>Scan QR code</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Paste connection link" onPress={() => void pasteCode()} style={styles.pairingSecondaryAction}>
                      <Ionicons name="clipboard-outline" size={21} color={colors.text} />
                      <Text style={styles.pairingSecondaryText}>Paste connection link</Text>
                    </Pressable>
                  </View>
                  {error !== null && <View style={styles.pairingError}><Ionicons name="alert-circle-outline" size={18} color={colors.red} /><Text style={[styles.errorText, styles.flex]}>{error}</Text></View>}
                  <Pressable accessibilityRole="button" accessibilityLabel="Open manual server setup" onPress={() => { setMode("manual"); setError(null); }} style={styles.pairingTextAction}>
                    <Text style={styles.pairingTextActionLabel}>Advanced manual setup</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
                  </Pressable>
                  <View style={styles.pairingSafety}><Ionicons name="shield-checkmark-outline" size={17} color={colors.green} /><Text style={styles.pairingSafetyText}>One-time code · device-bound credentials · revocable access</Text></View>
                </View>
              )}

              {mode === "review" && (
                <View style={styles.pairingBody}>
                  <View style={styles.pairingReviewCard}>
                    <View style={styles.pairingIdentityRow}>
                      <TextInput voiceInput={false} accessibilityLabel="Server emoji" value={emoji} onChangeText={setEmoji} style={styles.pairingEmojiInput} />
                      <TextInput accessibilityLabel="Server name" value={displayName} onChangeText={setDisplayName} selectTextOnFocus style={styles.pairingNameInput} />
                    </View>
                    <View style={styles.pairingServerMeta}><Ionicons name="lock-closed-outline" size={16} color={colors.green} /><Text numberOfLines={1} ellipsizeMode="middle" style={styles.pairingEndpoint}>{endpointLabel}</Text></View>
                    <View style={styles.pairingServerMeta}><Ionicons name="time-outline" size={16} color={colors.textMuted} /><Text numberOfLines={1} ellipsizeMode="tail" style={styles.pairingMetaText}>{minutesLeft === null ? "One-time connection" : `Code expires in ${minutesLeft} min`}</Text></View>
                  </View>
                  {(error ?? localError) !== null && <View style={styles.pairingError}><Ionicons name="alert-circle-outline" size={18} color={colors.red} /><Text style={[styles.errorText, styles.flex]}>{error ?? localError}</Text>{localError !== null && <Pressable accessibilityRole="button" accessibilityLabel="Retry local startup" hitSlop={8} onPress={() => void onRetryStartup()}><Ionicons name="refresh" size={20} color={colors.text} /></Pressable>}</View>}
                  <Pressable accessibilityRole="button" accessibilityLabel="Connect server" disabled={saving || !localReady} onPress={() => void save()} style={[styles.pairingPrimaryAction, (saving || !localReady) && styles.disabled]}>
                    {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="link" size={21} color={colors.onPrimary} />}
                    <Text style={styles.pairingPrimaryText}>{saving ? "Securing this device…" : localReady ? "Connect" : localError === null ? "Preparing local storage…" : "Local storage unavailable"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Edit connection details" disabled={saving} onPress={() => setMode("manual")} style={styles.pairingTextAction}>
                    <Text style={styles.pairingTextActionLabel}>Edit details</Text><Ionicons name="options-outline" size={17} color={colors.textMuted} />
                  </Pressable>
                </View>
              )}

              {mode === "manual" && (
                <View style={styles.pairingBody}>
                  <Text style={styles.pairingHint}>Use this only when QR and connection links are unavailable.</Text>
                  <View style={styles.pairingIdentityFields}>
                    <TextInput voiceInput={false} accessibilityLabel="Server emoji" value={emoji} onChangeText={setEmoji} style={styles.pairingEmojiInput} />
                    <TextInput accessibilityLabel="Server name" value={displayName} onChangeText={setDisplayName} placeholder="Home workstation" placeholderTextColor={colors.textDim} style={[styles.fieldInput, styles.flex]} />
                  </View>
                  <Text style={styles.fieldLabel}>Secure endpoint</Text>
                  <TextInput accessibilityLabel="Server endpoint" value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="wss://host.example/v1/sync" placeholderTextColor={colors.textDim} style={styles.fieldInput} />
                  <Text style={styles.fieldLabel}>One-time pairing token</Text>
                  <TextInput accessibilityLabel="One-time pairing token" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Paste token" placeholderTextColor={colors.textDim} style={styles.fieldInput} />
                  <Text style={styles.fieldLabel}>TLS pin · optional</Text>
                  <TextInput voiceInput={false} accessibilityLabel="TLS certificate pin" value={tlsPinSha256} onChangeText={setTlsPinSha256} autoCapitalize="none" autoCorrect={false} placeholder="sha256/base64…" placeholderTextColor={colors.textDim} style={styles.fieldInput} />
                  {(error ?? localError) !== null && <View style={styles.pairingError}><Ionicons name="alert-circle-outline" size={18} color={colors.red} /><Text style={[styles.errorText, styles.flex]}>{error ?? localError}</Text>{localError !== null && <Pressable accessibilityRole="button" accessibilityLabel="Retry local startup" hitSlop={8} onPress={() => void onRetryStartup()}><Ionicons name="refresh" size={20} color={colors.text} /></Pressable>}</View>}
                  <Pressable accessibilityRole="button" accessibilityLabel="Connect server manually" disabled={saving || !localReady} onPress={() => void save()} style={[styles.pairingPrimaryAction, (saving || !localReady) && styles.disabled]}>
                    {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="link" size={21} color={colors.onPrimary} />}
                    <Text style={styles.pairingPrimaryText}>{saving ? "Securing this device…" : localReady ? "Connect" : localError === null ? "Preparing local storage…" : "Local storage unavailable"}</Text>
                  </Pressable>
                </View>
              )}

              {mode === "success" && (
                <View style={styles.pairingSuccess}>
                  <View style={styles.pairingSuccessIcon}><Ionicons name="checkmark" size={34} color={colors.onPrimary} /></View>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={styles.pairingSuccessTitle}>{emoji} {displayName}</Text>
                  <Text style={styles.pairingHint}>Connected. Syncing your threads now.</Text>
                </View>
              )}
            </AppSheetScrollView>
      </AppSheet>
    </>
  );
}

function pairingEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.port === "" ? url.hostname : `${url.hostname}:${url.port}`;
  } catch {
    return endpoint.trim() === "" ? "Secure remote host" : endpoint.trim();
  }
}

function PairingQrScanner({ onClose, onScan }: { onClose(): void; onScan(raw: string): string | null }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (permission?.granted === false && permission.canAskAgain) void requestPermission();
  }, [permission?.canAskAgain, permission?.granted, requestPermission]);
  return (
      <View style={[styles.scannerRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.scannerHeader}>
          <Text style={styles.sheetTitle}>Scan host pairing QR</Text>
          <Pressable accessibilityLabel="Close QR scanner" onPress={onClose} style={styles.headerIcon}><Ionicons name="close" size={23} color={colors.text} /></Pressable>
        </View>
        {permission === null ? (
          <View style={styles.emptyConversation}><Text style={styles.emptyText}>Starting camera…</Text></View>
        ) : permission.granted ? (
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scanned ? undefined : ({ data }) => {
              setScanned(true);
              const message = onScan(data);
              if (message !== null) {
                setScanError(message);
                setTimeout(() => setScanned(false), 900);
              }
            }}
          >
            <View style={styles.scannerFrame} />
            {scanError !== null && <View style={styles.scannerError}><Text style={styles.errorText}>{scanError}</Text></View>}
          </CameraView>
        ) : (
          <View style={styles.emptyConversation}>
            <Text style={styles.emptyText}>Camera permission is required to scan the one-time pairing code.</Text>
            <Pressable onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{permission.canAskAgain ? "Allow camera" : "Open settings"}</Text></Pressable>
          </View>
        )}
      </View>
  );
}

function ConnectionSettings({
  visible,
  connections,
  onClose,
  onToggle,
  onReconnect,
  onDelete,
  onUpdate,
  onMove,
  accountRateLimits,
  onRefreshAccountPool,
  onStartAccountLogin,
  onCancelAccountLogin,
  onActivateAccountProfile,
  onUpdateAccountProfile,
  onRemoveAccountProfile,
}: {
  visible: boolean;
  connections: StoredConnection[];
  onClose(): void;
  onToggle(connectionId: string, enabled: boolean): Promise<void>;
  onReconnect(connectionId: string): Promise<void>;
  onDelete(connectionId: string): Promise<void>;
  onUpdate(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  onMove(connectionId: string, direction: -1 | 1): Promise<void>;
  accountRateLimits: AccountRateLimitsRow[];
  onRefreshAccountPool?(connectionId: string): Promise<AccountPoolSnapshot>;
  onStartAccountLogin?(connectionId: string): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelAccountLogin?(connectionId: string, loginId: string): Promise<void>;
  onActivateAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdateAccountProfile?(connectionId: string, profileId: string, update: { enabled?: boolean; priority?: number }): Promise<AccountPoolSnapshot>;
  onRemoveAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
}) {
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["65%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
          <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Settings</Text>
          <View style={styles.flex} />
          <Pressable accessibilityLabel="Close server settings" onPress={onClose} style={styles.headerIcon}>
            <Ionicons name="close" size={21} color={colors.text} />
          </Pressable>
          </View>
          <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent} keyboardShouldPersistTaps="handled">
            {connections.length === 0 && <Text style={styles.emptyText}>No saved servers</Text>}
            {connections.map((connection) => (
              <ConnectionRowEditor
                key={connection.id}
                connection={connection}
                onToggle={onToggle}
                onReconnect={onReconnect}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onMove={onMove}
                accountPool={accountRateLimits.find((row) => row.connectionId === connection.id)?.accountPool ?? null}
                {...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool })}
                {...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin })}
                {...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin })}
                {...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile })}
                {...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile })}
                {...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile })}
              />
            ))}
            {visible && <PerformanceDiagnostics />}
          </AppSheetScrollView>
    </AppSheet>
  );
}

function ConnectionRowEditor({
  connection,
  onToggle,
  onReconnect,
  onDelete,
  onUpdate,
  onMove,
  accountPool,
  onRefreshAccountPool,
  onStartAccountLogin,
  onCancelAccountLogin,
  onActivateAccountProfile,
  onUpdateAccountProfile,
  onRemoveAccountProfile,
}: {
  connection: StoredConnection;
  onToggle(connectionId: string, enabled: boolean): Promise<void>;
  onReconnect(connectionId: string): Promise<void>;
  onDelete(connectionId: string): Promise<void>;
  onUpdate(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  onMove(connectionId: string, direction: -1 | 1): Promise<void>;
  accountPool: AccountPoolSnapshot | null;
  onRefreshAccountPool?(connectionId: string): Promise<AccountPoolSnapshot>;
  onStartAccountLogin?(connectionId: string): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelAccountLogin?(connectionId: string, loginId: string): Promise<void>;
  onActivateAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdateAccountProfile?(connectionId: string, profileId: string, update: { enabled?: boolean; priority?: number }): Promise<AccountPoolSnapshot>;
  onRemoveAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(connection.displayName);
  const [emoji, setEmoji] = useState(connection.emoji);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [replacementToken, setReplacementToken] = useState("");
  const [tlsPinSha256, setTlsPinSha256] = useState(connection.tlsPinSha256 ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const dialog = useAppDialog();
  const cancelEditing = () => {
    setName(connection.displayName);
    setEmoji(connection.emoji);
    setEndpoint(connection.endpoint);
    setReplacementToken("");
    setTlsPinSha256(connection.tlsPinSha256 ?? "");
    setError(null);
    setEditing(false);
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    const input: ConnectionUpdateInput = {
      displayName: name,
      emoji,
      endpoint,
      ...(replacementToken.trim() === "" ? {} : { token: replacementToken }),
      ...(tlsPinSha256.trim() === "" ? {} : { tlsPinSha256 }),
    };
    try {
      await onUpdate(connection.id, input);
      setReplacementToken("");
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update server");
    }
    setSaving(false);
  };
  const connectionActions: ActionMenuItem[] = [
    { id: "reconnect", label: "Reconnect", icon: "refresh", disabled: !connection.enabled },
    { id: "edit", label: "Edit server", icon: "pencil-outline" },
    { id: "move-up", label: "Move up", icon: "arrow-up" },
    { id: "move-down", label: "Move down", icon: "arrow-down" },
    { id: "delete", label: "Delete server", icon: "trash-outline", destructive: true },
  ];
  const handleConnectionAction = (id: string) => {
    if (id === "reconnect") void onReconnect(connection.id);
    else if (id === "edit") setEditing(true);
    else if (id === "move-up") void onMove(connection.id, -1);
    else if (id === "move-down") void onMove(connection.id, 1);
    else if (id === "delete") {
      dialog.alert("Delete server?", `Remove ${connection.displayName} from this device?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => { void onDelete(connection.id); } },
      ]);
    }
  };
  return (
    <View style={styles.connectionEditor}>
      {editing ? (
        <View style={styles.connectionEditorForm}>
          <View style={styles.connectionIdentityFields}>
            <TextInput voiceInput={false} accessibilityLabel={`Emoji for ${connection.displayName}`} value={emoji} onChangeText={setEmoji} style={styles.connectionEmojiInput} />
            <TextInput accessibilityLabel={`Name for ${connection.displayName}`} value={name} onChangeText={setName} style={[styles.fieldInput, styles.flex]} />
          </View>
          <Text style={styles.fieldLabel}>Secure endpoint</Text>
          <TextInput voiceInput={false} accessibilityLabel={`Endpoint for ${connection.displayName}`} value={endpoint} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} style={styles.fieldInput} />
          <Text style={styles.fieldLabel}>Replacement capability (leave blank to keep current)</Text>
          <TextInput accessibilityLabel={`Replacement capability for ${connection.displayName}`} value={replacementToken} onChangeText={setReplacementToken} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.fieldInput} />
          <Text style={styles.fieldLabel}>TLS certificate pin (blank disables pinning)</Text>
          <TextInput voiceInput={false} accessibilityLabel={`TLS pin for ${connection.displayName}`} value={tlsPinSha256} onChangeText={setTlsPinSha256} autoCapitalize="none" autoCorrect={false} style={styles.fieldInput} />
          {error !== null && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.sheetActions}>
            <Pressable accessibilityLabel={`Cancel editing ${connection.displayName}`} disabled={saving} onPress={cancelEditing} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
            <Pressable accessibilityLabel={`Save ${connection.displayName}`} disabled={saving} onPress={() => void save()} style={[styles.primaryButton, saving && styles.disabled]}><Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save"}</Text></Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.connectionRow}>
          <View style={styles.connectionSummary}>
            <Text style={styles.serverEmoji}>{Platform.OS === "web" ? connection.displayName.slice(0, 1).toLocaleUpperCase() : connection.emoji}</Text>
            <View style={styles.controlOptionText}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.menuActionTitle}>{connection.displayName}</Text>
              <Text numberOfLines={1} ellipsizeMode="middle" style={styles.menuActionSubtitle}>{connection.endpoint}</Text>
              <View style={styles.connectionStateRow}>
                <View style={styles.connectionStateIcon}>
                  {connection.enabled && connectionActivity(connection.state) !== null
                    ? <ConnectionActivityIndicator status={connection.state} size={12} />
                    : <View style={[styles.connectionStateDot, { backgroundColor: connection.enabled ? connectionStateColor(connection.state) : colors.textDim }]} />}
                </View>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.connectionStateText, { color: connection.enabled ? connectionStateColor(connection.state) : colors.textDim }]}> 
                  {connectionStateLabel(connection.state, connection.enabled)}
                </Text>
                {connection.tlsPinSha256 !== undefined && <Text style={styles.connectionPinned}>TLS pinned</Text>}
              </View>
            </View>
            <Switch
              accessibilityLabel={`Enable ${connection.displayName}`}
              value={connection.enabled}
              onValueChange={(enabled) => void onToggle(connection.id, enabled)}
            />
            <ActionMenu
              accessibilityLabel={`Actions for ${connection.displayName}`}
              actions={connectionActions}
              onSelect={handleConnectionAction}
              style={styles.connectionActionMenuAnchor}
            >
              <Pressable accessibilityLabel={`Actions for ${connection.displayName}`} style={styles.connectionMiniButton}>
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
              </Pressable>
            </ActionMenu>
          </View>
          {connection.lastError !== null && connection.state !== "live" && (
            <View style={styles.connectionDiagnostic}>
              <View style={styles.connectionDiagnosticHeader}>
                <Ionicons name="warning-outline" size={17} color={colors.red} />
                <Text selectable style={styles.connectionDiagnosticSummary}>{connectionDiagnosticSummary(connection.lastError)}</Text>
              </View>
              <View style={styles.connectionDiagnosticMeta}>
                {connection.lastErrorAt !== null && <Text style={styles.connectionDiagnosticTime}>{connectionDiagnosticTime(connection.lastErrorAt)}</Text>}
                <Pressable accessibilityLabel={`${diagnosticExpanded ? "Hide" : "Show"} error details for ${connection.displayName}`} onPress={() => setDiagnosticExpanded((value) => !value)}>
                  <Text style={styles.rawLink}>{diagnosticExpanded ? "Hide details" : "Error details"}</Text>
                </Pressable>
                <Pressable accessibilityLabel={`Copy error for ${connection.displayName}`} onPress={() => void Clipboard.setStringAsync(connection.lastError ?? "")}>
                  <Text style={styles.rawLink}>Copy</Text>
                </Pressable>
              </View>
              {diagnosticExpanded && <Text selectable style={styles.connectionDiagnosticRaw}>{connection.lastError}</Text>}
            </View>
          )}
          {onRefreshAccountPool !== undefined && onStartAccountLogin !== undefined && onCancelAccountLogin !== undefined && onActivateAccountProfile !== undefined && onUpdateAccountProfile !== undefined && onRemoveAccountProfile !== undefined && (
            <AccountPoolEditor
              connectionId={connection.id}
              accountPool={accountPool}
              onRefresh={onRefreshAccountPool}
              onStartLogin={onStartAccountLogin}
              onCancelLogin={onCancelAccountLogin}
              onActivate={onActivateAccountProfile}
              onUpdate={onUpdateAccountProfile}
              onRemove={onRemoveAccountProfile}
            />
          )}
        </View>
      )}
    </View>
  );
}

function AccountPoolEditor({
  connectionId,
  accountPool,
  onRefresh,
  onStartLogin,
  onCancelLogin,
  onActivate,
  onUpdate,
  onRemove,
}: {
  connectionId: string;
  accountPool: AccountPoolSnapshot | null;
  onRefresh(connectionId: string): Promise<AccountPoolSnapshot>;
  onStartLogin(connectionId: string): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelLogin(connectionId: string, loginId: string): Promise<void>;
  onActivate(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdate(connectionId: string, profileId: string, update: { enabled?: boolean; priority?: number }): Promise<AccountPoolSnapshot>;
  onRemove(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAccountLoginState, setPendingAccountLogin] = useState<{
    loginId: string;
    verificationUrl: string;
    userCode: string;
    profileIds: string;
  } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [loginActionBusy, setLoginActionBusy] = useState(false);
  const profiles = accountPool?.profiles ?? [];
  const profileIds = profiles.map((profile) => profile.id).sort().join("|");
  const pendingAccountLogin = pendingAccountLoginState?.profileIds === profileIds
    ? pendingAccountLoginState
    : null;

  useEffect(() => {
    if (!codeCopied) return undefined;
    const timeout = setTimeout(() => setCodeCopied(false), 2_400);
    return () => clearTimeout(timeout);
  }, [codeCopied]);

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account operation failed");
    }
    setBusy(false);
  };
  const addAccount = async () => {
    const login = await onStartLogin(connectionId);
    setCodeCopied(false);
    setPendingAccountLogin({ ...login, profileIds });
  };
  const closeAccountLogin = () => {
    const login = pendingAccountLogin;
    setPendingAccountLogin(null);
    setCodeCopied(false);
    if (login !== null) void onCancelLogin(connectionId, login.loginId).catch(() => undefined);
  };
  const copyAccountCode = async () => {
    if (pendingAccountLogin === null) return;
    await Clipboard.setStringAsync(pendingAccountLogin.userCode);
    setCodeCopied(true);
  };
  const openAccountSignIn = async () => {
    if (pendingAccountLogin === null || loginActionBusy) return;
    setLoginActionBusy(true);
    setError(null);
    try {
      await Clipboard.setStringAsync(pendingAccountLogin.userCode);
      setCodeCopied(true);
      await Linking.openURL(pendingAccountLogin.verificationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open Codex sign-in");
    }
    setLoginActionBusy(false);
  };
  return (
    <>
      <View style={styles.accountPoolEditor}>
        <View style={styles.accountPoolHeader}>
          <View style={styles.flex}>
            <Text style={styles.fieldLabel}>Codex accounts</Text>
            <Text style={styles.menuActionSubtitle}>Manual selection · automatic fallback on limit</Text>
          </View>
          <Pressable accessibilityLabel="Refresh Codex accounts" disabled={busy} onPress={() => void run(async () => await onRefresh(connectionId))} style={[styles.connectionMiniButton, busy && styles.disabled]}>
            {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="refresh" size={18} color={colors.textMuted} />}
          </Pressable>
        </View>
        {profiles.map((profile, index) => {
          const label = accountProfileLabel(profile, index);
          const weekly = selectWeeklyRateLimit(profile.rateLimits);
          const limitLabel = weekly !== null
            ? `${Math.round(weekly.remainingPercent)}% left`
            : profile.exhaustedIndefinitely
              ? "Limit reached"
              : "Usage pending";
          const actions: ActionMenuItem[] = [
            { id: "activate", label: profile.active ? "Active account" : "Switch to account", icon: "person-circle-outline", selected: profile.active, disabled: profile.active || !profile.enabled },
            ...(index === 0 ? [] : [{ id: "make-primary", label: "Make primary", icon: "star-outline" as const }]),
            ...(profiles.length > 2 && index > 0 ? [{ id: "move-up", label: "Move earlier", icon: "arrow-up" as const }] : []),
            ...(profiles.length > 2 && index < profiles.length - 1 ? [{ id: "move-down", label: "Move later", icon: "arrow-down" as const }] : []),
            { id: "toggle-enabled", label: profile.enabled ? "Disable fallback" : "Enable fallback", icon: profile.enabled ? "pause-circle-outline" : "play-circle-outline", selected: profile.enabled },
            ...(!profile.active ? [{ id: "remove", label: "Remove account", icon: "trash-outline" as const, destructive: true }] : []),
          ];
          const handleAction = (id: string) => {
            if (id === "activate") void run(async () => await onActivate(connectionId, profile.id));
            else if (id === "make-primary") void run(async () => await onUpdate(connectionId, profile.id, { priority: 0 }));
            else if (id === "move-up") void run(async () => await onUpdate(connectionId, profile.id, { priority: index - 1 }));
            else if (id === "move-down") void run(async () => await onUpdate(connectionId, profile.id, { priority: index + 1 }));
            else if (id === "toggle-enabled") void run(async () => await onUpdate(connectionId, profile.id, { enabled: !profile.enabled }));
            else if (id === "remove") void run(async () => await onRemove(connectionId, profile.id));
          };
          return (
            <View key={profile.id} style={[styles.accountPoolRow, index > 0 && styles.accountPoolDivider]}>
              <View style={[styles.connectionStateDot, { backgroundColor: profile.active ? colors.green : profile.exhaustedUntil !== null || profile.exhaustedIndefinitely ? colors.red : colors.textDim }]} />
              <View style={styles.controlOptionText}>
                <View style={styles.accountPoolTitleRow}>
                  <Text numberOfLines={1} style={styles.accountPoolName}>{label}</Text>
                  <Text style={[styles.accountPoolRole, profile.active && styles.accountPoolRoleActive]}>{index === 0 ? `PRIMARY${profile.active ? " · ACTIVE" : ""}` : `BACKUP ${index}${profile.active ? " · ACTIVE" : ""}`}</Text>
                </View>
                <Text numberOfLines={1} style={styles.menuActionSubtitle}>
                  {profile.planType ?? "Plan pending"}{profile.enabled ? "" : " · disabled"}
                </Text>
              </View>
              <Text numberOfLines={1} style={[styles.accountPoolLimit, weekly === null && styles.accountPoolLimitPending]}>{limitLabel}</Text>
              <ActionMenu accessibilityLabel={`Actions for ${label}`} actions={actions} onSelect={handleAction} style={styles.accountPoolMenuAnchor}>
                <Pressable accessibilityLabel={`Actions for ${label}`} disabled={busy} style={[styles.connectionMiniButton, busy && styles.disabled]}>
                  <Ionicons name="ellipsis-horizontal" size={19} color={colors.textMuted} />
                </Pressable>
              </ActionMenu>
            </View>
          );
        })}
        {accountPool?.allExhausted === true && <Text style={styles.errorText}>All configured accounts are exhausted.</Text>}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(addAccount)} style={[styles.secondaryButton, styles.accountPoolAddButton, busy && styles.disabled]}>
          <Ionicons name="person-add-outline" size={17} color={colors.text} />
          <Text style={styles.secondaryButtonText}>Add Codex account</Text>
        </Pressable>
      </View>
      {pendingAccountLogin !== null && (
        <AppSheet
          isOpen
          onOpenChange={(open) => { if (!open) closeAccountLogin(); }}
          contentProps={{ index: 0, enableDynamicSizing: true, enableOverDrag: false }}
        >
          <View style={styles.accountLoginSheet}>
            <View style={styles.accountLoginHeader}>
              <View style={styles.accountLoginIcon}>
                <Ionicons name="people-outline" size={21} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.accountLoginTitle}>Connect Codex account</Text>
                <Text style={styles.accountLoginSubtitle}>Sign in to add this account as an automatic fallback.</Text>
              </View>
              <Pressable accessibilityLabel="Close Codex account sign-in" onPress={closeAccountLogin} style={styles.headerIcon}>
                <Ionicons name="close" size={21} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.accountLoginCodeCard}>
              <View style={styles.flex}>
                <Text style={styles.accountLoginCodeLabel}>One-time code</Text>
                <Text selectable style={styles.accountLoginCode}>{pendingAccountLogin.userCode}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Copy one-time Codex sign-in code" onPress={() => void copyAccountCode()} style={[styles.accountLoginCopyButton, codeCopied && styles.accountLoginCopyButtonDone]}>
                <Ionicons name={codeCopied ? "checkmark" : "copy-outline"} size={17} color={codeCopied ? colors.green : colors.text} />
                <Text style={[styles.accountLoginCopyLabel, codeCopied && styles.accountLoginCopyLabelDone]}>{codeCopied ? "Copied" : "Copy"}</Text>
              </Pressable>
            </View>
            <Text style={styles.accountLoginHint}>The code is copied automatically when you open sign-in. Paste it in the browser to finish connecting.</Text>
            <Pressable accessibilityRole="button" disabled={loginActionBusy} onPress={() => void openAccountSignIn()} style={[styles.primaryButton, styles.accountLoginPrimaryButton, loginActionBusy && styles.disabled]}>
              {loginActionBusy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="open-outline" size={19} color={colors.onPrimary} />}
              <Text style={styles.primaryButtonText}>{loginActionBusy ? "Opening…" : "Open sign-in"}</Text>
            </Pressable>
          </View>
        </AppSheet>
      )}
    </>
  );
}

function protocolIcon(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === "reasoning") return "bulb-outline";
  if (kind === "commandExecution") return "terminal-outline";
  if (kind === "fileChange") return "document-text-outline";
  if (kind === "webSearch") return "search";
  if (kind === "mcpToolCall" || kind === "dynamicToolCall") return "extension-puzzle-outline";
  if (kind === "subAgentActivity" || kind === "collabAgentToolCall") return "people-outline";
  if (kind === "imageGeneration" || kind === "imageView") return "image-outline";
  if (kind === "turnDiff") return "git-compare-outline";
  if (kind === "tokenUsage") return "speedometer-outline";
  return "cube-outline";
}

function isToolActivityKind(kind: string): boolean {
  return kind === "commandExecution"
    || kind === "fileChange"
    || kind === "turnDiff"
    || kind === "mcpToolCall"
    || kind === "dynamicToolCall"
    || kind === "webSearch"
    || kind === "collabAgentToolCall"
    || kind === "subAgentActivity";
}

function formatThreadTime(timestamp: number): string {
  return formatDeviceTime(timestamp);
}

function formatClockTime(timestamp: number): string {
  return formatDeviceTime(timestamp);
}

function formatDeviceTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function completedTurnSignature(turn: Thread["turns"][number]): string | null {
  if (turn.status === "inProgress") return null;
  const lastItem = turn.items.at(-1) as { id?: unknown; type?: unknown } | undefined;
  const metadata = projectedTurnMetadata(turn);
  return JSON.stringify([
    turn.status,
    turn.itemsView,
    turn.items.length,
    turn.completedAt,
    turn.durationMs,
    turn.error,
    lastItem?.id ?? null,
    lastItem?.type ?? null,
    metadata?.usage ?? null,
    metadata?.execution ?? null,
    metadata?.plan ?? null,
    textFingerprint(metadata?.diff ?? ""),
  ]);
}

function turnMetadataBlocks(scope: string, turn: Thread["turns"][number]): RenderBlock[] {
  const metadata = projectedTurnMetadata(turn);
  if (metadata === null) return [];
  const blocks: RenderBlock[] = [];
  if (metadata.plan !== undefined) {
    const completed = metadata.plan.steps.filter((step) => step.status === "completed").length;
    const checklist = metadata.plan.steps.map((step) => `${step.status === "completed" ? "- [x]" : "- [ ]"} ${step.step}`).join("\n");
    blocks.push({
      key: `${scope}/${turn.id}/live-plan`,
      kind: "turnPlan",
      title: "Plan",
      body: [metadata.plan.explanation, checklist].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n\n"),
      status: `${completed}/${metadata.plan.steps.length}`,
      durationMs: null,
      tone: "info",
      collapsible: true,
      raw: { explanation: metadata.plan.explanation, plan: metadata.plan.steps },
      content: null,
    });
  }
  if (metadata.diff !== undefined) {
    blocks.push({
      key: `${scope}/${turn.id}/live-diff`,
      kind: "turnDiff",
      title: "Turn diff",
      body: metadata.diff,
      status: null,
      durationMs: null,
      tone: "neutral",
      collapsible: true,
      raw: { diff: metadata.diff },
      content: null,
    });
  }
  return blocks;
}

function textFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

function firstLine(value: string): string | null {
  const line = value.trim().split("\n")[0]?.trim();
  return line === undefined || line === "" ? null : line.slice(0, 80);
}

function threadSelectionKey(thread: Pick<DemoThread, "id" | "serverId">): string {
  return `${thread.serverId}\u0000${thread.id}`;
}

function injectedTestWorkspace(): InjectedTestWorkspace | null {
  if (typeof __DEV__ === "undefined" || !__DEV__ || Platform.OS !== "web") return null;
  const value = (globalThis as typeof globalThis & { __CODEWIDE_TEST_WORKSPACE__?: unknown }).__CODEWIDE_TEST_WORKSPACE__;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<InjectedTestWorkspace>;
  if (!Array.isArray(candidate.servers) || !Array.isArray(candidate.threads)) return null;
  return {
    servers: candidate.servers,
    threads: candidate.threads,
    thread: candidate.thread ?? null,
    controls: candidate.controls ?? null,
  };
}

function injectedTestThread(): Thread | null {
  if (typeof __DEV__ === "undefined" || !__DEV__ || Platform.OS !== "web") return null;
  const value = (globalThis as typeof globalThis & { __CODEWIDE_TEST_THREAD__?: unknown }).__CODEWIDE_TEST_THREAD__;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<Thread>;
  return typeof candidate.id === "string" && Array.isArray(candidate.turns) ? candidate as Thread : null;
}

function moveItem<T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return items;
  next.splice(target, 0, moved);
  return next;
}

function leadingEmoji(value: string): string | null {
  const match = value.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)/u);
  return match?.[1] ?? null;
}

function emojiSafeTitle(value: string): React.ReactNode {
  const emoji = leadingEmoji(value);
  if (emoji === null) return value;
  const title = value.slice(emoji.length).trimStart();
  return (
    <>
      <Text style={styles.emojiText}>{emoji}</Text>
      {title === "" ? null : ` ${title}`}
    </>
  );
}

function RunningThreadTitle({ value }: { value: string }) {
  const emoji = leadingEmoji(value);
  const title = emoji === null ? value : value.slice(emoji.length).trimStart();
  return (
    <View style={styles.runningThreadTitle}>
      {emoji !== null && title !== "" && <Text style={styles.emojiText}>{emoji}</Text>}
      <WaveText
        testID="running-thread-title-shimmer"
        text={title === "" ? value : title}
        style={styles.threadTitle}
        containerStyle={styles.threadTitleWave}
      />
    </View>
  );
}

function serverGlyph(server: Pick<DemoServer, "emoji" | "name">): string {
  return Platform.OS === "web" ? (server.name.trim().slice(0, 1).toLocaleUpperCase() || "C") : server.emoji;
}

function basename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "attachment";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactNumber(value: number): string {
  if (Math.abs(value) < 1_000) return value.toLocaleString();
  if (Math.abs(value) < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds >= 60_000) {
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.round((milliseconds % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatVoiceDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatTurnMeta(status: "completed" | "interrupted" | "failed" | "inProgress", durationMs: number | null, completedAt: number | null): string {
  const label = status === "inProgress" ? "Running" : status[0]?.toUpperCase() + status.slice(1);
  const parts = [label];
  if (durationMs !== null) parts.push(formatDuration(durationMs));
  if (completedAt !== null) parts.push(formatDeviceTime(completedAt));
  return parts.join(" · ");
}

function activeTurnId(thread: Thread | null | undefined): string | null {
  if (thread === null || thread === undefined) return null;
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn?.status === "inProgress") return turn.id;
  }
  return null;
}

function timelineSearchText(item: TimelineItem): string {
  const cached = timelineSearchTextCache.get(item);
  if (cached !== undefined) return cached;
  const value = item.kind === "turn" ? [
    ...item.turn.items.map((rawItem) => {
      if (rawItem.type === "userMessage") return rawItem.content.map((content) => "text" in content ? content.text : boundedJsonStringify(content, 8_192)).join("\n");
      if (rawItem.type === "agentMessage") return rawItem.text;
      return boundedJsonStringify(rawItem, 16_384);
    }),
    boundedJsonStringify(projectedTurnMetadata(item.turn) ?? {}, 8_192),
  ].join("\n")
    : item.kind === "optimistic" ? item.text
    : item.status;
  timelineSearchTextCache.set(item, value);
  return value;
}

function storedThreadToDemo(thread: StoredThreadSummary): DemoThread {
  const state = thread.pendingRequestCount > 0
    ? "approval"
    : thread.status.type === "active" ? "running" : thread.status.type === "systemError" ? "failed" : null;
  return {
    id: thread.remoteThreadId,
    serverId: thread.connectionId,
    title: thread.name ?? firstLine(thread.preview) ?? "Untitled thread",
    preview: thread.preview,
    time: formatThreadTime(thread.recencyAt ?? thread.updatedAt),
    pinned: thread.pinned,
    archived: thread.archived,
    unread: thread.unread,
    ...(state === null ? {} : { state }),
  };
}

function subagentDemoThread(summary: StoredThreadSummary, thread: Thread, connectionId: string): DemoThread {
  return {
    id: thread.id,
    serverId: connectionId,
    title: subagentDisplayName(summary),
    preview: summary.preview,
    time: formatThreadTime(summary.recencyAt ?? summary.updatedAt),
    pinned: false,
    archived: false,
    unread: summary.unread,
    ...(summary.status.type === "active"
      ? { state: "running" as const }
      : summary.status.type === "systemError"
        ? { state: "failed" as const }
        : {}),
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  desktopWorkspace: { flex: 1, flexDirection: "row" },
  flex: { flex: 1 },
  pressed: { opacity: 0.68 },
  serverRail: { width: 64, backgroundColor: colors.surfaceContainerLowest, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, alignItems: "center" },
  serverRailScroll: { flex: 1, width: "100%" },
  serverRailScrollContent: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs },
  railButton: { width: touchTarget, height: touchTarget, borderRadius: radii.large, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerLow },
  serverAvatar: { width: touchTarget, height: touchTarget, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow, alignItems: "center", justifyContent: "center", position: "relative" },
  serverAvatarActive: { backgroundColor: colors.primaryContainer, borderRadius: radii.selected },
  serverActiveMarker: { position: "absolute", left: -10, width: 3, height: 24, borderRadius: 2, backgroundColor: colors.primary },
  serverEmoji: { fontSize: 22 },
  statusDot: { position: "absolute", right: -1, bottom: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  connectionActivityIndicator: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  threadSidebar: {
    minWidth: 280,
    maxWidth: 480,
    flexShrink: 0,
    backgroundColor: colors.surface,
  },
  sidebarHeader: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  serverTitleRow: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  serverTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: "700" },
  headerIcon: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.large },
  headerMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  topBarAction: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.large },
  topBarActionActive: { backgroundColor: colors.primaryContainer },
  threadSearchRow: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  threadSearchBox: { flex: 1, minWidth: 0 },
  threadFilterButton: { width: 44, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow, position: "relative" },
  threadFilterActiveDot: { position: "absolute", top: 8, right: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  searchBox: { height: 44, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, gap: spacing.xs },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, paddingVertical: 0 },
  sectionHeader: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontWeight: "700", paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xxs, textTransform: "uppercase", letterSpacing: 0.7 },
  threadListEmpty: { alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: 48 },
  threadListEmptyText: { color: colors.textMuted, ...typeScale.bodyMedium },
  threadRow: { minWidth: 0, maxWidth: "100%", minHeight: 64, alignSelf: "stretch", marginHorizontal: spacing.xs, marginVertical: 1, paddingVertical: 6, paddingHorizontal: spacing.xs, borderRadius: radii.selected, flexDirection: "row", alignItems: "center", gap: spacing.xs, position: "relative" },
  threadContextMenu: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", flexShrink: 1 },
  threadRowSwipeChild: { marginHorizontal: 0, marginVertical: 0, borderRadius: radii.selected, backgroundColor: colors.surface },
  swipeContainer: { minWidth: 0, maxWidth: "100%", alignSelf: "stretch", marginHorizontal: spacing.xs, marginVertical: 1, borderRadius: radii.selected, overflow: "hidden", backgroundColor: colors.surface },
  swipeChildren: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", backgroundColor: colors.surface },
  swipeActionsLeft: { flexDirection: "row", alignSelf: "stretch", backgroundColor: colors.surfaceContainerHigh },
  swipeActionsRight: { flexDirection: "row", alignSelf: "stretch", backgroundColor: colors.surfaceContainerHigh },
  swipeAction: { width: 72, alignItems: "center", justifyContent: "center", gap: 4 },
  swipeActionNeutral: { backgroundColor: colors.surfaceContainerHigh },
  swipeActionAccent: { backgroundColor: colors.primary },
  swipeActionDanger: { backgroundColor: colors.errorContainer },
  swipeActionPressed: { opacity: 0.72 },
  swipeActionText: { fontSize: 11, fontWeight: "700" },
  threadRowSelected: { backgroundColor: colors.secondaryContainer },
  selectionBar: { display: "none" },
  threadText: { flex: 1, minWidth: 0, maxWidth: "100%", gap: 1 },
  threadTitleLine: { width: "100%", minWidth: 0, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.xs },
  threadServerEmoji: { fontSize: 17 },
  threadTitleSlot: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  runningThreadTitle: { maxWidth: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  threadTitle: { minWidth: 0, maxWidth: "100%", flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  threadTitleWave: { maxWidth: "100%" },
  threadStatusIcon: { width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  threadTime: { minWidth: 48, flexShrink: 0, color: colors.textMuted, fontSize: 10, textAlign: "right", fontVariant: ["tabular-nums"] },
  unreadSlot: { width: 7, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 7, height: 7, flexShrink: 0, borderRadius: 4, backgroundColor: colors.primary },
  threadPreviewLine: { width: "100%", minWidth: 0, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.xs },
  threadPreview: { minWidth: 0, maxWidth: "100%", flex: 1, flexShrink: 1, color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  mobileList: { flex: 1, backgroundColor: colors.surface },
  mobileTitleRow: { minHeight: 64, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: 2 },
  mobileTitleSelector: { flex: 1, minWidth: 0, minHeight: touchTarget, paddingHorizontal: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.medium },
  mobileIdentity: { flex: 1, minWidth: 0 },
  mobileTitle: { flexShrink: 1, color: colors.text, ...typeScale.titleLarge },
  mobileSubtitle: { color: colors.textMuted, ...typeScale.labelMedium },
  mobileServers: { gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  mobileServer: { minHeight: touchTarget, paddingHorizontal: spacing.sm, borderRadius: radii.large, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceContainerLow },
  mobileServerActive: { backgroundColor: colors.primaryContainer },
  mobileServerEmoji: { fontSize: 17 },
  mobileServerName: { color: colors.text, fontSize: 13, fontWeight: "600" },
  mobileSearchWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  newThreadFab: { position: "absolute", right: spacing.md, bottom: spacing.md, width: 56, height: 56, borderRadius: radii.large, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, zIndex: 10, elevation: 3 },
  conversation: { flex: 1, minWidth: 0, backgroundColor: colors.background },
  conversationKeyboard: { flex: 1, minWidth: 0, alignSelf: "stretch", backgroundColor: colors.background },
  emptyConversation: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.background },
  emptyText: { color: colors.textMuted, fontSize: 16 },
  newChatEmptyState: { maxWidth: 520, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.lg },
  newChatPrompt: { color: colors.text, ...typeScale.titleLarge, textAlign: "center" },
  newChatProjectButton: { maxWidth: "100%", minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xxs, paddingHorizontal: spacing.sm, borderRadius: radii.large },
  newChatProjectText: { minWidth: 0, flexShrink: 1, color: colors.accent, ...typeScale.titleMedium },
  projectSearch: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.xs, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow },
  projectSearchInput: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.bodyLarge, paddingVertical: 0 },
  projectPickerProgress: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  conversationHeader: { minHeight: 56, paddingHorizontal: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.xxs, backgroundColor: colors.surface },
  conversationIdentity: { flex: 1, minWidth: 0 },
  conversationTitle: { color: colors.text, ...typeScale.titleMedium },
  emojiText: { fontFamily: Platform.select({ web: "system-ui", default: "sans-serif" }) },
  conversationSubtitle: { color: colors.textMuted, ...typeScale.labelMedium, marginTop: 1 },
  threadSearchBar: { minHeight: 50, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  threadSearchCount: { color: colors.textMuted, fontSize: 11, minWidth: 34, textAlign: "right" },
  conversationScroll: { flex: 1 },
  conversationKeyboardBody: { flex: 1, minHeight: 0 },
  timelineShell: { flex: 1 },
  timelineConcealed: { opacity: 0 },
  timelineLoadingOverlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  conversationContent: { paddingHorizontal: spacing.xs, paddingTop: 6 },
  conversationContentCompact: { flexGrow: 1, justifyContent: "flex-end" },
  conversationContentWide: { flexGrow: 1, paddingLeft: 52, paddingRight: spacing.md },
  timelineHeaderContent: { gap: spacing.xs, paddingBottom: spacing.xs },
  timelineItem: { width: "100%", maxWidth: 880, alignSelf: "center" },
  timelineItemWide: { alignSelf: "flex-start" },
  turnGroup: { gap: 5 },
  messageContextRoot: { alignSelf: "stretch", position: "relative" },
  turnMessages: { gap: 3 },
  turnBlock: { width: "100%" },
  turnFooter: { minHeight: TURN_FOOTER_MIN_HEIGHT, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 5 },
  turnFooterEnd: { alignSelf: "flex-end", justifyContent: "flex-end", maxWidth: "86%" },
  turnStatusDot: { width: 7, height: 7, borderRadius: 4 },
  turnStatusRunning: { backgroundColor: colors.amber },
  turnStatusFailed: { backgroundColor: colors.red },
  turnStatusStopped: { backgroundColor: colors.textDim },
  turnStatusCompleted: { backgroundColor: colors.green },
  userTurnCluster: { width: "100%", alignItems: "stretch", gap: 2 },
  userMessageRow: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 7 },
  agentMessageRow: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-start", gap: 7 },
  userBubble: { minWidth: 0, alignSelf: "flex-end", width: "auto", maxWidth: "82%", backgroundColor: colors.surfaceRaised, borderRadius: radii.selected, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 9 },
  userBubbleMedia: { width: "82%" },
  userBubbleText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  userMessageContent: { minWidth: 0, gap: 6 },
  userMessageMediaContent: { width: 320, maxWidth: "100%" },
  userMessageTextBlock: { minWidth: 0 },
  userMessageExpandButton: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingTop: 4 },
  userMessageExpandText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  userImageGallery: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 4, overflow: "hidden", borderRadius: radii.medium },
  userImageGalleryHero: { width: "100%", aspectRatio: 16 / 9 },
  userImageGalleryTile: { width: "49%", flexGrow: 1, aspectRatio: 1 },
  userImage: { width: 220, maxWidth: "100%", aspectRatio: 4 / 3, overflow: "hidden", borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  generatedImage: { width: "100%", maxWidth: 600, aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: colors.surfaceRaised },
  openableImage: { width: "100%", height: "100%", borderRadius: radii.medium },
  imageOpenBadge: { position: "absolute", right: 8, top: 8, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.62)" },
  attachmentChip: { minHeight: 27, maxWidth: 260, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 8, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  attachmentText: { flex: 1, color: colors.textMuted, fontSize: 11 },
  messageTime: { flexShrink: 0, color: colors.textDim, fontSize: 10, lineHeight: 13, marginBottom: 4 },
  optimisticError: { maxWidth: "82%", alignSelf: "flex-end", paddingHorizontal: 6, color: colors.red, fontSize: 10, lineHeight: 14, textAlign: "right" },
  retryMessageButton: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, borderRadius: radii.medium },
  retryMessageText: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  codexBubble: { position: "relative", width: "auto", minWidth: 0, maxWidth: "88%", flexShrink: 1, alignSelf: "flex-start", paddingHorizontal: 10, paddingTop: 7, paddingBottom: 8, backgroundColor: colors.surface, borderRadius: radii.selected, gap: 5 },
  codexBubbleWide: { width: "88%", flexShrink: 0 },
  agentMessage: { paddingHorizontal: 2, paddingVertical: 3 },
  agentMarkdownDocument: { minWidth: 0, maxWidth: "100%", alignSelf: "flex-start", gap: 5 },
  waveTextShell: { minWidth: 0, maxWidth: "100%", flexShrink: 1, alignSelf: "flex-start", overflow: "hidden" },
  waveTextRest: { opacity: 0.58 },
  waveTextMask: { color: "#000000" },
  waveTextBand: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    experimental_backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 24%, rgba(255,255,255,0.72) 42%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.72) 58%, rgba(255,255,255,0.08) 76%, rgba(255,255,255,0) 100%)",
  },
  agentPlaceholder: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  turnActivity: { maxWidth: "100%", alignSelf: "flex-start", marginTop: 1 },
  turnActivityExpanded: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  turnActivityToggle: { minHeight: 25, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 2 },
  activityIconSlot: { width: 15, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  activityChevronSlot: { width: 14, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  turnActivityLabel: { minWidth: 0, flexShrink: 1, color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  turnActivityLabelWave: { minWidth: 0, flexShrink: 1, alignSelf: "center" },
  turnActivityList: { width: "100%", minWidth: 0, maxWidth: "100%", gap: 5, paddingTop: 2, paddingLeft: 18, paddingRight: 1, paddingBottom: 2 },
  activityMoreButton: { minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  activityMoreText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  copyButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  copyButtonCompact: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  agentText: { minWidth: 0, maxWidth: "100%", color: colors.text, fontSize: 13, lineHeight: 18 },
  liveAgentResponse: { minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  liveMarkdownResponse: { gap: 5 },
  // Keep the collapsed header outside Android's clipped child layer. Fabric
  // could retain the measured card while dropping its painted header after an
  // animated running body was removed, producing a correctly-sized blank row.
  card: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", backgroundColor: colors.surfaceContainerLow, borderRadius: 14, padding: 8, gap: 5 },
  cardContent: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", gap: 5 },
  cardHeader: { width: "100%", minWidth: 0, minHeight: 28, flexDirection: "row", alignItems: "center", gap: 4, opacity: 1 },
  cardHeaderToggle: { flex: 1, minWidth: 0, minHeight: 28, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 5, opacity: 1 },
  cardIconSlot: { width: 16, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  cardTitle: { minWidth: 0, flexShrink: 1, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  cardTitleWave: { alignSelf: "center", justifyContent: "center" },
  cardStatusIcon: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  cardStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  agentNavigationRow: { width: "100%", minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surfaceContainerLow },
  agentNavigationList: { width: "100%", minWidth: 0, gap: 5, paddingVertical: 2 },
  agentNavigationIdentity: { flex: 1, minWidth: 0 },
  agentNavigationTitleWave: { alignSelf: "flex-start", justifyContent: "center" },
  agentNavigationSubtitle: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  tokenStrip: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, backgroundColor: colors.surfaceContainerLow },
  tokenStripTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  tokenMetrics: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  tokenMetric: { flexDirection: "row", alignItems: "center", gap: 3 },
  tokenMetricValue: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  planStep: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 1 },
  planText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, lineHeight: 16 },
  reasoningCard: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceRaised, borderRadius: 14, paddingHorizontal: 10 },
  reasoningText: { flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  thinkingStatusSection: { minWidth: 0 },
  thinkingStatus: { minWidth: 0, minHeight: 25, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 2 },
  thinkingStatusInActivity: { paddingLeft: 8 },
  monospaceStrong: { color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 11, fontWeight: "700", marginBottom: 2 },
  toolRow: { minHeight: 18, flexDirection: "row", alignItems: "center", gap: 7 },
  toolLabel: { color: colors.textMuted, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 10, width: 42 },
  toolValue: { flex: 1, color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 10 },
  codeBlock: { backgroundColor: colors.code, borderRadius: radii.small, padding: 7, gap: 2 },
  codeLine: { minWidth: 0, maxWidth: "100%", color: "#B8B8B8", fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 11, lineHeight: 15 },
  commandLine: { color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 11, marginBottom: 3 },
  diffAdd: { color: colors.green },
  diffRemove: { color: colors.red },
  diffFile: { width: "100%", minWidth: 0, maxWidth: "100%", overflow: "hidden", borderRadius: radii.small, backgroundColor: colors.code },
  diffFileHeader: { width: "100%", minWidth: 0, minHeight: 30, paddingHorizontal: 6, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface },
  diffFilePath: { minWidth: 0, flex: 1, flexShrink: 1, color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 10, lineHeight: 14 },
  diffKind: { flexShrink: 0, color: colors.textMuted, fontSize: 9, lineHeight: 13, textTransform: "uppercase" },
  diffStat: { minWidth: 18, flexShrink: 0, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"], textAlign: "right" },
  diffStatAdd: { color: colors.green },
  diffStatDelete: { color: colors.red },
  diffLines: { width: "100%", minWidth: 0, paddingVertical: 4 },
  searchResult: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  compactToolCard: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceContainerLow, borderRadius: 14, paddingHorizontal: 8 },
  compactToolTitle: { color: colors.text, fontWeight: "600", fontSize: 11 },
  compactToolText: { color: colors.textMuted, fontSize: 10, marginTop: 1 },
  resultCount: { color: colors.textDim, fontSize: 9 },
  unknownCard: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceContainerLow, borderRadius: 14, paddingHorizontal: 8 },
  unknownText: { flex: 1, color: colors.textMuted, fontSize: 11 },
  unknownFixButton: { minHeight: 32, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12, backgroundColor: colors.primary },
  unknownFixText: { color: colors.onPrimary, fontSize: 10, fontWeight: "800" },
  rawLink: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  protocolBody: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", gap: 4 },
  toolMarkdownResult: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  protocolBodyActions: { minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  largeContentControl: { width: "100%", minWidth: 0, gap: 6, paddingTop: 5 },
  largeContentActions: { width: "100%", minWidth: 0, gap: 4 },
  largeContentButton: { minHeight: 34, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.surfaceRaised },
  largeContentButtonText: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  largeContentPager: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
  largeContentPageButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.surfaceRaised },
  fullContentViewer: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  fullContentHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  fullContentHeaderIcon: { width: 30, height: 30, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  fullContentHeaderText: { flex: 1, minWidth: 0 },
  fullContentTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: "700" },
  fullContentMeta: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"] },
  fullContentViewport: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.code, overflow: "hidden" },
  fullContentCentered: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: spacing.xs, padding: spacing.md },
  fullContentMarkdown: { padding: spacing.md, paddingBottom: spacing.xl },
  fullContentRawHorizontal: { flexGrow: 0, padding: spacing.sm },
  fullContentRawText: { color: "#D3D7DE", fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 11, lineHeight: 16 },
  fullContentFooter: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  fullContentFooterText: { flex: 1, color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  turnMeta: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 5, paddingVertical: 2 },
  turnMetaText: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  jumpToLatest: { position: "absolute", right: spacing.md, zIndex: 20, width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryContainer, elevation: 3 },
  jumpToLatestBadge: { position: "absolute", top: -3, right: -3, minWidth: 20, minHeight: 20, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  jumpToLatestBadgeText: { color: colors.onPrimary, fontSize: 10, lineHeight: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  composerSticky: { flexShrink: 0, minWidth: 0, alignSelf: "stretch", zIndex: 30 },
  composerDock: { flexShrink: 0, minWidth: 0, alignSelf: "stretch", backgroundColor: colors.surface, zIndex: 30, elevation: 4 },
  composerContextStrip: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.surface },
  composerContextContent: { alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, paddingTop: 2, paddingBottom: spacing.xs },
  composerContextChip: { flexGrow: 0, flexShrink: 0, alignSelf: "flex-start", minHeight: 24, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, backgroundColor: colors.surfaceContainer },
  composerContextText: { flexGrow: 0, flexShrink: 0, color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "600" },
  composerContextValue: { alignSelf: "center", justifyContent: "center" },
  composerContextWave: { flexGrow: 0, flexShrink: 0 },
  threadResourceRoute: { flex: 1, width: "100%", minHeight: 0 },
  threadResourceRouteHidden: { display: "none" },
  threadResourcesContent: { paddingBottom: spacing.md, gap: 2 },
  threadResourceDocumentContent: { width: "100%", minWidth: 0, alignSelf: "stretch", paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  threadResourceWebView: { flex: 1, minHeight: 0, width: "100%", backgroundColor: colors.background },
  threadResourcePreviewCenter: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  primaryAction: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: 21, backgroundColor: colors.primary },
  primaryActionText: { color: colors.onPrimary, fontWeight: "700" },
  threadResourceRow: { minHeight: 54, paddingHorizontal: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.medium },
  threadResourceIcon: { width: 34, height: 34, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.surfaceRaised },
  threadResourceText: { flex: 1, minWidth: 0 },
  threadResourceTitle: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  threadResourceSubtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 1 },
  threadResourceMeta: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 1 },
  threadResourceStat: { fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"] },
  threadResourceDeleted: { color: colors.red, fontSize: 10, lineHeight: 14 },
  threadResourceUnavailable: { color: colors.amber, fontSize: 10, lineHeight: 14 },
  threadResourcesEmpty: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 4 },
  inlineQueueTray: { marginHorizontal: spacing.xs, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 7, gap: 2, borderTopLeftRadius: radii.medium, borderTopRightRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  inlineQueueHeader: { minHeight: 22, flexDirection: "row", alignItems: "center", gap: 5 },
  inlineQueueTitle: { flex: 1, color: colors.text, fontSize: 11, fontWeight: "700" },
  inlineQueueText: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  composerAttachments: { flexGrow: 0, backgroundColor: colors.surface },
  composerAttachmentsContent: { gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  composerAttachmentChip: { minHeight: 34, maxWidth: 280, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, borderRadius: radii.small, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  composerAccessoryTray: { minHeight: 60, marginHorizontal: spacing.xs, marginTop: 4, paddingHorizontal: 4, paddingVertical: 4, flexDirection: "row", alignItems: "stretch", gap: 2, borderRadius: 20, backgroundColor: colors.surfaceContainerLow },
  composerAccessoryAction: { minWidth: 0, minHeight: 52, flex: 1, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 16 },
  composerAccessoryLabel: { maxWidth: "100%", color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: "600", textAlign: "center" },
  composer: { minWidth: 0, flexShrink: 1, minHeight: touchTarget + 12, paddingHorizontal: spacing.xs, paddingVertical: 6, flexDirection: "row", alignSelf: "stretch", alignItems: "flex-end", gap: spacing.xs, overflow: "hidden", backgroundColor: colors.surface },
  composerError: { color: colors.red, backgroundColor: colors.surface, paddingHorizontal: 14, paddingTop: 7, fontSize: 12 },
  composerMenu: { width: touchTarget, height: touchTarget, flexShrink: 0, borderRadius: radii.composer, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainer },
  composerMenuActive: { backgroundColor: colors.primaryContainer },
  composerMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  composerMenuText: { color: colors.text, ...typeScale.labelLarge },
  composerInputShell: { flex: 1, flexBasis: 0, flexShrink: 1, width: 0, minWidth: 0, minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT, flexDirection: "row", alignItems: "flex-end", overflow: "hidden", backgroundColor: colors.surfaceContainer, borderRadius: radii.composer },
  composerInput: { flex: 1, flexBasis: 0, flexShrink: 1, width: 0, minWidth: 0, alignSelf: "stretch", minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT, color: colors.text, paddingLeft: spacing.sm, paddingRight: spacing.xxs, paddingTop: 12, paddingBottom: 10, fontSize: 15, lineHeight: COMPOSER_LINE_HEIGHT },
  voiceCapture: { flex: 1, minHeight: touchTarget, paddingLeft: spacing.sm, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 10 },
  voiceMeter: { height: 26, flexDirection: "row", alignItems: "center", gap: 3 },
  voiceMeterBar: { width: 3, minHeight: 4, maxHeight: 24, borderRadius: 2, backgroundColor: colors.accent },
  voiceCaptureLabel: { color: colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },
  composerIcon: { width: touchTarget, height: touchTarget, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  sendButton: { width: touchTarget, height: touchTarget, flexShrink: 0, borderRadius: radii.composer, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  composerSendMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  sendButtonPressed: { backgroundColor: colors.primaryPressed },
  stopButton: { backgroundColor: colors.red },
  sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.titleLarge },
  sheetPage: { width: "100%", minHeight: 0 },
  expandedSheetPage: { flex: 1 },
  menuTitleRow: { minHeight: touchTarget, marginBottom: spacing.xs, flexDirection: "row", alignItems: "center", gap: 6 },
  sheetHeaderIconSlot: { width: 28, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  queueRow: { marginTop: 8, padding: 8, gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium },
  queueCompactRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 4 },
  queueDragHandle: { width: 34, height: touchTarget, alignItems: "center", justifyContent: "center" },
  queueBody: { flex: 1, minWidth: 0, paddingVertical: 4 },
  queueText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  queueMetaRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  queueTime: { color: colors.textDim, fontSize: 11 },
  queueActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  queueEditorInput: { minHeight: 104, maxHeight: 220 },
  queueAttachmentList: { gap: 6, paddingVertical: 2 },
  queueAttachmentName: { maxWidth: 180, color: colors.text, fontSize: 13 },
  queueTextButton: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  queueTextButtonLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  queueSteerButton: { height: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 17, backgroundColor: colors.accent },
  queueSteerLabel: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },
  optimisticAttachments: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  menuNotice: { color: colors.textMuted, fontSize: 13, paddingVertical: 8 },
  menuScroll: { flex: 1, minHeight: 0 },
  menuScrollContent: { paddingBottom: spacing.sm },
  menuAction: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  menuActionIcon: { width: 40, height: 40, borderRadius: radii.medium, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  menuActionText: { flex: 1, minWidth: 0 },
  menuActionTitle: { color: colors.text, ...typeScale.titleMedium },
  menuActionSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  controlSectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", paddingTop: 18, paddingBottom: 7 },
  controlOption: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.selected },
  controlOptionText: { flex: 1, minWidth: 0 },
  controlOptionSelected: { backgroundColor: colors.primaryContainer },
  controlOptionAttention: { backgroundColor: colors.warningContainer },
  runtimeSelector: { flexShrink: 0, marginBottom: spacing.xs },
  disabled: { opacity: 0.42 },
  previewRoot: { flex: 1, backgroundColor: colors.background },
  previewEmbeddedRoot: { width: "100%", minHeight: 0, borderRadius: radii.medium, overflow: "hidden" },
  previewHeader: { minHeight: 64, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  previewIdentity: { flex: 1, minWidth: 0 },
  previewSetup: { width: "100%", maxWidth: 520, alignSelf: "center", padding: 24, gap: 10 },
  previewWebView: { flex: 1, backgroundColor: colors.background },
  previewError: { color: colors.red, backgroundColor: colors.errorContainer, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 12 },
  previewLoading: { position: "absolute", inset: 0 },
  tunnelTtlChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tunnelTtlChip: { minHeight: 32, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.surfaceContainer },
  tunnelTtlChipSelected: { backgroundColor: colors.primaryContainer },
  livePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.successContainer },
  livePillText: { color: colors.green, fontSize: 11, fontWeight: "700" },
  approvalCard: { marginHorizontal: spacing.xs, marginTop: 3, padding: 8, gap: 4, borderRadius: 14, backgroundColor: colors.warningContainer },
  approvalInline: { marginHorizontal: 0, marginTop: 2, backgroundColor: colors.warningContainer },
  approvalTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  approvalTitle: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: "700", flex: 1 },
  approvalPending: { color: colors.amber, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  approvalQueueCount: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  approvalReason: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  approvalCommand: { color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), backgroundColor: colors.code, borderRadius: 8, padding: 6, fontSize: 11, lineHeight: 16 },
  approvalCwd: { color: colors.textDim, fontSize: 11, lineHeight: 15 },
  approvalQuestion: { gap: 4 },
  approvalInput: { minHeight: 38, color: colors.text, backgroundColor: colors.surface, borderRadius: radii.small, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, fontSize: 12 },
  answerOptions: { gap: 5 },
  approvalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" },
  approvalButton: { minHeight: 40, paddingHorizontal: 12 },
  approvalDeclineButton: { minHeight: 40, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: radii.medium },
  approvalDeclineText: { color: colors.textMuted, fontWeight: "600" },
  modeSelector: { width: "100%", minHeight: touchTarget },
  overwriteRow: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  overwriteLabel: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.titleMedium },
  transferProgress: { minHeight: 34, overflow: "hidden", justifyContent: "center", paddingVertical: 4, borderRadius: radii.small, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  transferProgressFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.accentMuted },
  transferProgressText: { color: colors.text, fontSize: 11, paddingHorizontal: 9 },
  successText: { color: colors.green, fontSize: 12 },
  dangerButton: { minHeight: touchTarget, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, backgroundColor: colors.error },
  connectionSheetScroll: { width: "100%" },
  connectionSheetContent: { gap: 8 },
  pairingHeader: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  pairingHeaderTitle: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.titleLarge, textAlign: "center" },
  pairingBack: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  pairingBody: { gap: 14, paddingBottom: 2 },
  pairingHeroIcon: { width: 54, height: 54, alignSelf: "center", alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.primaryContainer },
  pairingLead: { color: colors.text, ...typeScale.titleLarge, textAlign: "center", paddingHorizontal: 12 },
  pairingHint: { color: colors.textMuted, ...typeScale.bodyMedium, textAlign: "center", paddingHorizontal: 8 },
  pairingCode: { color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }) },
  pairingActionStack: { gap: 8, marginTop: 2 },
  pairingPrimaryAction: { minHeight: touchTarget, borderRadius: radii.pill, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: spacing.md },
  pairingPrimaryText: { color: colors.onPrimary, fontSize: 14, fontWeight: "800" },
  pairingSecondaryAction: { minHeight: touchTarget, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: spacing.md },
  pairingSecondaryText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  pairingTextAction: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  pairingTextActionLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  pairingSafety: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 4 },
  pairingSafetyText: { color: colors.textDim, fontSize: 11, lineHeight: 15, flexShrink: 1 },
  pairingError: { flexDirection: "row", alignItems: "center", gap: 7, padding: 10, borderRadius: radii.medium, backgroundColor: colors.errorContainer },
  pairingReviewCard: { gap: 10, padding: 12, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow },
  pairingIdentityRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pairingIdentityFields: { flexDirection: "row", alignItems: "center", gap: 8 },
  pairingEmojiInput: { width: 52, minHeight: touchTarget, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: radii.medium, paddingHorizontal: 8, fontSize: 20, textAlign: "center" },
  pairingNameInput: { flex: 1, minHeight: touchTarget, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: radii.medium, paddingHorizontal: 12, ...typeScale.titleMedium },
  pairingServerMeta: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 7 },
  pairingEndpoint: { color: colors.textMuted, fontSize: 12, flex: 1 },
  pairingMetaText: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 12 },
  pairingSuccess: { alignItems: "center", gap: 12, paddingVertical: 28 },
  pairingSuccessIcon: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  pairingSuccessTitle: { color: colors.text, ...typeScale.titleLarge, textAlign: "center" },
  goalDialogContent: { gap: spacing.md },
  goalDialogIntro: { gap: spacing.xxs, paddingRight: spacing.xl },
  goalObjectiveInput: { minHeight: 112, color: colors.text, backgroundColor: colors.surfaceContainerLow, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.outline, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, textAlignVertical: "top", ...typeScale.bodyLarge },
  goalClearPrompt: { color: colors.red, fontSize: 12, lineHeight: 16 },
  goalDialogActions: { minHeight: 42, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xxs },
  fieldLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  fieldInput: { minHeight: touchTarget, color: colors.text, backgroundColor: colors.surfaceContainerLow, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.outline, paddingHorizontal: spacing.md, ...typeScale.bodyLarge },
  errorText: { color: colors.red, fontSize: 13 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 },
  secondaryButton: { minHeight: touchTarget, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, borderWidth: 1, borderColor: colors.outline },
  secondaryButtonText: { color: colors.text, fontWeight: "600" },
  primaryButton: { minHeight: touchTarget, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, backgroundColor: colors.primary },
  primaryButtonText: { color: colors.onPrimary, fontWeight: "800" },
  connectionEditor: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  connectionEditorForm: { paddingVertical: 12, gap: 7 },
  connectionIdentityFields: { flexDirection: "row", alignItems: "center", gap: 8 },
  connectionRow: { minHeight: 72, paddingVertical: spacing.xs, gap: spacing.xxs },
  connectionSummary: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  connectionActions: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xxs },
  connectionMiniButton: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.medium },
  connectionActionMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  connectionEmojiInput: { width: 52, minHeight: 46, color: colors.text, backgroundColor: colors.surface, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, fontSize: 20 },
  connectionStateRow: { minHeight: 18, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  connectionStateIcon: { width: 12, height: 12, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  connectionStateDot: { width: 7, height: 7, borderRadius: 4 },
  connectionStateText: { minWidth: 0, flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: "600" },
  connectionPinned: { color: colors.green, fontSize: 10, fontWeight: "700", marginLeft: 3 },
  connectionDiagnostic: { gap: 7, marginLeft: 48, padding: 10, borderRadius: radii.medium, backgroundColor: colors.errorContainer },
  connectionDiagnosticHeader: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  connectionDiagnosticSummary: { flex: 1, color: colors.onErrorContainer, fontSize: 12, lineHeight: 17 },
  connectionDiagnosticMeta: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 24 },
  connectionDiagnosticTime: { color: colors.textMuted, fontSize: 10 },
  connectionDiagnosticRaw: { color: colors.onErrorContainer, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 11, lineHeight: 16, paddingLeft: 24 },
  accountPoolEditor: { gap: 0, marginTop: spacing.xs, padding: spacing.sm, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow },
  accountPoolHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  accountPoolRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  accountPoolDivider: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  accountPoolTitleRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  accountPoolName: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.titleMedium },
  accountPoolRole: { flexShrink: 0, color: colors.textDim, fontSize: 9, lineHeight: 13, fontWeight: "800", letterSpacing: 0.5 },
  accountPoolRoleActive: { color: colors.green },
  accountPoolLimit: { flexShrink: 0, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  accountPoolLimitPending: { color: colors.textDim, fontWeight: "600" },
  accountPoolMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  accountPoolAddButton: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs },
  accountLoginSheet: { gap: spacing.md, paddingBottom: spacing.xs },
  accountLoginHeader: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  accountLoginIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radii.large, backgroundColor: colors.primaryContainer },
  accountLoginTitle: { color: colors.text, ...typeScale.titleLarge },
  accountLoginSubtitle: { color: colors.textMuted, ...typeScale.bodyMedium, marginTop: 2 },
  accountLoginCodeCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow },
  accountLoginCodeLabel: { color: colors.textMuted, ...typeScale.labelMedium },
  accountLoginCode: { color: colors.text, fontFamily: Platform.select({ android: "monospace", default: "Courier" }), fontSize: 24, lineHeight: 32, fontWeight: "800", letterSpacing: 1.5 },
  accountLoginCopyButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xxs, paddingHorizontal: spacing.sm, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.outline },
  accountLoginCopyButtonDone: { borderColor: colors.green, backgroundColor: colors.successContainer },
  accountLoginCopyLabel: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  accountLoginCopyLabelDone: { color: colors.green },
  accountLoginHint: { color: colors.textMuted, ...typeScale.bodyMedium },
  accountLoginPrimaryButton: { flexDirection: "row", gap: spacing.xs },
  scannerRoot: { flex: 1, backgroundColor: colors.background },
  scannerHeader: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  scannerCamera: { flex: 1, alignItems: "center", justifyContent: "center" },
  scannerFrame: { width: 260, height: 260, borderWidth: 3, borderColor: colors.accent, borderRadius: 24, backgroundColor: "transparent" },
  scannerError: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.xl, padding: spacing.sm, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerHigh },
});
