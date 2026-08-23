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
import { latestProjectedThreadExecutionSettings, MAX_TURN_ATTACHMENTS, MAX_TURN_TEXT_CHARS, projectedThreadExecutionSettings, projectedTurnMetadata, type OutputFootprintProjection, type TurnUsageProjection } from "@codewide/sync-client";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Gesture, GestureDetector, Pressable as GesturePressable } from "react-native-gesture-handler";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { KeyboardController, KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { createContext, memo, Suspense, type ReactNode, useContext, useDeferredValue, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  ActivityIndicator,
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
import { THREAD_RESIDENT_TURN_LIMIT, type ResidentRangeDirection, type ThreadHistoryState } from "./data/thread-pagination";
import { COMPLETE_STATIC_THREAD_HISTORY, useThreadHistoryController, type ThreadHistoryViewport } from "./data/use-thread-history-controller";
import { useThreadChatWindow } from "./data/use-thread-chat-window";
import { useThreadUiState } from "./data/use-thread-ui-state";
import { useThreadResources } from "./data/use-thread-resources";
import type { ThreadResourcesModel } from "./data/thread-resources-model";
import { useRemoteProjectCatalog } from "./data/use-remote-project-catalog";
import { useDeepLinkListener } from "./data/use-deep-link-listener";
import { useSecondClock } from "./data/second-clock";
import type { ThreadChatWindowRequest } from "./data/thread-chat-model";
import { projectThreadChatWindow } from "./data/thread-chat-projection";
import { mergeThreadLoadStatuses, threadLoadBlocksPresentation } from "./data/thread-load-status";
import { mergeProjectedThreadPartitions } from "./data/thread-partitions";
import { plainThreadPreview } from "./data/thread-cache";
import type { ThreadDetailDatabase } from "./data/thread-detail-database";
import type { ThreadSummaryDatabase } from "./data/thread-summary-database";
import { useThreadSummaryView } from "./data/use-thread-summary-view";
import { subagentActivityTargetThreadId, subagentDisplayName, subagentsForThread } from "./data/subagent-projection";
import { projectLabel, threadContextLabel } from "./data/thread-projects";
import type { RemoteDirectoryEntry, RemoteProject } from "./data/remote-projects";
import type { DraftSelection } from "./data/voice-draft";
import { isProfileOnlyConnectionUpdate, validateConnectionProfile, validateConnectionUpdateInput, type ConnectionInput, type ConnectionUpdateInput } from "./data/connection-validation";
import { resolveComposerSendMode, type ComposerSendPreference } from "./data/composer-delivery-mode";
import { useComposerLatestValues } from "./data/use-composer-latest-values";
import { mergeFailedComposerAttachments, mergeFailedComposerText, rollbackOwnedModelSelection } from "./data/composer-mutation-recovery";
import { validateGoalEditorDraft } from "./data/goal-editor";
import { currentThreadContextUsage, selectWeeklyRateLimit, type AccountRateLimitsRow } from "./data/account-rate-limits";
import { accountProfileLabel, type AccountPoolSnapshot } from "./data/account-pool";
import { formatDeviceTime } from "./data/device-time";
import { isSafeHttpUrl, mcpElicitationFields, parseElicitationValue } from "./data/elicitation-form";
import { parseThreadDeepLink } from "./data/deep-link";
import { AUTO_ATTACH_PASTE_MIN_CHARS, captureClipboardLargePaste, type ClipboardLargePasteCapture } from "./data/composer-paste-attachment";
import type { LargePasteEvent } from "./native/large-paste";
import { useEvent } from "./react/useEvent";
import { incrementDiagnosticMetric, liveStreamMetricKey, operationalDiagnosticsEnabled, recordLiveRenderCommit, recordTiming } from "./data/operational-metrics";
import { activeThreadNavigationIdFor, beginThreadNavigation, finalizeThreadNavigationProfile, isThreadNavigationActiveFor, markThreadNavigationStage, measureThreadNavigationWork, recordThreadNavigationRowCommit, recordThreadNavigationVisualEvent } from "./data/thread-navigation-metrics";
import { usePerformanceExperiment, usePerformanceExperiments } from "./data/performance-experiments";
import { beginNavigationFrameTrace, endNavigationFrameTrace } from "./native/performance-metrics";
import { humanPairingError } from "./data/pairing-error";
import { resolveNewThreadRoute } from "./data/new-thread-routing";
import type { NewChatWorkspaceMode, WorkspaceSupport } from "./data/workspace-creation";
import {
  createNativePortForwardId,
  nativePortForwardingStore,
  useNativePortForwarding,
  type NativePortForwardingSnapshot,
} from "./data/native-port-forwarding-store";
import {
  closeInteractiveTerminalWorkspace,
  createInteractiveTerminalTab,
  readInteractiveTerminalWorkspace,
  useInteractiveTerminalWorkspace,
} from "./data/interactive-terminal-store";
import { effectiveTurnLifecycleStatus, isThreadLifecycleActive } from "./data/thread-lifecycle";
import type { StoredConnection } from "./data/connection-profile-types";
import type { PendingServerRequest } from "./data/pending-request-types";
import type { StoredThreadSummary } from "./data/thread-summary-types";
import { ThreadListProjection } from "./data/thread-list-projection";
import { SubagentListProjection } from "./data/subagent-projection";
import type { StoredComposerPreferences, ThreadUiStateRow } from "./data/thread-ui-state-types";
import { threadHistoryResourceKey, threadResourceKey, tunnelResourceKey, turnControlsResourceKey, type BackgroundTerminalsRow, type FileTransferRow, type ThreadAttachmentResource, type ThreadChangeResource, type ThreadChangeScope, type ThreadGoalRow, type ThreadResourcesRow, type ThreadResourcesValue, type TunnelRow, type TurnControlsRow, type VoiceInputRow, type WorkspaceResourceDatabase } from "./data/workspace-resource-database";
import { useBackgroundTerminalsRow, useThreadGoalRow, useTunnelRow, useTurnControlsRow } from "./data/use-workspace-resource-row";
import type { VoiceInputController } from "./data/voice-input-controller";
import type { FileTransferController } from "./data/file-transfer-controller";
import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "./data/attachment-upload";
import { type NativeCommandDelivery } from "./native/native-transport";
import { windowLayoutStore } from "./native/window-layout-store";
import { createTextUpload, pickUploadFile, type SelectedUpload } from "./native/file-transfer";
import { RichMarkdown } from "./rendering/RichMarkdown";
import { RichContentWidthProvider } from "./rendering/RichContentLayout";
import { ImagePreviewGroup, useImagePreview, useImagePreviewAnnotationHandler, useImagePreviewGroup, useRegisterImagePreviewItem } from "./rendering/ImagePreviewHost";
import { loadDocumentPreview, MAX_DOCUMENT_PREVIEW_BYTES, useDocumentDownload, useDocumentPreview, type DocumentPreviewRequest, type DocumentPreviewResult } from "./rendering/DocumentPreviewHost";
import { isolatedHtmlDocument, remoteDocumentDirectory, remoteFileKind, resolvePreviewableDocumentLink, resolveRemoteDocumentPath, type DocumentPreviewKind } from "./rendering/document-preview";
import { MarkdownLocalLinkProvider } from "./rendering/MarkdownLinkHandler";
import { forwardedLoopbackUrl, parseLoopbackLink, type LoopbackLinkTarget } from "./rendering/loopback-link";
import { NativeCodeBlock } from "./rendering/NativeCodeBlock";
import { CodeReviewWorkspace } from "./rendering/CodeReviewWorkspace";
import { changeScopeMenuActions, changeScopeTitle } from "./rendering/change-menu";
import { codeReviewFilesForDocument } from "./rendering/code-review-files";
import { serializeCodeReviewAttachment, type CodeReviewComment } from "./rendering/code-review";
import { ContentReviewComposer, useContentReviewRuntime } from "./rendering/ContentReviewHost";
import type { ContentReviewTarget } from "./rendering/content-review";
import { collapsedCodePreview, nativeCodeLanguageForPath, stripTerminalControlSequences } from "./rendering/native-code-block";
import { boundedJsonStringify } from "./rendering/bounded-json";
import { useAsyncResource, useEphemeralAsyncResource } from "./rendering/async-resource-store";
import { changedFileDisplayPath } from "./rendering/changed-file-path";
import { projectFileChange } from "./rendering/file-change-rendering";
import { privateImageAssetProjection, safeImageUri } from "./rendering/image-source";
import { privateAssetCacheKey, readPrivateAssetText, type GetTransferAccess, type PrivateAssetSource, type PrivateAssetTextResult } from "./data/private-transfer";
import { projectCachedLiveMarkdown, projectCachedLiveText, type LiveMarkdownProjection } from "./rendering/live-text-stream";
import { mergeChronologicalTimeline, protocolTimestampMs } from "./rendering/optimistic-timeline";
import { reasoningActivityTitle } from "./rendering/reasoning-title";
import { richMarkdownLayout } from "./rendering/rich-markdown-layout";
import { selectLiveTurnPlan } from "./rendering/live-turn-plan";
import { isAgentMessageStillStreaming, selectTurnRenderWindow } from "./rendering/thread-render-window";
import { ThreadTimelineList, type ThreadTimelineListRef, type TimelineInitialPosition } from "./rendering/ThreadTimelineList";
import { useTimelineOverlayScrollGuard } from "./rendering/use-timeline-overlay-scroll-guard";
import { optimisticTimelineKey, remoteTurnTimelineKey } from "./rendering/timeline-identity";
import { activeTurnSequence, type TurnSequencePart } from "./rendering/turn-sequence";
import { Bubble, BubbleContent } from "./rendering/Bubble";
import { claimUnreadReceipt, shouldMarkAgentResponseRead } from "./rendering/unread-visibility";
import { normalizeUserMessage } from "./rendering/user-message-normalizer";
import { projectUserMessageAttachments, type UserMessageAttachment } from "./rendering/user-message-attachments";
import { composerAttachmentPreviewKind, composerAttachmentSource } from "./rendering/composer-attachment-preview";
import { activityOutputFootprint, commandActivityInput, commandActivityTitle, commandOutputFootprint, estimatedOutputInputCostUsd } from "./rendering/command-activity";
import { PrivateAssetRecoveryProvider, PrivateImageAccessProvider, usePrivateAssetUri, usePrivateFileAccessScope, usePrivateImageUri } from "./rendering/use-private-image-uri";
import { useReducedMotionPreference } from "./rendering/reduced-motion-store";
import { AppSheet, AppSheetScrollView } from "./ui/AppSheet";
import { AppFullscreenOverlayBoundary, useAppFullscreenOverlay, type AppFullscreenOverlayLifecycle } from "./ui/AppFullscreenOverlay";
import { ActionMenu, type ActionMenuItem } from "./ui/ActionMenu";
import { useAppDialog } from "./ui/AppDialog";
import { ModelThinkingMenu, PermissionsMenu } from "./ui/TurnControlMenus";
import { AppText as Text, AppTextInput as TextInput } from "./ui/Typography";
import { AppVoiceInputProvider, useAppVoiceInputRuntime, useVoiceInputLevel, type AppVoiceInputRuntime } from "./ui/VoiceInputRuntime";
import { VoiceAura } from "./ui/VoiceAura";
import { WaveText } from "./ui/WaveText";
import { ContextRing, UsagePopover } from "./ui/UsagePopover";
import { CostBreakdownPopover } from "./ui/CostBreakdownPopover";
import { LiveTurnPlanPopover } from "./ui/LiveTurnPlanPopover";
import { TOKEN_SYMBOL } from "./ui/token-display";
import { formatEstimatedTurnCost } from "./turn-cost";
import { AnimatedNumber, compactNumberFormat, integerNumberFormat } from "./ui/AnimatedNumber";
import { formatNumber } from "./ui/number-format";
import { PerformanceDiagnostics } from "./ui/PerformanceDiagnostics";
import { RecoverableRenderBoundary, RenderRecoveryProvider } from "./ui/RecoverableRenderBoundary";
import { renderRecoveryPrompt, type RecoverableRenderFailure } from "./ui/render-recovery-prompt";
import { SubagentSheet } from "./ui/SubagentSheet";
import { PortForwardingManager, type PortForwardingManagerProps } from "./ui/PortForwardingManager";
import { ProjectPickerSheet } from "./ui/ProjectPickerSheet";
import { TerminalWorkspace } from "./ui/TerminalWorkspace";
import { InternalBrowser } from "./ui/InternalBrowser";
import { useAndroidBackHandler } from "./ui/use-android-back-handler";
import { useUnmount } from "./ui/use-unmount";
import { CommitOnChangeProbe, EveryCommitProbe } from "./ui/CommitProbe";
import { useConversationOwner } from "./ui/use-conversation-owner";

const ALL_SERVERS_ID = "__all_servers__";
const THREAD_LIST_PAGE_SIZE = 40;
const SUBAGENT_LIST_LIMIT = 200;

type ServerStatus = "live" | "syncing" | "offline" | "connecting" | "degraded" | "authRequired";

type ThreadListServer = {
  id: string;
  name: string;
  emoji: string;
  status: ServerStatus;
  endpoint?: string;
  token?: string;
  tlsPinSha256?: string;
};

type ThreadListItem = {
  id: string;
  serverId: string;
  title: string;
  preview: string;
  time?: string;
  timestamp?: number;
  pinned: boolean;
  archived?: boolean;
  unread: number;
  state?: "running" | "approval" | "failed";
};

type NewChatDraft = {
  id: string;
  serverId: string;
  cwd: string | null;
  workspaceMode: NewChatWorkspaceMode;
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
const EMPTY_COMPOSER_ATTACHMENTS: ComposerAttachment[] = [];
const LATEST_TIMELINE_THRESHOLD_PX = 2;
const sessionConversationScrollOffsets = new Map<string, number>();
const sessionConversationHistoryAnchors = new Map<string, { turnId: string; viewportOffsetPx: number | null }>();
const ForceExpandCardsContext = createContext(false);
const ActiveToolCallContext = createContext(false);
const TurnActivityContentContext = createContext(false);
const TurnUsageContext = createContext<TurnUsageProjection | null>(null);
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

type ComposerMenuPage = "model" | "skills" | "permissions" | "queue" | "goal" | "review" | "runtime" | "ports";
type ComposerAccessoryAction = "files" | "skills" | "goal" | "terminal" | "ports";
type ChangesDisplayMode = "unified" | "split" | "source";
type ChangesPreferences = { scope: ThreadChangeScope | null; mode: ChangesDisplayMode; wrapLines: boolean };

const changesPreferencesByThread = new Map<string, ChangesPreferences>();

function readChangesPreferences(key: string): ChangesPreferences {
  return changesPreferencesByThread.get(key) ?? { scope: null, mode: "unified", wrapLines: false };
}

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
        ? null
        : settings?.approvalPolicy === "granular"
          ? "Granular"
          : null;
  if (sandbox !== null && approval !== null) return `${sandbox} · ${approval}`;
  return sandbox ?? approval ?? (pending ? "Loading access…" : "Access unavailable");
}

function permissionProfileLabel(id: string): string {
  if (id === ":workspace") return "Workspace";
  if (id === ":read-only") return "Read only";
  if (id === ":full-access" || id === ":danger-full-access") return "Full access";
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

function ComposerContextCount({
  label,
  value,
  refreshing = false,
  testID,
}: {
  label: string;
  value: number;
  refreshing?: boolean;
  testID?: string;
}) {
  return (
    <View testID={testID} style={styles.composerContextCount}>
      <AnimatedNumber
        value={value}
        format={integerNumberFormat}
        prefix={`${label} · `}
        style={styles.composerContextText}
        containerStyle={[styles.composerContextValue, refreshing && styles.composerContextCountHidden]}
      />
      {refreshing && (
        <WaveText
          text={`${label} · ${formatNumber(value, integerNumberFormat)}`}
          style={styles.composerContextText}
          containerStyle={styles.composerContextRefreshOverlay}
        />
      )}
    </View>
  );
}

function ThreadResourceContextChips({
  model,
  resourceId,
  revision,
  load,
  preferences,
  onPreferencesChange,
  onOpen,
}: {
  model: ThreadResourcesModel | null;
  resourceId: string | null;
  revision: string;
  load(scope?: ThreadChangeScope, kind?: "all" | "changes" | "attachments"): Promise<ThreadResourcesValue>;
  preferences: ChangesPreferences;
  onPreferencesChange(preferences: ChangesPreferences): void;
  onOpen(kind: "changes" | "attachments"): void;
}) {
  const dialog = useAppDialog();
  const resource = useThreadResources(model, resourceId, () => load(), { revision });
  const pending = (kind: "changes" | "attachments") => resource === null
    || (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes(kind));
  const ready = (kind: "changes" | "attachments") => resource?.readyKinds === undefined
    ? resource?.value != null
    : resource.readyKinds.includes(kind);
  const changesPending = pending("changes");
  const attachmentsPending = pending("attachments");
  const changesReady = ready("changes");
  const attachmentsReady = ready("attachments");
  const changesInitialLoading = changesPending && !changesReady;
  const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;
  const changesError = resource?.resourceErrors?.changes
    ?? (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const attachmentsError = resource?.resourceErrors?.attachments
    ?? (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const changeCount = resource?.value?.changes.length ?? 0;
  const attachmentCount = resource?.value?.attachments.length ?? 0;
  const changeScopes = resource?.value?.changeScopes ?? ["session" as const, "lastTurn" as const];
  const changeScope = preferences.scope !== null && changeScopes.includes(preferences.scope)
    ? preferences.scope
    : resource?.value?.changeScope ?? changeScopes[0] ?? "session";
  const changesEmpty = changesReady && changeCount === 0;
  const attachmentsEmpty = attachmentsReady && attachmentCount === 0;
  const changesLabel = changesInitialLoading
    ? "Loading changes…"
    : changesError !== null && !changesReady
      ? "Changes unavailable"
      : changesEmpty ? "No changes" : `Changes · ${changeCount}`;
  const attachmentsLabel = attachmentsInitialLoading
    ? "Loading attachments…"
    : attachmentsError !== null && !attachmentsReady
      ? "Attachments unavailable"
      : attachmentsEmpty ? "No attachments" : `Attachments · ${attachmentCount}`;
  const selectScope = (id: string) => {
    if (!id.startsWith("scope:")) return;
    const scope = id.slice("scope:".length) as ThreadChangeScope;
    if (!changeScopes.includes(scope)) return;
    onPreferencesChange({ ...preferences, scope });
    void load(scope, "changes").catch((cause) => {
      dialog.alert("Changes unavailable", cause instanceof Error ? cause.message : "Could not load changes");
    });
  };
  return (
    <>
      <ActionMenu
        accessibilityLabel="Choose changes scope"
        actions={changeScopeMenuActions(changeScopes, changeScope)}
        trigger="long-press"
        placement="top"
        align="start"
        onSelect={selectScope}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${changesLabel}, ${changeScopeTitle(changeScope)}. Long press to choose changes scope.`}
          onPress={() => onOpen("changes")}
          style={styles.composerContextChip}
        >
          <Ionicons name="git-compare-outline" size={15} color={changesEmpty ? colors.textDim : colors.textMuted} />
          {changesInitialLoading || changesEmpty || changesError !== null && !changesReady
            ? <ComposerContextLabel loading={changesInitialLoading} testID="composer-changes-label" text={changesLabel} />
            : <ComposerContextCount label="Changes" value={changeCount} testID="composer-changes-label" />}
        </Pressable>
      </ActionMenu>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={attachmentsLabel}
        accessibilityState={{ disabled: attachmentsEmpty }}
        disabled={attachmentsEmpty}
        onPress={() => onOpen("attachments")}
        style={[styles.composerContextChip, attachmentsEmpty && styles.disabled]}
      >
        <Ionicons name="attach-outline" size={15} color={attachmentsEmpty ? colors.textDim : colors.textMuted} />
        {attachmentsInitialLoading || attachmentsEmpty || attachmentsError !== null && !attachmentsReady
          ? <ComposerContextLabel loading={attachmentsInitialLoading} testID="composer-attachments-label" text={attachmentsLabel} />
          : <ComposerContextCount label="Attachments" value={attachmentCount} testID="composer-attachments-label" />}
      </Pressable>
    </>
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

const EMPTY_TURN_CONTROLS: TurnControls = {
  models: [],
  skills: [],
  permissions: [],
  defaults: { model: null, effort: null, permissions: null },
};

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
  | { kind: "optimistic"; scope: string; id: string; text: string; attachments: ComposerAttachment[]; status: "sending" | "uncertain" | "failed" | "delivered"; workspaceRequestId?: string | null; lastError: string | null; createdAt: number }
  | { kind: "meta"; key: string; status: "completed" | "interrupted" | "failed" | "inProgress"; durationMs: number | null; completedAt: number | null };

function ThreadTimelineNavigationCommit({
  connectionId,
  threadId,
  modelReady,
  visible,
  itemCount,
  turnCount,
  loadStatus,
  restoreOffset,
  restoreAnchorTurnId,
  children,
}: {
  connectionId: string | null;
  threadId: string | null;
  modelReady: boolean;
  visible: boolean;
  itemCount: number;
  turnCount: number;
  loadStatus: ThreadHistoryViewport["status"];
  restoreOffset: number | null;
  restoreAnchorTurnId: string | null;
  children: ReactNode;
}) {
  const scopeReportedRef = useRef(false);
  const modelReportedRef = useRef(false);
  const visibleReportedRef = useRef(false);
  const navigationIdRef = useRef<string | null>(null);
  const nextFrameRef = useRef<number | null>(null);
  const nextFrameReportedRef = useRef(false);
  const onCommit = () => {
    if (connectionId === null || threadId === null) return;
    const activeNavigationId = activeThreadNavigationIdFor(connectionId, threadId);
    if (activeNavigationId === null) return;
    if (navigationIdRef.current !== activeNavigationId) {
      if (nextFrameRef.current !== null) cancelAnimationFrame(nextFrameRef.current);
      navigationIdRef.current = activeNavigationId;
      scopeReportedRef.current = false;
      modelReportedRef.current = false;
      visibleReportedRef.current = false;
      nextFrameReportedRef.current = false;
      nextFrameRef.current = null;
    }
    const navigationId = activeNavigationId;
    if (!scopeReportedRef.current) {
      scopeReportedRef.current = true;
      markThreadNavigationStage(connectionId, threadId, "scope_commit", {
        values: { restoredOffsetPx: restoreOffset ?? 0 },
        tags: { restore: restoreOffset === null ? "waiting_for_cursor" : restoreAnchorTurnId === null ? "latest" : "semantic_anchor" },
      }, navigationId);
    }
    if (modelReady && !modelReportedRef.current) {
      modelReportedRef.current = true;
      markThreadNavigationStage(connectionId, threadId, "timeline_model_ready", {
        values: { itemCount, turnCount },
        tags: { loadStatus },
      }, navigationId);
    }
    if (visible && !visibleReportedRef.current) {
      visibleReportedRef.current = true;
      markThreadNavigationStage(connectionId, threadId, "visible_commit", {
        values: { itemCount },
        tags: { timeline: itemCount === 0 ? "empty" : "populated" },
      }, navigationId);
    }
    if (!visible || nextFrameReportedRef.current || nextFrameRef.current !== null) return;
    nextFrameRef.current = requestAnimationFrame(() => {
      nextFrameRef.current = null;
      const completed = markThreadNavigationStage(connectionId, threadId, "next_frame", {
        values: { itemCount },
      }, navigationId);
      if (completed !== null) {
        nextFrameReportedRef.current = true;
        void endNavigationFrameTrace(completed.id)
          .then((frames) => finalizeThreadNavigationProfile(completed, frames));
      }
    });
    return () => {
      if (nextFrameRef.current !== null) cancelAnimationFrame(nextFrameRef.current);
      nextFrameRef.current = null;
    };
  };
  return <>{children}<EveryCommitProbe onCommit={onCommit} /></>;
}

type ConversationPaneProps = Parameters<typeof ConversationPane>[0];

type ConversationDestinationBaseProps = Omit<ConversationPaneProps,
  | "remoteThread"
  | "remoteSealedTurns"
  | "remoteLiveTurns"
  | "pendingDeliveries"
  | "queuedPrompts"
  | "composerState"
  | "historyRestoreReady"
  | "historyViewport"
  | "onLoadTurnItems"
> & {
  navigationKey: string;
};

type MainConversationDetailProps = ConversationDestinationBaseProps & {
  remote: RemoteWorkspace;
  connectionId: string;
  threadId: string;
  threadOpenGeneration: number;
  connectionAvailable: boolean;
  threadLifecycleActive: boolean;
};

/**
 * The main-chat destination owns the same single suspending window read as a
 * subagent detail. Nothing selection-specific is read by the workspace above
 * this component's Suspense boundary.
 */
function MainConversationDetail({
  remote,
  connectionId,
  threadId,
  threadOpenGeneration,
  connectionAvailable,
  threadLifecycleActive,
  navigationKey,
  ...conversation
}: MainConversationDetailProps) {
  const uiStateDatabase = remote.threadUiStateDatabase;
  const chatDatabase = remote.threadDetails;
  if (uiStateDatabase === null || chatDatabase === null) {
    throw new Error("Native conversation databases are unavailable");
  }

  const summaryView = useThreadSummaryView(remote.threadSummaryDatabase, {
    // A transition keeps the previous conversation mounted while this
    // destination suspends. Give every destination its own summary owner so
    // the previous passive cleanup cannot evict or reconfigure the resource
    // that just revealed the next conversation.
    viewId: `conversation:${connectionId}:${threadId}`,
    connectionId: null,
    recentLimit: 0,
    archivedLimit: 0,
    selectedConnectionId: connectionId,
    selectedThreadId: threadId,
    subagentConnectionId: null,
    subagentLimit: 0,
  });
  const storedThread = summaryView?.selected[0] ?? null;
  const composerState = useThreadUiState(uiStateDatabase, connectionId, threadId);
  const historyResourceId = threadHistoryResourceKey(connectionId, threadId);
  const historyQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null
      ? undefined
      : query
          .from({ load: remote.resourceDatabase.threadHistories })
          .where(({ load }) => eq(load.id, historyResourceId)),
    [historyResourceId, remote.resourceDatabase],
  );
  const historyResourceRaw = historyQuery.data?.[0] ?? null;
  const chatWindowRequest: ThreadChatWindowRequest = {
    connectionId,
    threadId,
    anchorTurnId: composerState.historyAnchorTurnId ?? null,
    residentHistoryEpoch: historyResourceRaw?.historyEpoch ?? null,
    residentMaxOrdinal: historyResourceRaw === null ? undefined : historyResourceRaw.residentMaxOrdinal,
    residentTurnLimit: historyResourceRaw?.residentTurnLimit ?? THREAD_RESIDENT_TURN_LIMIT,
  };
  const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest);
  if (chatWindow === null) throw new Error("Conversation window is unavailable");

  const chatSnapshot = chatWindow.snapshot;
  const historyEpoch = chatSnapshot.historyEpoch;
  const historyResource = historyResourceRaw?.historyEpoch === historyEpoch ? historyResourceRaw : null;
  const putHistoryState = (state: ThreadHistoryState): void => {
    remote.resourceDatabase?.putThreadHistory({
      id: historyResourceId,
      connectionId,
      threadId,
      generation: threadOpenGeneration,
      ...state,
    });
  };
  const readHistoryState = (): ThreadHistoryState | null => {
    const row = remote.resourceDatabase?.threadHistories.get(historyResourceId) ?? null;
    return row?.historyEpoch === historyEpoch ? row : null;
  };
  const projection = projectThreadChatWindow(chatDatabase, chatWindow, connectionId, threadId, false);
  const remoteThread = projection.remoteThread ?? storedThread?.provisionalThread ?? null;
  const provisionalThread = storedThread?.provisionalThread ?? null;
  const historyRestoreReady = !threadLoadBlocksPresentation(chatSnapshot.status);
  const persistedResidentMaxOrdinal = chatSnapshot.requestedMaxOrdinal ?? null;
  const activeResidentMaxOrdinal = historyResource?.residentMaxOrdinal ?? persistedResidentMaxOrdinal;
  const residentTurnLimit = historyResource?.residentTurnLimit
    ?? chatSnapshot.residentTurnLimit
    ?? THREAD_RESIDENT_TURN_LIMIT;
  const residentOrdinalBounds = (() => {
    if (chatWindow.turnRows.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of chatWindow.turnRows) {
      min = Math.min(min, row.ordinal);
      max = Math.max(max, row.ordinal);
    }
    return { min, max };
  })();
  const windowReady = chatSnapshot.status === "ready"
    || chatSnapshot.status === "background-updating"
    || chatSnapshot.status === "background-retrying";
  const historyState: ThreadHistoryState = historyResource ?? {
    historyEpoch,
    status: provisionalThread !== null ? "ready" : remoteThread === null ? "initial-loading" : "background-updating",
    nextCursor: null,
    residentTurnLimit,
    residentMaxOrdinal: persistedResidentMaxOrdinal,
    error: null,
  };
  const presentationState: ThreadHistoryState = {
    ...historyState,
    status: mergeThreadLoadStatuses(chatSnapshot.status, historyState.status),
  };
  const hydrationTaskKey = !connectionAvailable || !historyRestoreReady
    ? null
    : `thread-hydration:${historyResourceId}:${threadOpenGeneration}:${historyEpoch}:${provisionalThread === null ? "materialized" : "provisional"}`;
  useAsyncResource<ThreadHistoryState>("active-thread-hydration", hydrationTaskKey ?? "inactive", async (_publish, signal) => {
    if (hydrationTaskKey === null) return historyState;
    const cachedSnapshotAvailable = remoteThread !== null;
    const loadingState: ThreadHistoryState = {
      historyEpoch,
      status: cachedSnapshotAvailable ? "background-updating" : "initial-loading",
      nextCursor: historyResource?.nextCursor ?? null,
      residentTurnLimit,
      residentMaxOrdinal: historyResource?.residentMaxOrdinal ?? persistedResidentMaxOrdinal,
      error: null,
    };
    const navigationId = activeThreadNavigationIdFor(connectionId, threadId);
    recordThreadNavigationVisualEvent(connectionId, threadId, "hydration_state_write", {
      values: {
        historyEpoch,
        residentMaxOrdinal: loadingState.residentMaxOrdinal ?? -1,
        residentTurnLimit: loadingState.residentTurnLimit,
      },
      tags: { status: loadingState.status, phase: "start" },
    }, navigationId ?? undefined);
    putHistoryState(loadingState);
    const openedAt = monotonicNowMs();
    if (navigationId !== null) markThreadNavigationStage(connectionId, threadId, "hydration_start", {}, navigationId);
    const result = await remote.readThread(connectionId, threadId, null).then(
      (window) => ({ window, cause: null }),
      (cause: unknown) => ({ window: null, cause }),
    );
    if (navigationId !== null) {
      markThreadNavigationStage(connectionId, threadId, "hydration_result", {
        values: { rpcMs: monotonicNowMs() - openedAt },
        tags: { outcome: signal.aborted ? "aborted" : result.cause === null ? "success" : provisionalThread === null ? "error" : "provisional" },
      }, navigationId);
    }
    if (signal.aborted) return loadingState;
    if (result.cause !== null) {
      const current = readHistoryState();
      const state: ThreadHistoryState = provisionalThread !== null
        ? { ...(current ?? loadingState), status: "ready", error: null }
        : {
            ...(current ?? loadingState),
            status: cachedSnapshotAvailable ? "background-retrying" : "initial-error",
            error: result.cause instanceof Error ? result.cause.message : "Could not load messages",
          };
      recordThreadNavigationVisualEvent(connectionId, threadId, "hydration_state_write", {
        values: {
          historyEpoch,
          residentMaxOrdinal: state.residentMaxOrdinal ?? -1,
          residentTurnLimit: state.residentTurnLimit,
        },
        tags: { status: state.status, phase: "error" },
      }, navigationId ?? undefined);
      putHistoryState(state);
      return state;
    }
    if (result.window !== null) recordTiming("thread_fresh_visible_ms", monotonicNowMs() - openedAt);
    const current = readHistoryState();
    const state: ThreadHistoryState = {
      ...(current ?? loadingState),
      status: result.window === null ? cachedSnapshotAvailable ? "background-retrying" : "initial-error" : "ready",
      nextCursor: result.window?.nextCursor ?? current?.nextCursor ?? null,
      error: result.window === null ? "Could not load messages" : null,
    };
    recordThreadNavigationVisualEvent(connectionId, threadId, "hydration_state_write", {
      values: {
        historyEpoch,
        residentMaxOrdinal: state.residentMaxOrdinal ?? -1,
        residentTurnLimit: state.residentTurnLimit,
      },
      tags: { status: state.status, phase: "result" },
    }, navigationId ?? undefined);
    putHistoryState(state);
    return state;
  });

  const staleLifecycleTurnId = !connectionAvailable || threadLifecycleActive || remoteThread === null
    ? null
    : activeTurnId(remoteThread);
  const lifecycleRepairTaskKey = staleLifecycleTurnId === null
    ? null
    : `thread-lifecycle-repair:${connectionId}:${threadId}:${staleLifecycleTurnId}`;
  useAsyncResource<boolean>("active-thread-lifecycle-repair", lifecycleRepairTaskKey ?? "inactive", async () => {
    if (staleLifecycleTurnId === null) return false;
    await remote.reconcileThreadLifecycle(connectionId, threadId, staleLifecycleTurnId, remoteThread as Thread);
    return true;
  });

  const historyViewport = useThreadHistoryController({
    enabled: true,
    resourceId: historyResourceId,
    connectionId,
    threadId,
    historyEpoch,
    state: historyResource,
    presentationState,
    residentTurnRows: chatWindow.turnRows,
    liveRows: chatWindow.liveRows,
    residentOrdinalBounds,
    presentedResidentMaxOrdinal: chatSnapshot.requestedMaxOrdinal ?? activeResidentMaxOrdinal,
    persistedMinimumOrdinal: chatSnapshot.earliestSealedOrdinal,
    latestSealedOrdinal: chatSnapshot.latestSealedOrdinal,
    residentQueryReady: windowReady,
    putState: putHistoryState,
    loadOlderTurns: remote.loadOlderTurns,
  });

  return (
    <>
      <CommitOnChangeProbe
        scope={`main-conversation:${navigationKey}`}
        revision={navigationKey}
        onCommit={() => {
          const navigationId = recordThreadNavigationVisualEvent(connectionId, threadId, "conversation_destination_visible");
          return navigationId === null
            ? undefined
            : () => recordThreadNavigationVisualEvent(connectionId, threadId, "conversation_destination_hidden_or_unmounted", {}, navigationId);
        }}
      />
      <CommitOnChangeProbe
        scope={`main-window:${navigationKey}`}
        revision={`${chatSnapshot.requestKey ?? "none"}:${chatSnapshot.status}:${chatSnapshot.layoutRevision}:${chatSnapshot.revision}:${chatWindow.turnRows.length}:${chatWindow.detailRows.length}:${chatWindow.liveRows.length}:${historyResourceRaw === null ? "history-missing" : `history-${historyResourceRaw.generation}`}`}
        onCommit={() => {
          recordThreadNavigationVisualEvent(connectionId, threadId, "chat_window_committed", {
            values: {
              historyEpoch: chatSnapshot.historyEpoch,
              requestedMaxOrdinal: chatSnapshot.requestedMaxOrdinal ?? -1,
              residentTurnLimit: chatSnapshot.residentTurnLimit,
              layoutRevision: chatSnapshot.layoutRevision,
              contentRevision: chatSnapshot.revision,
              turnRows: chatWindow.turnRows.length,
              detailRows: chatWindow.detailRows.length,
              liveRows: chatWindow.liveRows.length,
            },
            tags: {
              status: chatSnapshot.status,
              request: chatWindowRequest.residentMaxOrdinal === undefined
                ? "restore"
                : chatWindowRequest.residentMaxOrdinal === null
                  ? "tail"
                  : "ordinal",
              history: historyResourceRaw === null ? "missing" : "resident",
            },
          });
        }}
      />
      <ConversationPane
        key={navigationKey}
        {...conversation}
        remoteThread={remoteThread}
        remoteSealedTurns={projection.remoteSealedTurns}
        remoteLiveTurns={projection.remoteLiveTurns}
        pendingDeliveries={projection.pendingDeliveries}
        queuedPrompts={projection.queuedPrompts}
        composerState={composerState}
        historyRestoreReady={historyRestoreReady}
        historyViewport={historyViewport}
        onLoadTurnItems={async (turnId) => { await remote.loadTurnItems(connectionId, threadId, turnId); }}
        subagentSummaryDatabase={remote.threadSummaryDatabase}
      />
    </>
  );
}

type NewConversationDetailProps = ConversationDestinationBaseProps & {
  remote: RemoteWorkspace;
  connectionId: string;
  draftId: string;
};

function NewConversationDetail({
  remote,
  connectionId,
  draftId,
  navigationKey,
  ...conversation
}: NewConversationDetailProps) {
  const uiStateDatabase = remote.threadUiStateDatabase;
  if (uiStateDatabase === null) throw new Error("Native composer database is unavailable");
  const composerState = useThreadUiState(uiStateDatabase, connectionId, draftId);
  return (
    <>
      <ConversationPane
        key={navigationKey}
        {...conversation}
        remoteThread={null}
        remoteSealedTurns={[]}
        remoteLiveTurns={[]}
        pendingDeliveries={[]}
        queuedPrompts={[]}
        composerState={composerState}
        historyRestoreReady
        historyViewport={COMPLETE_STATIC_THREAD_HISTORY}
        subagentSummaryDatabase={remote.threadSummaryDatabase}
      />
    </>
  );
}

type ConversationDestinationProps = ConversationDestinationBaseProps & {
  route:
    | {
        kind: "thread";
        remote: RemoteWorkspace;
        connectionId: string;
        threadId: string;
        threadOpenGeneration: number;
        connectionAvailable: boolean;
        threadLifecycleActive: boolean;
      }
    | {
        kind: "new";
        remote: RemoteWorkspace;
        connectionId: string;
        draftId: string;
      };
};

/** Chooses one destination. Each destination owns its only suspending read below the local boundary. */
function ConversationDestination({ route, ...conversation }: ConversationDestinationProps) {
  return route.kind === "thread"
    ? <MainConversationDetail {...conversation} {...route} />
    : <NewConversationDetail {...conversation} {...route} />;
}

function ConversationNavigationLoader({
  thread,
  server,
  cwd = "/workspace",
  compact = false,
  onBack,
}: {
  thread: ThreadListItem | null;
  server: ThreadListServer | undefined;
  cwd: string | undefined;
  compact: boolean | undefined;
  onBack: (() => void) | undefined;
}) {
  return (
    <View style={styles.conversation} testID="conversation-navigation-loader">
      <View style={styles.conversationKeyboard}>
        <View style={styles.conversationHeader}>
          {compact && onBack !== undefined ? (
            <Pressable onPress={onBack} style={styles.headerIcon} accessibilityLabel="Back to threads">
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={styles.conversationIdentity}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.conversationTitle}>
              {thread === null ? "Loading thread…" : emojiSafeTitle(thread.title)}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.conversationSubtitle}>
              {threadContextLabel(server?.name ?? "", cwd)}
            </Text>
          </View>
        </View>
        <View style={styles.emptyConversation}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      </View>
    </View>
  );
}

function ConversationNavigationFallback({
  connectionId,
  threadId,
  navigationKey,
  ...loader
}: Parameters<typeof ConversationNavigationLoader>[0] & {
  connectionId: string;
  threadId: string | null;
  navigationKey: string;
}) {
  return (
    <>
      {threadId !== null && (
        <CommitOnChangeProbe
          scope={`conversation-fallback:${navigationKey}`}
          revision="visible"
          onCommit={() => {
            const navigationId = recordThreadNavigationVisualEvent(connectionId, threadId, "suspense_fallback_visible");
            return navigationId === null
              ? undefined
              : () => recordThreadNavigationVisualEvent(connectionId, threadId, "suspense_fallback_hidden", {}, navigationId);
          }}
        />
      )}
      <ConversationNavigationLoader {...loader} />
    </>
  );
}

const timelineRowCache = new WeakMap<Thread["turns"][number], Extract<TimelineItem, { kind: "turn" }>>();
function projectTimelineTurns(
  turns: readonly Thread["turns"][number][],
  composerScope: string,
  connectionId: string,
  threadId: string,
  threadState?: ThreadListItem["state"],
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

function nativePortForwardingManagerProps(
  connectionId: string,
  serverName: string,
  snapshot: NativePortForwardingSnapshot,
  onOpen: (title: string, url: string) => void,
): PortForwardingManagerProps {
  const profiles = snapshot.profiles;
  return {
    serverName,
    profiles,
    discoveredPorts: snapshot.discoveredPorts,
    discoveryStatus: snapshot.discoveryStatus,
    discoveryError: snapshot.discoveryError,
    onOpen: (profile) => {
      if (profile.status === "live" && profile.previewUrl !== null) onOpen(profile.label, profile.previewUrl);
    },
    onRefresh: async () => await nativePortForwardingStore.refreshDiscovery(connectionId),
    onSelectPort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId: createNativePortForwardId(),
        label: candidate.name,
        remotePort: candidate.port,
        preferredLocalPort: null,
        startImmediately: true,
        serviceKey: candidate.forwardingKey,
        preference: "included",
      });
    },
    onExcludePort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId: `excluded-${candidate.forwardingKey.slice(0, 40)}`,
        label: candidate.name,
        remotePort: candidate.port,
        preferredLocalPort: null,
        startImmediately: false,
        serviceKey: candidate.forwardingKey,
        preference: "excluded",
      });
    },
    onAdd: async (input) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId: createNativePortForwardId(),
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: input.preferredLocalPort,
        startImmediately: input.startImmediately,
        serviceKey: null,
        preference: "included",
      });
    },
    onEdit: async (profileId, input) => {
      const existing = profiles.find((profile) => profile.id === profileId);
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId,
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: input.preferredLocalPort,
        startImmediately: input.startImmediately,
        serviceKey: existing?.serviceKey ?? null,
        preference: existing?.preference === "excluded" ? "included" : existing?.preference ?? "included",
      });
    },
    onStart: async (profileId) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile?.preference !== "excluded") {
        await nativePortForwardingStore.start(connectionId, profileId);
        return;
      }
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference: "included",
        startImmediately: true,
      });
    },
    onStop: async (profileId) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile === undefined || profile.serviceKey === null) {
        await nativePortForwardingStore.stop(connectionId, profileId);
        return;
      }
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference: "excluded",
        startImmediately: false,
      });
    },
    onReconnect: async (profileId) => await nativePortForwardingStore.reconnect(connectionId, profileId),
    onRemove: async (profileId) => await nativePortForwardingStore.remove(connectionId, profileId),
    onSetPreference: async (profileId, preference) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile === undefined) throw new Error("Port forward not found");
      const candidate = snapshot.discoveredPorts.find((value) => value.forwardingKey === profile.serviceKey);
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: candidate?.port ?? profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference,
        startImmediately: preference === "included" || (preference === "automatic" && candidate?.defaultForwardingEnabled === true),
      });
    },
  };
}

export function CodeWideScreen() {
  usePerformanceExperiments();
  const windowLayout = useWindowLayout();
  const insets = useSafeAreaInsets();
  const remote = useRemoteWorkspace();
  return <CodeWideWorkspaceScreen desktop={windowLayout.desktop} viewportWidth={windowLayout.width} insets={insets} remote={remote} />;
}

function CodeWideWorkspaceScreen({ desktop, viewportWidth, insets, remote }: { desktop: boolean; viewportWidth: number; insets: ReturnType<typeof useSafeAreaInsets>; remote: RemoteWorkspace }) {
  const [, startThreadTransition] = useTransition();
  const accountRateLimitsQuery = useLiveQuery(
    () => remote.accountRateLimitsDatabase?.collection,
    [remote.accountRateLimitsDatabase],
  );
  const accountRateLimits = accountRateLimitsQuery.data ?? [];
  const dialog = useAppDialog();
  const reduceVoiceMotion = useReducedMotionPreference();
  const [connectionSheetVisible, setConnectionSheetVisible] = useState(false);
  const [connectionSheetOpenedAt, setConnectionSheetOpenedAt] = useState(Date.now);
  const [pendingPairingCode, setPendingPairingCode] = useState<string | null>(null);
  const [newThreadVisible, setNewThreadVisible] = useState(false);
  const [newChatDraft, setNewChatDraft] = useState<NewChatDraft | null>(null);
  const newChatCounterRef = useRef(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [loopbackBrowser, setLoopbackBrowser] = useState<{ title: string; url: string } | null>(null);
  const [mobileThreadQuery, setMobileThreadQuery] = useState("");
  const [mobileThreadOffset] = useState(() => new ScrollOffsetMemory());
  const [threadListMode, setThreadListMode] = useState<ThreadListMode>("active");
  const servers: ThreadListServer[] = [...remote.connections.map((server) => ({
        id: server.id,
        name: server.displayName,
        emoji: server.emoji,
        status: server.enabled ? server.state : "offline",
      }))];
  const settingsConnections: StoredConnection[] = remote.connections;
  const projectCatalog = useRemoteProjectCatalog(remote.native, remote.connections, remote.listProjects);
  const projectsByConnection = projectCatalog.projectsByConnection;
  const projectErrorsByConnection = projectCatalog.errorsByConnection;
  const [requestedServerId, setActiveServerId] = useState(desktop ? "" : ALL_SERVERS_ID);
  const activeServerId = servers.length === 0
    ? desktop ? "" : ALL_SERVERS_ID
    : !desktop && requestedServerId === ALL_SERVERS_ID
      ? ALL_SERVERS_ID
      : servers.some((server) => server.id === requestedServerId)
        ? requestedServerId
        : servers[0]?.id ?? "";
  const [threadSelection, setThreadSelection] = useState(() => ({ id: null as string | null, generation: 0 }));
  const requestedThreadId = threadSelection.id;
  const requestedThreadTarget = parseThreadSelectionKey(requestedThreadId);
  const threadOpenGeneration = threadSelection.generation;
  const [threadListLimit, setThreadListLimit] = useState(THREAD_LIST_PAGE_SIZE);
  const [threadListProjection] = useState(() => new ThreadListProjection());
  const threadConnectionId = activeServerId === ALL_SERVERS_ID || activeServerId === ""
    ? null
    : activeServerId;
  const threadSummaryView = useThreadSummaryView(remote.threadSummaryDatabase, {
    connectionId: threadConnectionId,
    recentLimit: threadListLimit,
    archivedLimit: threadListLimit,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: null,
    subagentLimit: 0,
  });
  const pinnedThreadSummaryRows = threadSummaryView?.pinned ?? [];
  const recentThreadSummaryRows = threadSummaryView?.recent ?? [];
  const archivedThreadSummaryRows = threadSummaryView?.archived ?? [];
  const loadedThreadSummaries = deduplicateThreadSummaries([
    ...pinnedThreadSummaryRows,
    ...recentThreadSummaryRows,
    ...archivedThreadSummaryRows,
  ]);
  const projectedThreadSummaries = threadListProjection.project(loadedThreadSummaries, remote.pendingRequests);
  const threads: ThreadListItem[] = projectedThreadSummaries.map(storedThreadToListItem);
  const loadMoreThreads = () => {
    const loadedCount = threadListMode === "archived"
      ? archivedThreadSummaryRows.length
      : recentThreadSummaryRows.length;
    if (loadedCount < threadListLimit) return;
    setThreadListLimit((current) => current + THREAD_LIST_PAGE_SIZE);
  };
  const setActiveThreadId = (
    value: string | null,
    navigationId?: string,
    closeDraft = false,
    nextServerId?: string,
    reloadSelected = false,
  ) => {
    if (value !== requestedThreadId) {
      // A focused search field or composer keeps the Android IME session alive
      // when the visible surface is replaced. End that session at the navigation
      // boundary so the newly selected conversation never inherits keyboard focus.
      KeyboardController.dismiss({ animated: false, keepFocus: false });
    }
    // The selected resource is React-owned navigation state. A missing local
    // Legend resource suspends this transition, keeping the previous chat
    // visible until the destination SQLite window is atomically ready.
    const startedAt = performance.now();
    startThreadTransition(() => {
      if (nextServerId !== undefined) setActiveServerId(nextServerId);
      if (closeDraft) setNewChatDraft(null);
      setThreadSelection((current) => current.id === value
        ? reloadSelected
          ? { ...current, generation: current.generation + 1 }
          : current
        : { id: value, generation: current.generation + 1 });
    });
    requestAnimationFrame(() => {
      const elapsed = performance.now() - startedAt;
      recordTiming("thread_selection_next_frame_ms", elapsed);
      const target = parseThreadSelectionKey(value);
      if (target !== null && navigationId !== undefined) {
        markThreadNavigationStage(target.connectionId, target.threadId, "selection_next_frame", {
          values: { animationFrameDelayMs: elapsed },
        }, navigationId);
      }
      if (__DEV__) console.log(`[CodeWide perf] thread_selection_next_frame_ms=${Math.round(elapsed)}`);
    });
  };
  const selectThread = (value: string) => {
    const target = parseThreadSelectionKey(value);
    let navigationId: string | undefined;
    if (target !== null) {
      navigationId = beginThreadNavigation(target.connectionId, target.threadId);
      void beginNavigationFrameTrace(navigationId);
    }
    // Keep repeated selection as an explicit diagnostic reload path: it runs
    // through the same navigation, hydration, and profiling stages.
    setActiveThreadId(value, navigationId, true, undefined, true);
  };
  const preloadThread = (value: string): (() => void) | undefined => {
    if (!remote.native || remote.threadDetails === null || remote.threadUiStateDatabase === null || value === requestedThreadId) return;
    const target = parseThreadSelectionKey(value);
    if (target === null) return;
    const uiState = remote.threadUiStateDatabase.get(target.connectionId, target.threadId);
    return remote.threadDetails.preloadWindow({
      connectionId: target.connectionId,
      threadId: target.threadId,
      anchorTurnId: uiState?.historyAnchorTurnId ?? null,
      residentHistoryEpoch: null,
      residentMaxOrdinal: undefined,
      residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
    });
  };

  const scopedThreads = activeServerId === ALL_SERVERS_ID ? threads : threads.filter((thread) => thread.serverId === activeServerId);
  const serverThreads = scopedThreads.filter((thread) => !thread.archived);
  const archivedThreads = scopedThreads.filter((thread) => thread.archived);
  const normalizedMobileThreadQuery = mobileThreadQuery.trim().toLocaleLowerCase();
  const mobileSearchKey = `${activeServerId}\u0000${normalizedMobileThreadQuery}`;
  const mobileRemoteSearchResource = useAsyncResource<ThreadListItem[]>(
    remote.native ? "mobile-thread-search" : null,
    mobileSearchKey,
    async (_publish, signal) => {
      if (normalizedMobileThreadQuery === "") return [];
      await abortableDelay(60, signal);
      const results = await remote.searchThreads(
        mobileThreadQuery,
        activeServerId === ALL_SERVERS_ID ? null : activeServerId,
      );
      return results.map(storedThreadToListItem);
    },
  );
  const mobileNativeSearch = normalizedMobileThreadQuery === ""
    ? null
    : mobileRemoteSearchResource.value ?? [];
  const mobileVisibleThreads = mobileNativeSearch === null ? serverThreads : mobileNativeSearch.filter((thread) => !thread.archived);
  const mobileVisibleArchivedThreads = mobileNativeSearch === null ? archivedThreads : mobileNativeSearch.filter((thread) => thread.archived);
  const selectedThread = requestedThreadId === null
    ? null
    : scopedThreads.find((thread) => threadSelectionKey(thread) === requestedThreadId) ?? null;
  const pendingThreadSelection = requestedThreadId !== null
    && selectedThread === null;
  const activeThread = newChatDraft === null
    ? selectedThread ?? (desktop && !pendingThreadSelection ? (serverThreads[0] ?? null) : null)
    : null;
  const activeThreadId = activeThread === null
    ? pendingThreadSelection ? requestedThreadId : null
    : threadSelectionKey(activeThread);
  const activeThreadKey = activeThread === null ? requestedThreadId : threadSelectionKey(activeThread);
  const activeConnectionId = newChatDraft?.serverId
    ?? activeThread?.serverId
    ?? requestedThreadTarget?.connectionId
    ?? (activeServerId === ALL_SERVERS_ID ? "" : activeServerId);
  const activeAccountRateLimits = accountRateLimits.find((row) => row.connectionId === activeConnectionId) ?? null;
  const selectedServerAccountRateLimits = accountRateLimits.find((row) => row.connectionId === activeServerId) ?? null;
  const activeConnectionState = remote.connections.find((connection) => connection.id === activeConnectionId)?.state ?? "offline";
  const activeConnectionAvailable = activeConnectionState === "live" || activeConnectionState === "syncing";
  const activeRemoteThreadId = activeThread?.id ?? requestedThreadTarget?.threadId ?? null;
  const composerThreadId = newChatDraft?.id ?? activeRemoteThreadId;
  const visibleConversationThread: ThreadListItem | null = newChatDraft === null
    ? activeThread ?? (requestedThreadTarget === null ? null : {
        id: requestedThreadTarget.threadId,
        serverId: requestedThreadTarget.connectionId,
        title: "Loading thread…",
        preview: "",
        pinned: false,
        unread: 0,
      })
    : {
        id: newChatDraft.id,
        serverId: newChatDraft.serverId,
        title: "New Chat",
        preview: "",
        time: "now",
        pinned: false,
        unread: 0,
      };
  const activeStoredThread = loadedThreadSummaries.find((candidate) =>
    candidate.connectionId === activeConnectionId && candidate.remoteThreadId === activeRemoteThreadId,
  ) ?? null;
  const activeCwd = newChatDraft?.cwd ?? activeStoredThread?.cwd ?? "/workspace";
  const workspaceSupportResource = useAsyncResource<WorkspaceSupport | null>(
    remote.native && newChatDraft?.cwd !== null && newChatDraft?.cwd !== undefined
      ? `new-chat-workspace-support:${newChatDraft.serverId}:${newChatDraft.cwd}`
      : null,
    `${newChatDraft?.serverId ?? "none"}:${newChatDraft?.cwd ?? "none"}`,
    async () => newChatDraft?.cwd === null || newChatDraft?.cwd === undefined
      ? null
      : await remote.inspectWorkspace(newChatDraft.serverId, newChatDraft.cwd),
  );
  const activeWorkspaceSupport = workspaceSupportResource.status === "ready"
    ? workspaceSupportResource.value
    : null;
  const activeProjects: RemoteProject[] = activeConnectionId === "" || !remote.native
    ? []
    : (projectsByConnection[activeConnectionId] ?? []).filter(({ pinned }) => pinned);
  const activeDiscoveredProjects: RemoteProject[] = activeConnectionId === "" || !remote.native
    ? []
    : (projectsByConnection[activeConnectionId] ?? []).filter(({ pinned }) => !pinned);
  const activeProjectError = activeConnectionId === "" ? null : projectErrorsByConnection[activeConnectionId] ?? null;
  const activeControlsResourceId = activeConnectionId === "" ? null : turnControlsResourceKey(activeConnectionId, activeCwd);
  const activeThreadResourceId = activeConnectionId === "" || activeRemoteThreadId === null ? null : threadResourceKey(activeConnectionId, activeRemoteThreadId);
  const activeTunnelResourceId = activeConnectionId === "" ? null : tunnelResourceKey(activeConnectionId);
  const activeVoiceScope = activeConnectionId === "" || composerThreadId === null ? null : `${activeConnectionId}\u0000${composerThreadId}`;
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
    (query) => remote.resourceDatabase === null ? undefined : query.from({ resource: remote.resourceDatabase.voiceInputs }),
    [remote.resourceDatabase],
  );
  const activeFileTransferQuery = useLiveQuery(
    (query) => remote.resourceDatabase === null || activeVoiceScope === null
      ? undefined
      : query.from({ resource: remote.resourceDatabase.fileTransfers }).where(({ resource }) => eq(resource.id, activeVoiceScope)),
    [activeVoiceScope, remote.resourceDatabase],
  );
  const activeFileTransferResource = activeFileTransferQuery.data?.[0] ?? null;
  const activeThreadLifecycleActive = isThreadLifecycleActive(activeThread?.state);
  const activePendingRequests = remote.pendingRequests.filter((request) =>
    request.connectionId === activeConnectionId && request.params.threadId === activeRemoteThreadId,
  );
  const activePendingRequest = activePendingRequests[0] ?? null;
  useDeepLinkListener((raw) => {
    if (raw === null) return;
    if (raw.startsWith("codewide://pair") || raw.startsWith("codexremote://pair")) {
      setConnectionSheetOpenedAt(Date.now());
      setPendingPairingCode(raw);
      setConnectionSheetVisible(true);
      return;
    }
    const parsed = parseThreadDeepLink(raw);
    if (parsed !== null) {
      setActiveThreadId(
        threadSelectionKey({ serverId: parsed.connectionId, id: parsed.threadId }),
        undefined,
        true,
        parsed.connectionId,
      );
    }
  });

  const forkCurrentThread = async (options: ThreadForkOptions): Promise<void> => {
    if (activeThread === null || activeRemoteThreadId === null || activeConnectionId === "") throw new Error("No thread selected");
    const forkedId = await remote.forkThread(activeConnectionId, activeRemoteThreadId, options);
    setActiveThreadId(threadSelectionKey({ serverId: activeConnectionId, id: forkedId }));
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
    setThreadListLimit(THREAD_LIST_PAGE_SIZE);
    setActiveThreadId(desktop && first !== undefined ? threadSelectionKey(first) : null, undefined, true, serverId);
  };

  const openConnectionSheet = () => {
    setConnectionSheetOpenedAt(Date.now());
    setConnectionSheetVisible(true);
  };

  const saveConnection = async (input: ConnectionInput): Promise<void> => {
    const added = await remote.addConnection(input);
    setActiveThreadId(null, undefined, false, added.id);
  };

  const toggleConnection = async (connectionId: string, enabled: boolean): Promise<void> => await remote.setConnectionEnabled(connectionId, enabled);

  const reconnectSavedConnection = async (connectionId: string): Promise<void> => await remote.reconnectConnection(connectionId);

  const deleteSavedConnection = async (connectionId: string): Promise<void> => await remote.deleteConnection(connectionId);

  const updateSavedConnection = async (connectionId: string, input: ConnectionUpdateInput): Promise<void> => {
    const current = settingsConnections.find((connection) => connection.id === connectionId);
    if (current === undefined) throw new Error("Connection not found");
    if (isProfileOnlyConnectionUpdate(input, current)) {
      const profile = validateConnectionProfile(input.displayName, input.emoji);
      return await remote.updateConnectionProfile(connectionId, profile.displayName, profile.emoji);
    }
    await remote.updateConnection(connectionId, input);
  };

  const moveSavedConnection = async (connectionId: string, direction: -1 | 1): Promise<void> => await remote.moveConnection(connectionId, direction);

  const defaultProjectCwd = (serverId: string): string | null => projectsByConnection[serverId]?.[0]?.path ?? null;

  const createThread = (): void => {
    const route = resolveNewThreadRoute({
      activeServerId,
      allServersId: ALL_SERVERS_ID,
      serverIds: servers.map(({ id }) => id),
    });
    if (route.type === "connect-server") {
      openConnectionSheet();
      return;
    }
    if (route.type === "choose-server") {
      setNewThreadVisible(true);
      return;
    }
    void openNewChat(route.serverId, defaultProjectCwd(route.serverId));
  };

  const openNewChat = async (requestedServerId: string, cwd: string | null): Promise<void> => {
    if (requestedServerId === "") return;
    newChatCounterRef.current += 1;
    startThreadTransition(() => {
      setNewChatDraft({
        id: `new-chat-${Date.now()}-${newChatCounterRef.current}`,
        serverId: requestedServerId,
        cwd,
        workspaceMode: "current",
      });
      setActiveServerId(requestedServerId);
      setThreadSelection((current) => ({ id: null, generation: current.generation + 1 }));
      setNewThreadVisible(false);
    });
  };

  const changeEmptyThreadProject = async (cwd: string | null): Promise<void> => {
    if (newChatDraft !== null) {
      setNewChatDraft((current) => current?.id === newChatDraft.id
        ? { ...current, cwd, workspaceMode: "current" }
        : current);
      return;
    }
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) return;
    if ((remote.threadDetails?.getThread(activeConnectionId, activeRemoteThreadId)?.turns.length ?? 0) > 0
      || (remote.threadDetails?.listQueued(activeConnectionId, activeRemoteThreadId).length ?? 0) > 0) {
      throw new Error("Project can only be changed before the first message");
    }
    if ((cwd ?? null) === (activeStoredThread?.cwd || null)) return;
    const previousThreadId = activeRemoteThreadId;
    const nextThreadId = await remote.startThread(activeConnectionId, cwd ?? undefined);
    setActiveThreadId(threadSelectionKey({ id: nextThreadId, serverId: activeConnectionId }), undefined, false, activeConnectionId);
    await remote.deleteThread(activeConnectionId, previousThreadId);
  };

  const addActiveProject = async (path: string): Promise<RemoteProject> => {
    if (!remote.native || activeConnectionId === "") throw new Error("No server selected");
    const project = await remote.addProject(activeConnectionId, path);
    projectCatalog.mergeProject(activeConnectionId, project);
    return project;
  };

  const readActiveDirectory = async (path: string): Promise<RemoteDirectoryEntry[]> => {
    if (!remote.native || activeConnectionId === "") throw new Error("No server selected");
    return await remote.readDirectory(activeConnectionId, path);
  };

  const createRepairThread = async (title: string, prompt: string): Promise<void> => {
    if (activeConnectionId === "") throw new Error("No server selected");
    const currentCwd = loadedThreadSummaries.find((candidate) => candidate.connectionId === activeConnectionId && candidate.remoteThreadId === activeRemoteThreadId)?.cwd;
    const threadId = await remote.startThread(activeConnectionId, currentCwd);
    await remote.renameThread(activeConnectionId, threadId, title);
    await remote.sendText(activeConnectionId, threadId, prompt, { type: "start" });
    setActiveThreadId(threadSelectionKey({ serverId: activeConnectionId, id: threadId }), undefined, false, activeConnectionId);
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

  const toggleListThreadPin = async (thread: ThreadListItem): Promise<void> => {
    await remote.setThreadPinned(thread.serverId, thread.id, !thread.pinned);
  };

  const archiveListThread = async (thread: ThreadListItem): Promise<void> => {
    await remote.archiveThread(thread.serverId, thread.id);
    if (activeThreadId === threadSelectionKey(thread)) setActiveThreadId(null);
  };

  const unarchiveListThread = async (thread: ThreadListItem): Promise<void> => {
    await remote.unarchiveThread(thread.serverId, thread.id);
    if (activeThreadId === threadSelectionKey(thread)) setActiveThreadId(null);
  };

  const markListThreadRead = async (thread: ThreadListItem): Promise<void> => {
    await remote.markThreadRead(thread.serverId, thread.id);
  };
  const activeConversationNavigationKey = newChatDraft !== null
    ? `new-chat:${newChatDraft.serverId}:${newChatDraft.id}`
    : requestedThreadId ?? activeThreadKey ?? "none";
  const activeConversationRoute: ConversationDestinationProps["route"] | null = newChatDraft !== null
    ? {
        kind: "new",
        remote,
        connectionId: newChatDraft.serverId,
        draftId: newChatDraft.id,
      }
    : activeRemoteThreadId !== null && activeConnectionId !== ""
      ? {
          kind: "thread",
          remote,
          connectionId: activeConnectionId,
          threadId: activeRemoteThreadId,
          threadOpenGeneration,
          connectionAvailable: activeConnectionAvailable,
          threadLifecycleActive: activeThreadLifecycleActive,
        }
      : null;
  const conversationActions = newChatDraft !== null
    ? {
        onSend: async (text: string, _mode: SendMode, options: TurnSendOptions) => {
          const draftChat = newChatDraft;
          let threadId: string;
          if (draftChat.workspaceMode === "isolated") {
            if (draftChat.cwd === null) throw new Error("Select a project before creating a workspace");
            threadId = await remote.startThreadInWorkspace(draftChat.serverId, draftChat.cwd, draftChat.id);
          } else {
            threadId = await remote.startThread(draftChat.serverId, draftChat.cwd ?? undefined);
          }
          const commandId = await remote.sendText(
            draftChat.serverId,
            threadId,
            text,
            { type: "start" },
            draftChat.workspaceMode === "isolated"
              ? { ...options, workspaceRequestId: draftChat.id }
              : options,
          );
          setActiveThreadId(threadSelectionKey({ id: threadId, serverId: draftChat.serverId }), undefined, true, draftChat.serverId);
          return commandId;
        },
        onLoadControls: async (cwd: string) => await remote.loadTurnControls(newChatDraft.serverId, cwd),
        getTransferAccess: async (forceRefresh = false) => await remote.transferAccess(newChatDraft.serverId, forceRefresh),
        onStartVoiceTranscription: async (listener: (event: VoiceTranscriptionEvent) => void, options?: VoiceTranscriptionOptions) => await remote.startVoiceTranscription(newChatDraft.serverId, newChatDraft.id, listener, options),
      }
    : activeRemoteThreadId === null
    ? {}
    : {
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
          onLoadThreadResources: async (scope?: ThreadChangeScope, kind?: "all" | "changes" | "attachments") => await remote.loadThreadResources(activeConnectionId, activeRemoteThreadId, scope, kind),
          onLoadThreadChangeDiff: async (path: string, scope?: ThreadChangeScope) => await remote.loadThreadChangeDiff(activeConnectionId, activeRemoteThreadId, path, scope),
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
        };

  // Recording state intentionally remains workspace-owned. It coordinates the
  // global aura and the active composer and is outside resource-isolation work.
  const voiceAuraResource = voiceInputsQuery.data?.find((resource) => resource?.phase === "recording") ?? null;
  const voiceAuraPhase = voiceAuraResource === null ? "idle" : "recording";
  const voiceInputRuntime: AppVoiceInputRuntime = {
    controller: remote.voiceController,
    resources: remote.resourceDatabase,
    scopePrefix: `${activeConnectionId || "local"}\u0000${composerThreadId ?? "workspace"}`,
    // The workspace provider never materializes a selected chat. Each
    // ConversationPane installs its own thread-scoped provider below Suspense.
    thread: null,
    ...(remote.native && activeConnectionId !== ""
      ? {
          startRemote: async (listener, options) => await remote.startVoiceTranscription(
            activeConnectionId,
            composerThreadId ?? "",
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
        setLoopbackBrowser({
          title: profile.label,
          url: forwardedLoopbackUrl(target, profile),
        });
      }
    : undefined;
  const closeActiveConversation = () => {
    setNewChatDraft(null);
    setActiveThreadId(null);
  };

  if (loopbackBrowser !== null) {
    return (
      <ForwardedLoopbackBrowser
        title={loopbackBrowser.title}
        url={loopbackBrowser.url}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onClose={() => setLoopbackBrowser(null)}
      />
    );
  }

  if (!desktop) {
    return (
      <RenderRecoveryProvider onFix={createRenderFailureFixThread}>
      <AppVoiceInputProvider runtime={voiceInputRuntime}>
      <VoiceAura phase={voiceAuraPhase} controller={remote.voiceController} scope={voiceAuraResource?.scope ?? null} reducedMotion={reduceVoiceMotion}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}> 
        {activeThreadId === null && newChatDraft === null ? (
          <RecoverableRenderBoundary
            scope="surface"
            label="Chat list"
            resetKey={`mobile-chat-list:${activeServerId}:${threadListMode}`}
          >
          <Suspense fallback={<ThreadListSuspenseFallback />}>
          <MobileThreads
            servers={servers}
            activeServerId={activeServerId}
            threads={mobileVisibleThreads}
            archivedThreads={mobileVisibleArchivedThreads}
            mode={threadListMode}
            query={mobileThreadQuery}
            onQueryChange={setMobileThreadQuery}
            onModeChange={setThreadListMode}
            onLoadMore={loadMoreThreads}
            initialOffset={mobileThreadOffset.read()}
            onOffsetChange={(offset) => mobileThreadOffset.write(offset)}
            onSelectThread={selectThread}
            onPreloadThread={preloadThread}
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
          </Suspense>
          </RecoverableRenderBoundary>
        ) : (
          <RecoverableRenderBoundary
            scope="surface"
            label="Conversation"
            context={`Connection: ${activeConnectionId}\nThread: ${composerThreadId ?? "none"}`}
            resetKey={`${activeConnectionId}:${composerThreadId ?? "none"}`}
            onDismiss={closeActiveConversation}
          >
          <Suspense fallback={<ConversationNavigationFallback connectionId={activeConnectionId} threadId={activeRemoteThreadId} navigationKey={activeConversationNavigationKey} thread={visibleConversationThread} server={servers.find((server) => server.id === activeConnectionId)} cwd={activeCwd} compact onBack={closeActiveConversation} />}>
          {activeConversationRoute === null ? null : <ConversationDestination
            route={activeConversationRoute}
            navigationKey={activeConversationNavigationKey}
            thread={visibleConversationThread}
            newChat={newChatDraft !== null}
            server={servers.find((server) => server.id === activeConnectionId)}
            onBack={closeActiveConversation}
            compact
            accountRateLimits={activeAccountRateLimits}
            {...(activeConnectionId === "" ? {} : {
              onRefreshAccountRateLimits: async () => await remote.refreshAccountRateLimits(activeConnectionId),
            })}
            workspaceResources={remote.resourceDatabase}
            controlsResourceId={activeControlsResourceId}
            backgroundTerminalsResourceId={activeThreadResourceId}
            threadResourcesModel={remote.resourceDatabase?.threadResources ?? null}
            threadResourceId={activeThreadResourceId}
            threadResourceRevision={activeConnectionState}
            goalResourceId={activeThreadResourceId}
            tunnelResourceId={activeTunnelResourceId}
            portForwardingConnectionId={remote.native && activeConnectionId !== "" ? activeConnectionId : null}
            portForwardingServerName={servers.find((server) => server.id === activeConnectionId)?.name ?? "Server"}
            onOpenPortForward={(title, url) => setLoopbackBrowser({ title, url })}
            {...(openActiveLoopbackLink === undefined ? {} : { onOpenLoopbackLink: openActiveLoopbackLink })}
            voiceResource={activeVoiceResource}
            reviewVoiceResource={activeReviewVoiceResource}
            voiceController={remote.voiceController}
            fileTransferResource={activeFileTransferResource}
            fileTransferController={remote.fileTransferController}
            subagentSummaryDatabase={remote.threadSummaryDatabase}
            subagentThreadDetails={remote.threadDetails}
            onReadSubagentThread={remote.readSubagentThread}
            onRefreshSubagents={async (rootThreadId: string) => await remote.refreshSubagents(activeConnectionId, rootThreadId)}
            loadDraft={remote.loadDraft}
            saveDraft={remote.saveDraft}
            saveDraftAttachments={remote.saveDraftAttachments}
            loadScrollOffset={remote.loadScrollOffset}
            saveScrollOffset={remote.saveScrollOffset}
            saveComposerPreferences={remote.saveComposerPreferences}
            pendingRequest={activePendingRequest}
            pendingRequestCount={activePendingRequests.length}
            pinned={activeThread?.pinned ?? false}
            unread={activeThread?.unread ?? 0}
            onViewedLatest={markActiveThreadRead}
            cwd={activeCwd}
            projects={activeProjects}
            discoveredProjects={activeDiscoveredProjects}
            projectLoadError={activeProjectError}
            onChangeProject={changeEmptyThreadProject}
            workspaceSupport={activeWorkspaceSupport}
            workspaceMode={newChatDraft?.workspaceMode ?? "current"}
            onChangeWorkspaceMode={(workspaceMode) => {
              setNewChatDraft((current) => current === null ? null : { ...current, workspaceMode });
            }}
            onAddProject={addActiveProject}
            onReadDirectory={readActiveDirectory}
            onRename={async (name) => {
              if (activeRemoteThreadId !== null) await remote.renameThread(activeConnectionId, activeRemoteThreadId, name);
            }}
            onArchive={async () => {
              if (activeRemoteThreadId !== null) await remote.archiveThread(activeConnectionId, activeRemoteThreadId);
              setActiveThreadId(null);
            }}
            onUnarchive={async () => {
              if (activeRemoteThreadId !== null) await remote.unarchiveThread(activeConnectionId, activeRemoteThreadId);
              setThreadListMode("active");
              setActiveThreadId(null);
            }}
            archived={activeThread?.archived ?? false}
            onDelete={async () => {
              if (activeRemoteThreadId !== null) await remote.deleteThread(activeConnectionId, activeRemoteThreadId);
              setActiveThreadId(null);
            }}
            onFork={forkCurrentThread}
            onFixUnsupportedBlock={createUnsupportedFixThread}
            onTogglePin={async () => {
              if (activeRemoteThreadId === null || activeThreadId === null) return;
              await remote.setThreadPinned(activeConnectionId, activeRemoteThreadId, !(activeThread?.pinned ?? false));
            }}
            {...conversationActions}
          />}
          </Suspense>
          </RecoverableRenderBoundary>
        )}
        <ConnectionSheet
          visible={connectionSheetVisible}
          openedAt={connectionSheetOpenedAt}
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
          onSelect={async (serverId) => await openNewChat(serverId, defaultProjectCwd(serverId))}
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
        <RecoverableRenderBoundary
          scope="surface"
          label="Chat list"
          resetKey={`desktop-chat-list:${activeServerId}:${threadListMode}`}
        >
        <Suspense fallback={<ThreadListSuspenseFallback />}>
        <ThreadSidebar
          width={Math.max(280, Math.min(480, Math.floor(viewportWidth * 0.32)))}
          server={servers.find((server) => server.id === activeServerId)}
          threads={serverThreads}
          archivedThreads={archivedThreads}
          mode={threadListMode}
          activeThreadId={activeThread === null ? null : threadSelectionKey(activeThread)}
          onModeChange={setThreadListMode}
          onLoadMore={loadMoreThreads}
          onSelect={selectThread}
          onPreload={preloadThread}
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
        </Suspense>
        </RecoverableRenderBoundary>
        <RecoverableRenderBoundary
          scope="surface"
          label="Conversation"
          context={`Connection: ${activeConnectionId}\nThread: ${composerThreadId ?? "none"}`}
          resetKey={`${activeConnectionId}:${composerThreadId ?? "none"}`}
          onDismiss={closeActiveConversation}
        >
        <Suspense fallback={<ConversationNavigationFallback connectionId={activeConnectionId} threadId={activeRemoteThreadId} navigationKey={activeConversationNavigationKey} thread={visibleConversationThread} server={servers.find((server) => server.id === activeConnectionId)} cwd={activeCwd} compact={false} onBack={undefined} />}>
        {activeConversationRoute === null ? null : <ConversationDestination
          route={activeConversationRoute}
          navigationKey={activeConversationNavigationKey}
          thread={visibleConversationThread}
          newChat={newChatDraft !== null}
          server={servers.find((server) => server.id === activeConnectionId)}
          accountRateLimits={activeAccountRateLimits}
          {...(activeConnectionId === "" ? {} : {
            onRefreshAccountRateLimits: async () => await remote.refreshAccountRateLimits(activeConnectionId),
          })}
          workspaceResources={remote.resourceDatabase}
          controlsResourceId={activeControlsResourceId}
          backgroundTerminalsResourceId={activeThreadResourceId}
          threadResourcesModel={remote.resourceDatabase?.threadResources ?? null}
          threadResourceId={activeThreadResourceId}
          threadResourceRevision={activeConnectionState}
          goalResourceId={activeThreadResourceId}
          tunnelResourceId={activeTunnelResourceId}
          portForwardingConnectionId={remote.native && activeConnectionId !== "" ? activeConnectionId : null}
          portForwardingServerName={servers.find((server) => server.id === activeConnectionId)?.name ?? "Server"}
          onOpenPortForward={(title, url) => setLoopbackBrowser({ title, url })}
          {...(openActiveLoopbackLink === undefined ? {} : { onOpenLoopbackLink: openActiveLoopbackLink })}
          voiceResource={activeVoiceResource}
          reviewVoiceResource={activeReviewVoiceResource}
          voiceController={remote.voiceController}
          fileTransferResource={activeFileTransferResource}
          fileTransferController={remote.fileTransferController}
          subagentSummaryDatabase={remote.threadSummaryDatabase}
          subagentThreadDetails={remote.threadDetails}
          onReadSubagentThread={remote.readSubagentThread}
          onRefreshSubagents={async (rootThreadId: string) => await remote.refreshSubagents(activeConnectionId, rootThreadId)}
          loadDraft={remote.loadDraft}
          saveDraft={remote.saveDraft}
          saveDraftAttachments={remote.saveDraftAttachments}
          loadScrollOffset={remote.loadScrollOffset}
          saveScrollOffset={remote.saveScrollOffset}
          saveComposerPreferences={remote.saveComposerPreferences}
          pendingRequest={activePendingRequest}
          pendingRequestCount={activePendingRequests.length}
          pinned={activeThread?.pinned ?? false}
          unread={activeThread?.unread ?? 0}
          onViewedLatest={markActiveThreadRead}
          cwd={activeCwd}
          projects={activeProjects}
          discoveredProjects={activeDiscoveredProjects}
          projectLoadError={activeProjectError}
          onChangeProject={changeEmptyThreadProject}
          workspaceSupport={activeWorkspaceSupport}
          workspaceMode={newChatDraft?.workspaceMode ?? "current"}
          onChangeWorkspaceMode={(workspaceMode) => {
            setNewChatDraft((current) => current === null ? null : { ...current, workspaceMode });
          }}
          onAddProject={addActiveProject}
          onReadDirectory={readActiveDirectory}
          onRename={async (name) => {
            if (activeRemoteThreadId !== null) await remote.renameThread(activeConnectionId, activeRemoteThreadId, name);
          }}
          onArchive={async () => {
            if (activeRemoteThreadId !== null) await remote.archiveThread(activeConnectionId, activeRemoteThreadId);
            setActiveThreadId(null);
          }}
          onUnarchive={async () => {
            if (activeRemoteThreadId !== null) await remote.unarchiveThread(activeConnectionId, activeRemoteThreadId);
            setThreadListMode("active");
            setActiveThreadId(null);
          }}
          archived={activeThread?.archived ?? false}
          onDelete={async () => {
            if (activeRemoteThreadId !== null) await remote.deleteThread(activeConnectionId, activeRemoteThreadId);
            setActiveThreadId(null);
          }}
          onFork={forkCurrentThread}
          onFixUnsupportedBlock={createUnsupportedFixThread}
          onTogglePin={async () => {
            if (activeRemoteThreadId === null || activeThreadId === null) return;
            await remote.setThreadPinned(activeConnectionId, activeRemoteThreadId, !(activeThread?.pinned ?? false));
          }}
          {...conversationActions}
        />}
        </Suspense>
        </RecoverableRenderBoundary>
      </View>
      <ConnectionSheet
        visible={connectionSheetVisible}
        openedAt={connectionSheetOpenedAt}
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
        onSelect={async (serverId) => await openNewChat(serverId, defaultProjectCwd(serverId))}
      />
    </View>
    </VoiceAura>
    </AppVoiceInputProvider>
    </RenderRecoveryProvider>
  );
}

function ForwardedLoopbackBrowser({
  title,
  url,
  topInset,
  bottomInset,
  onClose,
}: {
  title: string;
  url: string;
  topInset: number;
  bottomInset: number;
  onClose(): void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <View testID="forwarded-loopback-browser" style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      {error !== null && <Text style={styles.previewError}>{error}</Text>}
      <View style={styles.flex}>
        <InternalBrowser
          url={url}
          header={{ title, closeLabel: "Back to conversation", closeIcon: "arrow-back", onClose }}
          originWhitelist={[new URL(url).origin]}
          onHttpError={(statusCode) => setError(statusCode === 502 ? "This port is currently unavailable" : `Preview returned HTTP ${statusCode}`)}
          onError={setError}
        />
      </View>
    </View>
  );
}

function ServerRail({
  servers,
  activeServerId,
  onSelect,
  onAdd,
  onSettings,
}: {
  servers: ThreadListServer[];
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
  | { kind: "thread"; thread: ThreadListItem };

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
    && left.timestamp === right.timestamp
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
  onLoadMore,
  onSelect,
  onPreload,
  onNewThread,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
  accountRateLimits = null,
  onRefreshAccountRateLimits,
}: {
  width: number;
  server: ThreadListServer | undefined;
  threads: ThreadListItem[];
  archivedThreads: ThreadListItem[];
  mode: ThreadListMode;
  activeThreadId: string | null;
  onModeChange(mode: ThreadListMode): void;
  onLoadMore(): void;
  onSelect(id: string): void;
  onPreload(id: string): (() => void) | undefined;
  onNewThread(): void;
  onTogglePin(thread: ThreadListItem): Promise<void>;
  onArchive(thread: ThreadListItem): Promise<void>;
  onUnarchive(thread: ThreadListItem): Promise<void>;
  onMarkRead(thread: ThreadListItem): Promise<void>;
  accountRateLimits?: AccountRateLimitsRow | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  const windowLayout = useWindowLayout();
  const hideThreadLists = usePerformanceExperiment("hideThreadLists");
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
      {hideThreadLists ? <ThreadListExperimentSuspended /> : <LegendList
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
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<ThreadListEmpty archived={mode === "archived"} />}
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <Text style={styles.sectionHeader}>{item.title}</Text>
          ) : (
            <ThreadRow
              thread={item.thread}
              selected={threadSelectionKey(item.thread) === activeThreadId}
              onPressIn={() => onPreload(threadSelectionKey(item.thread))}
              onPress={() => onSelect(threadSelectionKey(item.thread))}
              onTogglePin={() => onTogglePin(item.thread)}
              onArchive={() => onArchive(item.thread)}
              onUnarchive={() => onUnarchive(item.thread)}
              onMarkRead={() => onMarkRead(item.thread)}
            />
          )
        }
      />}
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

function ThreadListSuspenseFallback() {
  return (
    <View accessibilityLabel="Loading chats" style={styles.threadListEmpty} testID="thread-list-suspense-fallback">
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

function ThreadListExperimentSuspended() {
  return (
    <View style={styles.threadListEmpty}>
      <Ionicons name="pause-circle-outline" size={24} color={colors.amber} />
      <Text style={styles.threadListEmptyText}>Thread list paused by performance experiment</Text>
    </View>
  );
}

type ThreadListFilter = "all" | "running" | "approval" | "unread" | "pinned";

function threadMatchesFilter(thread: ThreadListItem, filter: ThreadListFilter): boolean {
  if (filter === "running") return thread.state === "running";
  if (filter === "approval") return thread.state === "approval";
  if (filter === "unread") return thread.unread > 0;
  if (filter === "pinned") return thread.pinned;
  return true;
}

function ThreadRow({
  thread,
  selected,
  onPressIn,
  onPress,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
}: {
  thread: ThreadListItem;
  selected: boolean;
  onPressIn?(): (() => void) | undefined;
  onPress(): void;
  onTogglePin?(): Promise<void>;
  onArchive?(): Promise<void>;
  onUnarchive?(): Promise<void>;
  onMarkRead?(): Promise<void>;
}) {
  const dialog = useAppDialog();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const pressIntentCancelRef = useRef<(() => void) | null>(null);
  const pressIntentReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const closeSwipe = useEvent(() => {
    swipeableRef.current?.close();
  });
  const row = (
    <ThreadRowCommitBoundary>
    <CommitOnChangeProbe scope={thread.id} revision={selected ? 1 : 0} onCommit={closeSwipe} />
    <GesturePressable
      {...(selected ? { testID: "selected-thread-row" } : {})}
      accessibilityRole="button"
      cancelable
      delayLongPress={350}
      onPressIn={() => {
        if (pressIntentReleaseTimerRef.current !== null) clearTimeout(pressIntentReleaseTimerRef.current);
        pressIntentReleaseTimerRef.current = null;
        pressIntentCancelRef.current?.();
        pressIntentCancelRef.current = onPressIn?.() ?? null;
      }}
      onPressOut={() => {
        const cancel = pressIntentCancelRef.current;
        if (cancel === null) return;
        // Gesture Handler dispatches onPressOut before onPress. Defer release
        // one task so a completed press can transfer the same intent instead
        // of evicting it in the gap between the two callbacks.
        pressIntentReleaseTimerRef.current = setTimeout(() => {
          pressIntentReleaseTimerRef.current = null;
          if (pressIntentCancelRef.current !== cancel) return;
          pressIntentCancelRef.current = null;
          cancel();
        }, 0);
      }}
      onPress={() => {
        if (pressIntentReleaseTimerRef.current !== null) clearTimeout(pressIntentReleaseTimerRef.current);
        pressIntentReleaseTimerRef.current = null;
        // The database keeps the transient lease until the mounted
        // conversation acquires its own lease in the retention effect.
        pressIntentCancelRef.current = null;
        swipeableRef.current?.close();
        onPress();
      }}
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
          <View style={styles.threadMeta}>
            <View style={styles.unreadSlot}>
              {thread.unread > 0 && (
                <View
                  accessible
                  accessibilityLabel={`${thread.unread} unread ${thread.unread === 1 ? "message" : "messages"}`}
                  style={styles.unreadDot}
                />
              )}
            </View>
            <Text testID="thread-time" numberOfLines={1} style={styles.threadTime}>{thread.time ?? formatThreadTime(thread.timestamp ?? 0)}</Text>
          </View>
        </View>
        <View style={styles.threadPreviewLine}>
          <Text testID="thread-preview" numberOfLines={1} style={styles.threadPreview}>{plainThreadPreview(thread.preview)}</Text>
        </View>
      </View>
    </GesturePressable>
    </ThreadRowCommitBoundary>
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

function ThreadRowCommitBoundary({ children }: { children: ReactNode }) {
  if (!operationalDiagnosticsEnabled()) return <>{children}</>;
  const onCommit = () => {
    incrementDiagnosticMetric("thread_row_commits");
  };
  return <>{children}<EveryCommitProbe onCommit={onCommit} /></>;
}

function ThreadNavigationRowCommitBoundary({
  connectionId,
  threadId,
  rowKey,
  children,
}: {
  connectionId: string;
  threadId: string;
  rowKey: string;
  children: ReactNode;
}) {
  if (!isThreadNavigationActiveFor(connectionId, threadId)) return <>{children}</>;
  return <>{children}<EveryCommitProbe onCommit={() => recordThreadNavigationRowCommit(connectionId, threadId, rowKey)} /></>;
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
  onLoadMore,
  initialOffset,
  onOffsetChange,
  onSelectThread,
  onPreloadThread,
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
  servers: ThreadListServer[];
  activeServerId: string;
  threads: ThreadListItem[];
  archivedThreads: ThreadListItem[];
  mode: ThreadListMode;
  query: string;
  onQueryChange(query: string): void;
  onModeChange(mode: ThreadListMode): void;
  onLoadMore(): void;
  initialOffset: number;
  onOffsetChange(offset: number): void;
  onSelectThread(id: string): void;
  onPreloadThread(id: string): (() => void) | undefined;
  onSelectServer(id: string): void;
  onAddServer(): void;
  onNewThread(): void;
  onSettings(): void;
  onTogglePin(thread: ThreadListItem): Promise<void>;
  onArchive(thread: ThreadListItem): Promise<void>;
  onUnarchive(thread: ThreadListItem): Promise<void>;
  onMarkRead(thread: ThreadListItem): Promise<void>;
  accountRateLimits?: AccountRateLimitsRow | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  const windowLayout = useWindowLayout();
  const hideThreadLists = usePerformanceExperiment("hideThreadLists");
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
            <TopBarAction icon="create-outline" accessibilityLabel="New thread" onPress={onNewThread} />
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
      {hideThreadLists ? <ThreadListExperimentSuspended /> : <LegendList
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
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        scrollEventThrottle={100}
        keyExtractor={(item) => item.kind === "header" ? `header-${item.title}` : threadSelectionKey(item.thread)}
        ListEmptyComponent={<ThreadListEmpty archived={mode === "archived"} />}
        renderItem={({ item }) => (
          item.kind === "header" ? <Text style={styles.sectionHeader}>{item.title}</Text> : <ThreadRow
              thread={item.thread}
              selected={false}
              onPressIn={() => onPreloadThread(threadSelectionKey(item.thread))}
              onPress={() => onSelectThread(threadSelectionKey(item.thread))}
              onTogglePin={() => onTogglePin(item.thread)}
              onArchive={() => onArchive(item.thread)}
              onUnarchive={() => onUnarchive(item.thread)}
              onMarkRead={() => onMarkRead(item.thread)}
            />
        )}
      />}
      <MobileServerSheet
        visible={serverPickerVisible}
        servers={servers}
        activeServerId={activeServerId}
        onSelect={(id) => { onSelectServer(id); setServerPickerVisible(false); }}
        onAddServer={() => { setServerPickerVisible(false); onAddServer(); }}
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

function MobileServerSheet({ visible, servers, activeServerId, onSelect, onAddServer, onSettings, onClose }: { visible: boolean; servers: ThreadListServer[]; activeServerId: string; onSelect(id: string): void; onAddServer(): void; onSettings(): void; onClose(): void }) {
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
      <MenuAction icon="add" title="Add server" subtitle="Pair another host" onPress={onAddServer} />
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
  const clock = useSecondClock(phase === "recording");

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

function ComposerControlChips({
  resources,
  resourceId,
  cwd,
  remoteThread,
  readOnly,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  error,
  load,
  onQuickOpen,
  onFallback,
  onClose,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
  onSelectPermissions,
}: {
  resources: WorkspaceResourceDatabase | null;
  resourceId: string | null;
  cwd: string;
  remoteThread: Thread | null | undefined;
  readOnly: boolean;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedPersonality: Personality | null;
  selectedPermissions: string | null;
  error: string | null;
  load?: (cwd: string) => Promise<TurnControls>;
  onQuickOpen(scope: "model-menu" | "permissions-menu"): void;
  onFallback(page: "model" | "permissions"): void;
  onClose(scope: "model-menu" | "permissions-menu"): void;
  onSelectModel(model: string, effort: string): void;
  onSelectEffort(effort: string): void;
  onSelectPersonality(personality: Personality | null): void;
  onSelectPermissions(permissions: string): void;
}) {
  const resource = useTurnControlsRow(resources, resourceId);
  useAsyncResource<TurnControls>(
    load === undefined || resourceId === null ? null : "conversation-turn-controls",
    resourceId ?? "inactive",
    async () => load === undefined ? EMPTY_TURN_CONTROLS : await load(cwd),
  );
  const controls = resource?.value ?? EMPTY_TURN_CONTROLS;
  const loading = resource?.status === "loading" && resource.value === null;
  const refreshing = resource?.status === "loading" || resource?.status === "refreshing";
  const pending = load !== undefined && (resource === null || refreshing);
  const effectiveError = error ?? resource?.error ?? null;
  const serverExecution = remoteThread === null || remoteThread === undefined ? null : latestProjectedThreadExecutionSettings(remoteThread);
  const catalogDefaultModel = controls.models.find((candidate) => candidate.isDefault) ?? null;
  const effectiveModel = selectedModel ?? serverExecution?.model ?? controls.defaults.model ?? catalogDefaultModel?.id ?? null;
  const effectiveModelCatalog = controls.models.find((candidate) => candidate.id === effectiveModel) ?? null;
  const effectiveEffort = selectedEffort
    ?? serverExecution?.effort
    ?? (selectedModel === null && serverExecution?.model == null ? controls.defaults.effort : null)
    ?? effectiveModelCatalog?.defaultEffort
    ?? null;
  const effectivePermissions = selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  const modelLabel = controls.models.find((candidate) => candidate.id === effectiveModel)?.label ?? effectiveModel ?? (pending ? "Loading model…" : "Model unavailable");
  const permissionLabel = effectivePermissions === null ? executionPermissionsLabel(serverExecution, pending) : permissionProfileLabel(effectivePermissions);
  const modelPending = pending && effectiveModel === null;
  const permissionsPending = pending && effectivePermissions === null;
  return <>
    {readOnly ? <View testID="readonly-model-chip" style={styles.composerContextChip}>
      <Ionicons name="sparkles-outline" size={15} color={colors.textMuted} />
      <ComposerContextLabel loading={modelPending} testID="composer-model-label" text={modelPending ? "Loading model…" : `${modelLabel} · ${effectiveEffort ?? "default"}`} />
    </View> : <ModelThinkingMenu
      accessibilityLabel={`Model and thinking: ${modelLabel}, ${effectiveEffort ?? "server default"}`}
      triggerStyle={styles.composerContextChip}
      triggerChildren={<><Ionicons name="sparkles-outline" size={15} color={colors.textMuted} /><ComposerContextLabel loading={modelPending} testID="composer-model-label" text={modelPending ? "Loading model…" : `${modelLabel} · ${effectiveEffort ?? "default"}`} /></>}
      models={controls.models}
      loading={loading}
      error={effectiveError}
      selectedModel={effectiveModel}
      selectedEffort={effectiveEffort}
      selectedPersonality={selectedPersonality}
      onOpen={() => onQuickOpen("model-menu")}
      onClose={() => onClose("model-menu")}
      onFallbackPress={() => onFallback("model")}
      onSelectModel={onSelectModel}
      onSelectEffort={onSelectEffort}
      onSelectPersonality={onSelectPersonality}
    />}
    {readOnly ? <View testID="readonly-permissions-chip" style={styles.composerContextChip}>
      <Ionicons name="shield-checkmark-outline" size={15} color={colors.textMuted} />
      <ComposerContextLabel loading={permissionsPending} testID="composer-permissions-label" text={permissionsPending ? "Loading access…" : permissionLabel} />
    </View> : <PermissionsMenu
      accessibilityLabel={`Permissions: ${permissionLabel}`}
      triggerStyle={styles.composerContextChip}
      triggerChildren={<><Ionicons name="shield-checkmark-outline" size={15} color={colors.textMuted} /><ComposerContextLabel loading={permissionsPending} testID="composer-permissions-label" text={permissionsPending ? "Loading access…" : permissionLabel} /></>}
      permissions={controls.permissions}
      loading={loading}
      error={effectiveError}
      selectedPermissions={effectivePermissions}
      onOpen={() => onQuickOpen("permissions-menu")}
      onClose={() => onClose("permissions-menu")}
      onFallbackPress={() => onFallback("permissions")}
      onSelectPermissions={onSelectPermissions}
    />}
  </>;
}

function ComposerPortContextChip({ connectionId, onOpen }: { connectionId: string | null; onOpen(): void }) {
  if (connectionId === null) return null;
  return <ComposerPortContextChipLoaded connectionId={connectionId} onOpen={onOpen} />;
}

function ComposerPortContextChipLoaded({ connectionId, onOpen }: { connectionId: string; onOpen(): void }) {
  const snapshot = useNativePortForwarding(connectionId);
  if (snapshot.profiles.length === 0) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Ports: ${snapshot.profiles.length}`} onPress={onOpen} style={styles.composerContextChip}>
    <Ionicons name="git-network-outline" size={15} color={snapshot.profiles.some(({ status }) => status === "live") ? colors.green : colors.textMuted} />
    <ComposerContextCount label="Ports" value={snapshot.profiles.length} testID="composer-ports-label" />
  </Pressable>;
}

function ComposerTerminalContextChip({ connectionId, threadId, onOpen }: { connectionId: string | null; threadId: string | null; onOpen(): void }) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  if (workspace.tabs.length === 0) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Terminals: ${workspace.tabs.length}`} onPress={onOpen} style={styles.composerContextChip}>
    <Ionicons name="terminal-outline" size={15} color={workspace.tabs.some(({ status }) => status === "open") ? colors.green : colors.textMuted} />
    <ComposerContextCount label="Terminals" value={workspace.tabs.length} testID="composer-terminals-label" />
  </Pressable>;
}

function ComposerSubagentContextChip({ database, connectionId, parentThreadId, onOpen }: {
  database: ThreadSummaryDatabase | null;
  connectionId: string | null;
  parentThreadId: string | null;
  onOpen(summaries: readonly StoredThreadSummary[]): void;
}) {
  if (database === null || connectionId === null || parentThreadId === null) return null;
  return <Suspense fallback={null}><ComposerSubagentContextChipLoaded database={database} connectionId={connectionId} parentThreadId={parentThreadId} onOpen={onOpen} /></Suspense>;
}

function ComposerSubagentContextChipLoaded({ database, connectionId, parentThreadId, onOpen }: {
  database: ThreadSummaryDatabase;
  connectionId: string;
  parentThreadId: string;
  onOpen(summaries: readonly StoredThreadSummary[]): void;
}) {
  const view = useThreadSummaryView(database, {
    viewId: `subagents:${connectionId}:${parentThreadId}`,
    connectionId: null,
    recentLimit: 0,
    archivedLimit: 0,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: connectionId,
    subagentLimit: SUBAGENT_LIST_LIMIT,
  });
  const [projection] = useState(() => new SubagentListProjection());
  const summaries = projection.project(view?.subagents ?? []);
  const visible = subagentsForThread(summaries, parentThreadId);
  if (visible.length === 0) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Subagents: ${visible.length}`} onPress={() => onOpen(summaries)} style={styles.composerContextChip}>
    <Ionicons name="people-outline" size={15} color={visible.some((summary) => summary.status.type === "active") ? colors.green : colors.textMuted} />
    <ComposerContextCount label="Subagents" value={visible.length} />
  </Pressable>;
}

function ConversationPane({
  thread,
  server,
  newChat = false,
  compact = false,
  readOnly = false,
  onBack,
  remoteThread,
  accountRateLimits = null,
  onRefreshAccountRateLimits,
  remoteSealedTurns,
  remoteLiveTurns,
  historyViewport = COMPLETE_STATIC_THREAD_HISTORY,
  onLoadTurnItems,
  pendingDeliveries = [],
  queuedPrompts = [],
  composerState = null,
  historyRestoreReady = true,
  workspaceResources = null,
  controlsResourceId = null,
  backgroundTerminalsResourceId = null,
  threadResourcesModel = null,
  threadResourceId = null,
  threadResourceRevision = "default",
  goalResourceId = null,
  tunnelResourceId = null,
  portForwardingConnectionId = null,
  portForwardingServerName = "Server",
  onOpenPortForward,
  onOpenLoopbackLink,
  voiceResource = null,
  reviewVoiceResource = null,
  voiceController = null,
  fileTransferResource = null,
  fileTransferController = null,
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
  discoveredProjects = [],
  projectLoadError = null,
  onChangeProject,
  workspaceSupport = null,
  workspaceMode = "current",
  onChangeWorkspaceMode,
  onAddProject,
  onReadDirectory,
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
  thread: ThreadListItem | null;
  server: ThreadListServer | undefined;
  newChat?: boolean;
  compact?: boolean;
  readOnly?: boolean;
  onBack?(): void;
  remoteThread?: Thread | null;
  accountRateLimits?: AccountRateLimitsRow | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
  remoteSealedTurns?: readonly Thread["turns"][number][];
  remoteLiveTurns?: readonly Thread["turns"][number][];
  historyViewport?: ThreadHistoryViewport;
  onLoadTurnItems?(turnId: string): Promise<void>;
  pendingDeliveries?: Array<NativeCommandDelivery & { attachments?: ComposerAttachment[] }>;
  queuedPrompts?: QueuedPrompt[];
  composerState?: ThreadUiStateRow | null;
  historyRestoreReady?: boolean;
  workspaceResources?: WorkspaceResourceDatabase | null;
  controlsResourceId?: string | null;
  backgroundTerminalsResourceId?: string | null;
  threadResourcesModel?: ThreadResourcesModel | null;
  threadResourceId?: string | null;
  threadResourceRevision?: string;
  goalResourceId?: string | null;
  tunnelResourceId?: string | null;
  portForwardingConnectionId?: string | null;
  portForwardingServerName?: string;
  onOpenPortForward?(title: string, url: string): void;
  onOpenLoopbackLink?(target: LoopbackLinkTarget): Promise<void>;
  voiceResource?: VoiceInputRow | null;
  reviewVoiceResource?: VoiceInputRow | null;
  voiceController?: VoiceInputController | null;
  fileTransferResource?: FileTransferRow | null;
  fileTransferController?: FileTransferController | null;
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
  saveScrollOffset?(connectionId: string, threadId: string, offset: number, historyAnchorTurnId: string | null, historyAnchorOffsetPx: number | null): Promise<void>;
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
  projects?: readonly RemoteProject[];
  discoveredProjects?: readonly RemoteProject[];
  projectLoadError?: string | null;
  onChangeProject?(cwd: string | null): Promise<void>;
  workspaceSupport?: WorkspaceSupport | null;
  workspaceMode?: NewChatWorkspaceMode;
  onChangeWorkspaceMode?(mode: NewChatWorkspaceMode): void;
  onAddProject?(path: string): Promise<RemoteProject>;
  onReadDirectory?(path: string): Promise<RemoteDirectoryEntry[]>;
  onLoadControls?(cwd: string): Promise<TurnControls>;
  onUpdateSettings?(settings: ThreadSettings): Promise<void>;
  onInterrupt?(turnId: string): Promise<void>;
  onListQueue?(): Promise<QueuedPrompt[]>;
  onEditQueued?(commandId: string, text: string, attachments: ComposerAttachment[]): Promise<void>;
  onCancelQueued?(commandId: string): Promise<void>;
  onMoveQueued?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteerQueued?(commandId: string, expectedTurnId: string): Promise<void>;
  onListTerminals?(): Promise<BackgroundTerminal[]>;
  onLoadThreadResources?(scope?: ThreadChangeScope, kind?: "all" | "changes" | "attachments"): Promise<ThreadResourcesValue>;
  onLoadThreadChangeDiff?(path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue>;
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
  const parentVoiceInputRuntime = useAppVoiceInputRuntime();
  const conversationInsets = useSafeAreaInsets();
  const openDocument = useDocumentPreview();
  const downloadDocument = useDocumentDownload();
  const draftConnectionId = server?.id ?? null;
  const draftThreadId = thread?.id ?? null;
  const composerScope = `${draftConnectionId ?? "no-connection"}\u0000${draftThreadId ?? "no-thread"}`;
  const appVoiceInputRuntime: AppVoiceInputRuntime = {
    controller: parentVoiceInputRuntime?.controller ?? voiceController,
    resources: parentVoiceInputRuntime?.resources ?? null,
    scopePrefix: composerScope,
    thread: remoteThread ?? null,
    ...(onStartVoiceTranscription === undefined ? {} : { startRemote: onStartVoiceTranscription }),
  };
  const conversationOwner = useConversationOwner(composerScope);
  const [changesPreferencesState, setChangesPreferencesState] = useState(() => ({
    key: composerScope,
    value: readChangesPreferences(composerScope),
  }));
  const changesPreferences = changesPreferencesState.key === composerScope
    ? changesPreferencesState.value
    : readChangesPreferences(composerScope);
  const setChangesPreferences = (next: ChangesPreferences) => {
    changesPreferencesByThread.set(composerScope, next);
    setChangesPreferencesState({ key: composerScope, value: next });
  };
  const currentControlsResource = (): TurnControlsRow | null => workspaceResources === null || controlsResourceId === null
    ? null
    : workspaceResources.turnControls.get(controlsResourceId) ?? null;
  const controlsResource = currentControlsResource();
  const [narrowConversationPane, setNarrowConversationPane] = useState(false);
  const timelineCompact = compact || narrowConversationPane;
  const [composerTrayVisible, setComposerTrayVisible] = useState(false);
  const [threadResourceSheet, setThreadResourceSheet] = useState<"changes" | "attachments" | null>(null);
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectChangeBusy, setProjectChangeBusy] = useState(false);
  const [projectChangeError, setProjectChangeError] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuInitialPage, setMenuInitialPage] = useState<ComposerMenuPage>("model");
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_MIN_HEIGHT);
  const composerInputWidthRef = useRef(0);
  const [pastedAttachmentPending, setPastedAttachmentPending] = useState(false);
  const pastedAttachmentPendingRef = useRef(false);
  const largePasteOperationRef = useRef<({
    scope: string;
    connectionId: string | null;
    threadId: string | null;
    capture: ClipboardLargePasteCapture;
  }) | null>(null);
  const voicePhase = voiceResource?.phase ?? "idle";
  const voiceBackend = voiceResource?.backend ?? "remote";
  const voiceError = voiceResource?.error ?? null;
  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;
  const pendingVoiceSelection = voiceResource?.pendingSelection ?? null;
  const controls = controlsResource?.value ?? EMPTY_TURN_CONTROLS;
  const [controlError, setControlError] = useState<string | null>(null);

  const draft = composerState?.draftText ?? "";
  const visibleComposerInputHeight = draft === "" ? COMPOSER_MIN_HEIGHT : composerInputHeight;
  const attachments = composerState?.attachments ?? EMPTY_COMPOSER_ATTACHMENTS;
  const composerPreferences = composerState?.preferences ?? EMPTY_COMPOSER_PREFERENCES;
  const latestComposerValues = useComposerLatestValues(composerScope, draft, attachments, composerPreferences);
  const latestDraftRef = latestComposerValues.draft;
  const latestAttachmentsRef = latestComposerValues.attachments;
  const latestComposerPreferencesRef = latestComposerValues.preferences;
  const [contentReviewAttachmentIds, setContentReviewAttachmentIds] = useState(() => new Map<string, string>());
  const contentReviewAttachmentId = contentReviewAttachmentIds.get(composerScope) ?? null;
  const setContentReviewAttachmentId = (scope: string, attachmentId: string | null) => {
    setContentReviewAttachmentIds((current) => {
      if ((current.get(scope) ?? null) === attachmentId) return current;
      const next = new Map(current);
      if (attachmentId === null) next.delete(scope);
      else next.set(scope, attachmentId);
      return next;
    });
  };
  const clearContentReviewAttachmentId = (scope: string, expectedAttachmentId: string) => {
    setContentReviewAttachmentIds((current) => {
      if (current.get(scope) !== expectedAttachmentId) return current;
      const next = new Map(current);
      next.delete(scope);
      return next;
    });
  };
  const currentThreadResources = (): ThreadResourcesRow | null => threadResourcesModel === null || threadResourceId === null
    ? null
    : threadResourcesModel.get(threadResourceId) ?? null;
  const currentChangePresentation = () => {
    const resource = currentThreadResources()?.value ?? null;
    const scopes = resource?.changeScopes ?? ["session" as const, "lastTurn" as const];
    const scope = changesPreferences.scope !== null && scopes.includes(changesPreferences.scope)
      ? changesPreferences.scope
      : resource?.changeScope ?? scopes[0] ?? "session";
    return { resource, scopes, scope };
  };
  const composerStateMissing = composerState === null;
  const updateComposerPreferences = (apply: (current: StoredComposerPreferences) => StoredComposerPreferences) => {
    const next = apply(latestComposerPreferencesRef.current.latest);
    latestComposerPreferencesRef.current.latest = next;
    if (saveComposerPreferences !== undefined && draftConnectionId !== null && draftThreadId !== null) {
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
  const timelineViewportRef = useRef<View | null>(null);
  const latestUnreadAgentRef = useRef<View | null>(null);
  const unreadVisibilityFrameRef = useRef<number | null>(null);
  const unreadVisibilityScheduledKeyRef = useRef<string | null>(null);
  const latestUnreadReceiptKeyRef = useRef<string | null>(null);
  const acknowledgedUnreadReceiptKeyRef = useRef<string | null>(null);
  const settingsMutationRef = useRef({ model: 0, effort: 0, permissions: 0 });
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelinePositionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineIndexRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchOriginOffsetRef = useRef<number | null>(null);
  const timelineInteractionScopeRef = useRef("");
  const residentRangeMoveInFlightRef = useRef(false);
  const pendingResidentRangeMoveRef = useRef<{ turnId: string; direction: ResidentRangeDirection; move: ThreadHistoryViewport["move"] } | null>(null);
  const scrollGestureActiveRef = useRef(false);
  const scrollDirectionRef = useRef<ResidentRangeDirection | null>(null);
  const firstVisibleHistoryAnchorRef = useRef<string | null>(null);
  const firstVisibleHistoryAnchorKeyRef = useRef<string | null>(null);
  const lastTimelineOffsetYRef = useRef<number | null>(null);
  const onTimelineFirstVisibleItemChanged = ({ index, item }: { index: number; item: TimelineItem; key: string }) => {
    const anchor = item.kind === "turn"
      ? item
      : timeline.slice(index + 1).find((candidate): candidate is Extract<TimelineItem, { kind: "turn" }> => candidate.kind === "turn") ?? null;
    firstVisibleHistoryAnchorRef.current = anchor?.id ?? null;
    firstVisibleHistoryAnchorKeyRef.current = anchor === null ? null : timelineItemKey(anchor);
    const turnId = anchor?.id ?? null;
    const direction = scrollDirectionRef.current;
    if (turnId !== null
      && direction !== null
      && scrollGestureActiveRef.current
      && timelineInteractionScopeRef.current === composerScope) {
      requestResidentRangeMove(turnId, direction, historyViewport.move);
    }
  };
  function requestResidentRangeMove(turnId: string, direction: ResidentRangeDirection, move: ThreadHistoryViewport["move"]): void {
    if (residentRangeMoveInFlightRef.current) {
      pendingResidentRangeMoveRef.current = { turnId, direction, move };
      return;
    }
    residentRangeMoveInFlightRef.current = true;
    void move(turnId, direction).finally(() => {
      residentRangeMoveInFlightRef.current = false;
      const pending = pendingResidentRangeMoveRef.current;
      pendingResidentRangeMoveRef.current = null;
      if (pending !== null && scrollGestureActiveRef.current) {
        requestResidentRangeMove(pending.turnId, pending.direction, pending.move);
      }
    });
  }
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
  const initialRestoreOffset = historyRestoreReady ? sessionConversationScrollOffsets.get(composerScope) ?? composerState?.scrollOffset ?? 0 : null;
  const pendingRestoreOffsetRef = useRef<number | null>(initialRestoreOffset);
  const initialSessionHistoryAnchor = sessionConversationHistoryAnchors.get(composerScope);
  const initialRestoreAnchorTurnId = historyRestoreReady ? initialSessionHistoryAnchor?.turnId ?? composerState?.historyAnchorTurnId ?? null : null;
  const pendingRestoreAnchorTurnIdRef = useRef<string | null>(initialRestoreAnchorTurnId);
  const pendingRestoreAnchorOffsetRef = useRef<number | null>(historyRestoreReady ? initialSessionHistoryAnchor?.viewportOffsetPx ?? composerState?.historyAnchorOffsetPx ?? null : null);
  const [composerDockHeight, setComposerDockHeight] = useState(touchTarget + 12);
  const [timelineDidPosition, setTimelineDidPosition] = useState(false);
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
  const liveTurnPlan = selectLiveTurnPlan(remoteThread, currentTurnId);
  const serverExecution = remoteThread === null || remoteThread === undefined ? null : latestProjectedThreadExecutionSettings(remoteThread);
  const catalogDefaultModel = controls.models.find((candidate) => candidate.isDefault) ?? null;
  const effectiveModel = selectedModel ?? serverExecution?.model ?? controls.defaults.model ?? catalogDefaultModel?.id ?? null;
  const serverBackedSettings = onUpdateSettings !== undefined;

  const projectedPendingDeliveries = measureThreadNavigationWork(draftConnectionId ?? "", draftThreadId, "project_pending_deliveries", () => {
    if (draftConnectionId === null || draftThreadId === null) return [];
    return pendingDeliveries.flatMap((delivery) => {
      if (delivery.connectionId !== draftConnectionId || (delivery.method !== "turn/start" && delivery.method !== "turn/steer")) return [];
      if (delivery.threadId !== draftThreadId) return [];
      return [{
        scope: composerScope,
        id: delivery.commandId,
        text: delivery.text,
        attachments: delivery.attachments ?? [],
        ...(delivery.workspaceRequestId === undefined ? {} : { workspaceRequestId: delivery.workspaceRequestId }),
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
  }, { values: { deliveryCount: pendingDeliveries.length } });

  // The Legend thread timeline is the only optimistic-message source.
  // Kotlin owns durable delivery; React only renders the unified projection.
  const optimistic = projectedPendingDeliveries.slice(-MAX_OPTIMISTIC_MESSAGES);

  const requestControls = () => {
    const current = currentControlsResource();
    if (onLoadControls === undefined || (current?.status === "loading" && current.value === null)) return;
    setControlError(null);
    void onLoadControls(cwd).then((next) => {
      if (!conversationOwner.isCurrent()) return;
      setSelectedModel((current) => current !== null && !next.models.some((candidate) => candidate.id === current) ? null : current);
      setSelectedEffort((current) => current !== null && !next.models.some((candidate) => candidate.efforts.includes(current)) ? null : current);
    }).catch((cause) => {
      if (!conversationOwner.isCurrent()) return;
      setControlError(cause instanceof Error ? cause.message : "Could not load turn controls");
    });
  };

  const timelineRemoteThreadId = remoteThread?.id;
  const sealedTimeline = remoteSealedTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_sealed_timeline",
          () => projectTimelineTurns(remoteSealedTurns, composerScope, server?.id ?? "remote", timelineRemoteThreadId),
          { values: { turnCount: remoteSealedTurns.length } },
        );
  const liveTimeline = remoteLiveTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_live_timeline",
          () => projectTimelineTurns(remoteLiveTurns, composerScope, server?.id ?? "remote", timelineRemoteThreadId, thread?.state),
          { values: { turnCount: remoteLiveTurns.length } },
        );
  const fullTimeline = remoteThread === null || remoteThread === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_full_timeline",
          () => projectTimelineTurns(remoteThread.turns, composerScope, server?.id ?? "remote", remoteThread.id, thread?.state),
          { values: { turnCount: remoteThread.turns.length } },
        );
  const completeTurnHeadersResident = remoteThread !== null
    && remoteThread !== undefined
    && historyViewport.completeTurnHeaders;
  const sessionCompactionCount = completeTurnHeadersResident
    && remoteThread.turns.every((candidate) => candidate.itemsView === "full")
      ? remoteThread.turns.reduce(
          (count, candidate) => count + candidate.items.filter((item) => item.type === "contextCompaction").length,
          0,
        )
      : null;
  const timeline: TimelineItem[] = measureThreadNavigationWork(draftConnectionId ?? "", draftThreadId, "assemble_timeline", () => {
    const partitioned = remoteSealedTurns !== undefined && remoteLiveTurns !== undefined;
    const content: TimelineItem[] = remoteThread === null || remoteThread === undefined
      ? []
      : partitioned
        ? mergeProjectedThreadPartitions(remoteThread.turns, sealedTimeline, liveTimeline)
        : fullTimeline;
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
  }, { values: { sealedItemCount: sealedTimeline.length, liveItemCount: liveTimeline.length, fullItemCount: fullTimeline.length } });
  const latestUnreadAgentTurnId = measureThreadNavigationWork(draftConnectionId ?? "", draftThreadId, "scan_unread_agent_turn", () => {
    if (unread <= 0) return null;
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item?.kind !== "turn" || item.turn.status === "inProgress") continue;
      if (selectTurnRenderWindow(item.turn).latestAgentIndex >= 0) return item.id;
    }
    return null;
  }, { values: { itemCount: timeline.length } });
  const latestUnreadReceiptKey = latestUnreadAgentTurnId === null
    ? null
    : `${composerScope}\u0000${latestUnreadAgentTurnId}`;
  const acknowledgeUnreadReceipt = useEvent((receiptKey: string) => {
    const claimed = claimUnreadReceipt(
      latestUnreadReceiptKeyRef.current,
      acknowledgedUnreadReceiptKeyRef.current,
      receiptKey,
    );
    if (claimed === null) return;
    acknowledgedUnreadReceiptKeyRef.current = claimed;
    onViewedLatest?.();
  });
  const checkUnreadAgentVisibility = useEvent((receiptKey: string) => {
    const viewport = timelineViewportRef.current;
    const agent = latestUnreadAgentRef.current;
    if (viewport === null || agent === null) return;
    if (acknowledgedUnreadReceiptKeyRef.current === receiptKey) return;
    viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
      agent.measureInWindow((_agentX, agentY, _agentWidth, agentHeight) => {
        if (latestUnreadReceiptKeyRef.current !== receiptKey) return;
        if (!shouldMarkAgentResponseRead(agentY, agentHeight, viewportY, viewportHeight)) return;
        acknowledgeUnreadReceipt(receiptKey);
      });
    });
  });
  const scheduleUnreadAgentVisibilityCheck = useEvent(() => {
    const receiptKey = latestUnreadReceiptKey;
    latestUnreadReceiptKeyRef.current = receiptKey;
    if (receiptKey === null) {
      if (unreadVisibilityFrameRef.current !== null) cancelAnimationFrame(unreadVisibilityFrameRef.current);
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
      return;
    }
    if (unreadVisibilityFrameRef.current !== null) {
      if (unreadVisibilityScheduledKeyRef.current === receiptKey) return;
      cancelAnimationFrame(unreadVisibilityFrameRef.current);
    }
    unreadVisibilityScheduledKeyRef.current = receiptKey;
    unreadVisibilityFrameRef.current = requestAnimationFrame(() => {
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
      checkUnreadAgentVisibility(receiptKey);
    });
  });
  const commitUnreadReceipt = () => {
    latestUnreadReceiptKeyRef.current = latestUnreadReceiptKey;
    if (latestUnreadReceiptKey === null) acknowledgedUnreadReceiptKeyRef.current = null;
    scheduleUnreadAgentVisibilityCheck();
    return () => {
      if (unreadVisibilityFrameRef.current !== null) cancelAnimationFrame(unreadVisibilityFrameRef.current);
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
    };
  };
  const setLatestUnreadAgentNode = (node: View | null) => {
    latestUnreadAgentRef.current = node;
    if (node !== null) scheduleUnreadAgentVisibilityCheck();
  };
  const timelinePositioned = timeline.length === 0
    ? historyViewport.status !== "idle" && historyViewport.status !== "initial-loading"
    : timelineDidPosition;
  const timelineModelReady = remoteThread !== null || historyViewport.status !== "initial-loading";

  const visibleQueuedPrompts = queuedPrompts;
  const inlineQueue = visibleQueuedPrompts.map((entry) => ({ id: entry.commandId, text: entry.text, state: entry.state }));

  const deferredThreadSearch = useDeferredValue(threadSearch);
  const threadSearchMatches = (() => {
    const query = deferredThreadSearch.trim().toLocaleLowerCase();
    if (query === "") return [];
    return timeline.flatMap((item, index) => timelineSearchText(item).toLocaleLowerCase().includes(query) ? [index] : []);
  })();
  const threadSearchActive = threadSearch.trim() !== "";
  const liveTurnPlanVisible = liveTurnPlan !== null && timelinePositioned && !threadSearchActive;
  const displayedTimeline = threadSearchActive
    ? threadSearchMatches.flatMap((index) => timeline[index] === undefined ? [] : [timeline[index]])
    : timeline;
  const initialHistoryAnchorTurnId = initialSessionHistoryAnchor?.turnId ?? composerState?.historyAnchorTurnId ?? null;
  const initialHistoryAnchorIndex = initialHistoryAnchorTurnId === null
    ? -1
    : timeline.findIndex((item) => item.kind === "turn" && item.id === initialHistoryAnchorTurnId);
  const timelineInitialPosition: TimelineInitialPosition = initialHistoryAnchorIndex < 0
    ? { kind: "tail" }
    : {
        kind: "item",
        index: initialHistoryAnchorIndex,
        viewOffset: initialSessionHistoryAnchor?.viewportOffsetPx ?? composerState?.historyAnchorOffsetPx ?? 0,
        viewPosition: 0,
      };
  const emptyRemoteThread = newChat || (remoteThread !== null
    && remoteThread !== undefined
    && remoteThread.turns.length === 0
    && optimistic.length === 0);
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
      const { resource } = currentChangePresentation();
      if (onLoadThreadResources === undefined) {
        if (resource === null) return;
        presentThreadChanges(resource);
        return;
      }
      presentThreadChanges(resource, true);
      return;
    }
    timelineOverlay.begin("thread-resources");
    dismissComposerKeyboardForOverlay();
    setThreadResourceSheet("attachments");
    void onLoadThreadResources?.(undefined, "attachments").catch(() => undefined);
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
    const row = (
    // The virtualized row owns one stable document identity. Recycling is off,
    // so leaving the render window unmounts this subtree instead of rebinding
    // its markdown/activity state to a different turn.
    <RecoverableRenderBoundary key={boundaryKey} scope="bubble" label="Conversation item" context={boundaryContext} resetKey={boundaryKey}>
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
          {...(item.id === latestUnreadAgentTurnId ? {
            latestAgentRef: setLatestUnreadAgentNode,
            onLatestAgentLayout: scheduleUnreadAgentVisibilityCheck,
          } : {})}
        />
      )}
      {item.kind === "optimistic" && <OptimisticTurn item={item} {...(onRetryFailedMessage === undefined ? {} : { onRetry: onRetryFailedMessage })} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />}
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
    return item.kind === "turn"
      ? <ThreadNavigationRowCommitBoundary connectionId={item.connectionId} threadId={item.threadId} rowKey={item.key}>{row}</ThreadNavigationRowCommitBoundary>
      : row;
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
    const pendingAnchorTurnId = pendingRestoreAnchorTurnIdRef.current;
    if (pendingAnchorTurnId !== null) {
      const anchorIndex = timeline.findIndex((item) => item.kind === "turn" && item.id === pendingAnchorTurnId);
      if (anchorIndex < 0 && !historyRestoreReady) return;
      if (anchorIndex >= 0) {
        const anchorOffset = pendingOffset;
        pendingRestoreOffsetRef.current = null;
        pendingRestoreAnchorTurnIdRef.current = null;
        pendingRestoreAnchorOffsetRef.current = null;
        // LegendList fires onLoad only after both container layout and its
        // bootstrap initial scroll have completed. A second animation frame
        // here delayed presentation without changing the native position.
        scrollOffsetRef.current = anchorOffset;
        updateFollowingLatest(false);
        awayFromLatestRef.current = true;
        setAwayFromLatest(true);
        scrollRestoredRef.current = true;
        if (draftConnectionId !== null && draftThreadId !== null) {
          markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_positioned", {
            values: {
              itemCount: timeline.length,
              restoredOffsetPx: anchorOffset,
              contentHeightPx: resolvedHeight,
              viewportHeightPx: timelineViewportHeightRef.current,
            },
            tags: { restore: "semantic_anchor" },
          });
          recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_position_applied", {
            values: {
              itemCount: timeline.length,
              restoredOffsetPx: anchorOffset,
              contentHeightPx: resolvedHeight,
              viewportHeightPx: timelineViewportHeightRef.current,
            },
            tags: { restore: "semantic_anchor" },
          });
        }
        setTimelineDidPosition(true);
        return;
      }
      // The stored turn was evicted or deleted. The anchor query has settled,
      // so fall back to the live tail instead of keeping the chat concealed.
      pendingRestoreAnchorTurnIdRef.current = null;
      pendingRestoreAnchorOffsetRef.current = null;
      pendingRestoreOffsetRef.current = 0;
      scrollOffsetRef.current = 0;
      updateFollowingLatest(true);
      awayFromLatestRef.current = false;
      setAwayFromLatest(false);
      scrollRestoredRef.current = true;
      if (draftConnectionId !== null && draftThreadId !== null) {
        markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_positioned", {
          values: {
            itemCount: timeline.length,
            restoredOffsetPx: 0,
            contentHeightPx: resolvedHeight,
            viewportHeightPx: timelineViewportHeightRef.current,
          },
          tags: { restore: "missing_anchor_fallback" },
        });
        recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_position_applied", {
          values: {
            itemCount: timeline.length,
            restoredOffsetPx: 0,
            contentHeightPx: resolvedHeight,
            viewportHeightPx: timelineViewportHeightRef.current,
          },
          tags: { restore: "missing_anchor_fallback" },
        });
      }
      setTimelineDidPosition(true);
      return;
    }
    // Legacy rows only stored a distance from the end. Reconstructing a global
    // pixel offset requires measuring every historical row and defeats bounded
    // windowing, so old rows intentionally fall back to the live tail.
    scrollOffsetRef.current = 0;
    updateFollowingLatest(true);
    awayFromLatestRef.current = false;
    setAwayFromLatest(false);
    pendingRestoreOffsetRef.current = null;
    pendingRestoreAnchorTurnIdRef.current = null;
    pendingRestoreAnchorOffsetRef.current = null;
    scrollRestoredRef.current = true;
    if (draftConnectionId !== null && draftThreadId !== null) {
      markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_positioned", {
        values: {
          itemCount: timeline.length,
          restoredOffsetPx: 0,
          contentHeightPx: resolvedHeight,
          viewportHeightPx: timelineViewportHeightRef.current,
        },
        tags: { restore: pendingOffset <= 1 ? "latest" : "legacy_offset_fallback" },
      });
      recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_position_applied", {
        values: {
          itemCount: timeline.length,
          restoredOffsetPx: 0,
          contentHeightPx: resolvedHeight,
          viewportHeightPx: timelineViewportHeightRef.current,
        },
        tags: { restore: pendingOffset <= 1 ? "latest" : "legacy_offset_fallback" },
      });
    }
    setTimelineDidPosition(true);
  };
  const currentHistoryAnchor = (offset: number): { turnId: string | null; viewportOffsetPx: number | null } => {
    if (offset <= LATEST_TIMELINE_THRESHOLD_PX) return { turnId: null, viewportOffsetPx: null };
    const turnId = firstVisibleHistoryAnchorRef.current;
    const itemKey = turnId === null ? null : firstVisibleHistoryAnchorKeyRef.current;
    return {
      turnId,
      viewportOffsetPx: itemKey === null ? null : timelineRef.current?.getItemViewportOffset(itemKey) ?? null,
    };
  };

  const persistTimelineOffset = (offset: number) => {
    scrollOffsetRef.current = offset;
    sessionConversationScrollOffsets.set(composerScope, offset);
    const historyAnchor = currentHistoryAnchor(offset);
    if (historyAnchor.turnId === null) sessionConversationHistoryAnchors.delete(composerScope);
    else sessionConversationHistoryAnchors.set(composerScope, { turnId: historyAnchor.turnId, viewportOffsetPx: historyAnchor.viewportOffsetPx });
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (saveScrollOffset === undefined || draftConnectionId === null || draftThreadId === null) return;
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null;
      void saveScrollOffset(draftConnectionId, draftThreadId, offset, historyAnchor.turnId, historyAnchor.viewportOffsetPx).catch(() => undefined);
    }, 250);
  };

  const markTimelineAtLatest = () => {
    if (!historyViewport.atLiveTail) void historyViewport.revealLatest();
    persistTimelineOffset(0);
    awayFromLatestRef.current = false;
    updateFollowingLatest(true);
    setAwayFromLatest(false);
    if (latestUnreadReceiptKey !== null) acknowledgeUnreadReceipt(latestUnreadReceiptKey);
  };

  const jumpTimelineToLatest = () => {
    // Do not hide the button optimistically. A virtualized list can defer or cancel an
    // animated scroll while variable-height cells are being materialized.
    // The real onScroll position confirms the jump and clears the badge.
    updateFollowingLatest(true);
    momentumActiveRef.current = false;
    const reveal = !historyViewport.atLiveTail
      ? historyViewport.revealLatest()
      : Promise.resolve();
    void reveal.then(() => {
      requestAnimationFrame(() => {
        void timelineRef.current?.scrollToEnd({ animated: false });
      });
    });
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
    if (unreadVisibilityFrameRef.current !== null) cancelAnimationFrame(unreadVisibilityFrameRef.current);
    scrollSaveTimerRef.current = null;
    timelinePositionTimerRef.current = null;
    timelineSettleTimerRef.current = null;
    timelineIndexRetryTimerRef.current = null;
    unreadVisibilityFrameRef.current = null;
    latestUnreadAgentRef.current = null;
    timelineOverlay.reset();
  };
  const cleanUpTimeline = () => {
    clearTimelineRuntime();
    const current = mountedConversationScopeRef.current;
    pendingRestoreOffsetRef.current = null;
    pendingRestoreAnchorTurnIdRef.current = null;
    pendingRestoreAnchorOffsetRef.current = null;
    if (scrollRestoredRef.current) sessionConversationScrollOffsets.set(current.scope, scrollOffsetRef.current);
    if (current.saveScrollOffset !== undefined && current.connectionId !== null && current.threadId !== null) {
      const historyAnchor = currentHistoryAnchor(scrollOffsetRef.current);
      void current.saveScrollOffset(current.connectionId, current.threadId, scrollOffsetRef.current, historyAnchor.turnId, historyAnchor.viewportOffsetPx).catch(() => undefined);
    }
    fullscreenOverlay.dismissScope(current.scope);
  };
  const androidBackEnabled = Platform.OS === "android" && compact && onBack !== undefined;
  useAndroidBackHandler(androidBackEnabled, () => onBack?.());

  const composerSeedTaskKey = !composerStateMissing
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
    latestDraftRef.current.latest = text;
    if (text === "") composerContentHeightRef.current = 0;
    setComposerInputHeight(composerHeightForContent(text, composerContentHeightRef.current));
    if (saveDraft === undefined || draftConnectionId === null || draftThreadId === null) return;
    void saveDraft(draftConnectionId, draftThreadId, text).catch(() => undefined);
  };

  const updateAttachments = (next: ComposerAttachment[]) => {
    latestAttachmentsRef.current.latest = next;
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

  const send = (textOverride?: string, preference: ComposerSendPreference = "start") => {
    if (pastedAttachmentPendingRef.current) return;
    // Voice completion passes its final draft explicitly. Reading `draft`
    // here would use the render captured when recording started and can send
    // the pre-transcription text instead of the latest transcript.
    const text = (textOverride ?? latestDraftRef.current.latest).trim();
    const sentAttachments = latestAttachmentsRef.current.latest;
    if ((!text && sentAttachments.length === 0) || onSend === undefined) return;
    const scope = composerScope;
    const sentContentReviewAttachmentId = contentReviewAttachmentId;
    // Delivery mode is a one-shot command for this draft. Normal Send uses the
    // durable queue while a turn is active and starts immediately when idle;
    // opening the long-press menu must never mutate a persisted default.
    const mode: SendMode = resolveComposerSendMode(preference, threadLifecycleActive, currentTurnId);
    const currentControls = currentControlsResource()?.value ?? EMPTY_TURN_CONTROLS;
    const skills = currentControls.skills.filter((skill) => selectedSkills.includes(skill.path)).map(({ name, path }) => ({ name, path }));
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
      if (sentContentReviewAttachmentId !== null) clearContentReviewAttachmentId(scope, sentContentReviewAttachmentId);
      if (mode.type === "queue" && onListQueue !== undefined) {
        void onListQueue().catch(() => undefined);
      }
    }).catch(() => {
      // Native persistence failed before Kotlin accepted ownership. Restore
      // the composer; successful submissions are rendered exclusively from
      // the Legend delivery/queue projection.
      if (conversationOwner.isCurrent()) {
        const recoveredDraft = mergeFailedComposerText(latestDraftRef.current.latest, text);
        if (recoveredDraft !== latestDraftRef.current.latest) updateDraft(recoveredDraft);
        const recoveredAttachments = mergeFailedComposerAttachments(latestAttachmentsRef.current.latest, sentAttachments);
        if (recoveredAttachments !== latestAttachmentsRef.current.latest) updateAttachments(recoveredAttachments);
        return;
      }
      if (conversationOwner.hasReplacement()) return;
      // The user already navigated away. Restore the failed submission in its
      // owning thread without mutating the newly selected composer's local UI.
      const recoveredDraft = mergeFailedComposerText(latestDraftRef.current.latest, text);
      latestDraftRef.current.latest = recoveredDraft;
      if (saveDraft !== undefined && draftConnectionId !== null && draftThreadId !== null) {
        void saveDraft(draftConnectionId, draftThreadId, recoveredDraft).catch(() => undefined);
      }
      const recoveredAttachments = mergeFailedComposerAttachments(latestAttachmentsRef.current.latest, sentAttachments);
      latestAttachmentsRef.current.latest = recoveredAttachments;
      if (saveDraftAttachments !== undefined && draftConnectionId !== null && draftThreadId !== null) {
        void saveDraftAttachments(draftConnectionId, draftThreadId, recoveredAttachments).catch(() => undefined);
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
    const current = currentControlsResource();
    if (initialPage !== "ports" && (current === null || current.status === "error")) requestControls();
  };
  const closeControls = () => {
    setMenuVisible(false);
    timelineOverlay.end("composer-menu");
  };
  const openQuickControlMenu = (scope: "model-menu" | "permissions-menu") => {
    setComposerTrayVisible(false);
    timelineOverlay.begin(scope);
    dismissComposerKeyboardForOverlay();
    const current = currentControlsResource();
    if (current === null || current.status === "error") requestControls();
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
    setProjectChangeBusy(true);
    setProjectChangeError(null);
    const cause = await onChangeProject(nextCwd).then(() => null, (error: unknown) => error);
    if (!conversationOwner.isCurrent()) return;
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
  const [subagentEventProjection] = useState(() => new SubagentListProjection());
  const currentSubagentSummaries = (): readonly StoredThreadSummary[] => {
    if (subagentSummaryDatabase === null || draftConnectionId === null || draftThreadId === null) return [];
    const resource = subagentSummaryDatabase.viewResource({
      viewId: `subagents:${draftConnectionId}:${draftThreadId}`,
      connectionId: null,
      recentLimit: 0,
      archivedLimit: 0,
      selectedConnectionId: null,
      selectedThreadId: null,
      subagentConnectionId: draftConnectionId,
      subagentLimit: SUBAGENT_LIST_LIMIT,
    });
    return subagentEventProjection.project(resource.view$.peek().subagents);
  };
  const openSubagents = useEvent((summaries: readonly StoredThreadSummary[], initialThreadId: string | null = null) => {
    if (draftConnectionId === null || draftThreadId === null || onReadSubagentThread === undefined) return;
    // Opening the sheet is the user event that starts the background catalog
    // refresh. The sheet itself only reads Legend-owned resources.
    void onRefreshSubagents?.(draftThreadId).catch(() => {
      // Retain the complete local subagent list when the server is unavailable.
    });
    fullscreenOverlay.present(({ close }) => (
      <SubagentSheet
        connectionId={draftConnectionId}
        parentThreadId={draftThreadId}
        parentThread={remoteThread ?? null}
        summaries={summaries}
        threadDetails={subagentThreadDetails}
        onReadThread={onReadSubagentThread}
        initialThreadId={initialThreadId}
        renderThread={({ summary, thread: subagentThread, compact: subagentCompact, onBack: onBackToSubagents, onOpenSubagent }) => (
          <ConversationPane
            key={`${draftConnectionId}:${subagentThread.id}`}
            thread={subagentThreadListItem(summary, subagentThread, draftConnectionId)}
            server={server}
            compact={subagentCompact}
            readOnly
            {...(onBackToSubagents === undefined ? {} : { onBack: onBackToSubagents })}
            remoteThread={subagentThread}
            remoteSealedTurns={subagentThread.turns.filter((turn) => turn.status !== "inProgress")}
            remoteLiveTurns={subagentThread.turns.filter((turn) => turn.status === "inProgress")}
            cwd={subagentThread.cwd}
            subagentSummaryDatabase={subagentSummaryDatabase}
            subagentThreadDetails={subagentThreadDetails}
            onReadSubagentThread={onReadSubagentThread}
            onOpenSubagentThread={onOpenSubagent}
            {...(onRefreshSubagents === undefined ? {} : { onRefreshSubagents })}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock: fixUnsupportedBlock })}
          />
        )}
        onClose={close}
      />
    ), { dismissOnScopeUnmount: false });
  });
  const presentTerminal = () => {
    if (draftConnectionId === null || draftThreadId === null) return;
    fullscreenOverlay.present(({ close }) => (
      <TerminalWorkspace connectionId={draftConnectionId} threadId={draftThreadId} cwd={cwd ?? null} onMinimize={close} />
    ), { dismissOnScopeUnmount: false });
  };
  const openTerminal = () => {
    if (draftConnectionId === null || draftThreadId === null) return;
    if (Platform.OS === "android" && readInteractiveTerminalWorkspace(draftConnectionId, draftThreadId).tabs.length === 0) {
      createInteractiveTerminalTab({ connectionId: draftConnectionId, threadId: draftThreadId, cwd: cwd ?? null });
    }
    presentTerminal();
  };
  const createAndOpenTerminal = () => {
    if (draftConnectionId === null || draftThreadId === null) return;
    if (Platform.OS === "android") {
      createInteractiveTerminalTab({ connectionId: draftConnectionId, threadId: draftThreadId, cwd: cwd ?? null });
    }
    presentTerminal();
  };
  const deleteThread = onDelete === undefined ? undefined : async () => {
    await onDelete();
    if (draftConnectionId !== null && draftThreadId !== null) {
      closeInteractiveTerminalWorkspace(draftConnectionId, draftThreadId);
    }
  };
  const fileAttachmentEnabled = fileTransferController !== null
    && getTransferAccess !== undefined
    && draftThreadId !== null
    && fileTransferResource?.status !== "authorizing"
    && fileTransferResource?.status !== "running";
  const uploadSelectedAttachment = async (
    selected: SelectedUpload,
    onUploaded?: (attachment: ComposerAttachment) => void,
    offerRetry = true,
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
        offerRetry
          ? [
              { text: "Cancel", style: "cancel" },
              { text: "Retry", onPress: () => void uploadSelectedAttachment(selected) },
            ]
          : [{ text: "OK" }],
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
  const attachImageReview = async (markdown: string): Promise<boolean> => {
    if (markdown === "") return false;
    const selected = createTextUpload(
      `codex-image-review-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
      "text/markdown",
      markdown,
    );
    return await uploadSelectedAttachment(selected) !== null;
  };
  const attachContentReview = async (markdown: string): Promise<string | null> => {
    if (markdown === "") return null;
    const scope = composerScope;
    const previousAttachmentId = contentReviewAttachmentId;
    const selected = createTextUpload(
      `codex-content-review-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
      "text/markdown",
      markdown,
    );
    return await uploadSelectedAttachment(selected, (attachment) => {
      const current = latestAttachmentsRef.current.latest;
      updateAttachments([
        ...current.filter((candidate) => candidate.id !== previousAttachmentId && candidate.id !== attachment.id),
        attachment,
      ]);
      setContentReviewAttachmentId(scope, attachment.id);
    }).then((attachment) => attachment?.id ?? null);
  };
  useImagePreviewAnnotationHandler(attachImageReview);
  useContentReviewRuntime({
    attach: attachContentReview,
    attachmentId: contentReviewAttachmentId,
    thread: remoteThread ?? null,
    voiceScope: `${composerScope}\u0000review`,
    voiceResource: reviewVoiceResource,
    voiceController,
    ...(onStartVoiceTranscription === undefined ? {} : { startVoice: onStartVoiceTranscription }),
  });
  function presentThreadChanges(resource: ThreadResourcesValue | null, refreshOnOpen = false) {
    const presentation = currentChangePresentation();
    fullscreenOverlay.present(({ close }) => (
      <CodeReviewWorkspace
        changes={resource?.changes ?? []}
        changeScope={resource?.changeScope ?? presentation.scope}
        changeScopes={resource?.changeScopes ?? presentation.scopes}
        initialMode={changesPreferences.mode}
        initialWrapLines={changesPreferences.wrapLines}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceRuntime={appVoiceInputRuntime}
        getTransferAccess={getStableTransferAccess}
        onAttach={attachCodeReview}
        onClose={close}
        onPreferencesChange={(preferences) => setChangesPreferences({ ...preferences })}
        {...(!refreshOnOpen || onLoadThreadResources === undefined ? {} : {
          onInitialLoad: () => onLoadThreadResources(changesPreferences.scope ?? undefined, "changes"),
        })}
        {...(onLoadThreadResources === undefined ? {} : { onLoadScope: (scope: ThreadChangeScope) => onLoadThreadResources(scope, "changes") })}
        {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
      />
    ));
  }
  const openCodeDocument = useEvent((request: DocumentPreviewRequest) => {
    const resource = currentThreadResources()?.value ?? null;
    fullscreenOverlay.present(({ close }) => (
      <CodeReviewWorkspace
        key={`${request.path}:${request.line ?? ""}:${request.column ?? ""}`}
        changes={codeReviewFilesForDocument(resource?.changes ?? [], request.path)}
        initialPath={request.path}
        {...(request.line === undefined ? {} : { initialLine: request.line })}
        {...(request.column === undefined ? {} : { initialColumn: request.column })}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceRuntime={appVoiceInputRuntime}
        getTransferAccess={getStableTransferAccess}
        onAttach={attachCodeReview}
        onClose={close}
        onDownload={() => void downloadDocument(request)}
        {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: (path: string) => onLoadThreadChangeDiff(path, resource?.changeScope) })}
      />
    ));
  });
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
  const clearLargePasteOperation = (operation: NonNullable<typeof largePasteOperationRef.current>) => {
    if (largePasteOperationRef.current !== operation) return;
    largePasteOperationRef.current = null;
    pastedAttachmentPendingRef.current = false;
    setPastedAttachmentPending(false);
  };
  const flushLargePasteCapture = async (operation: NonNullable<typeof largePasteOperationRef.current>) => {
    if (largePasteOperationRef.current !== operation || operation.scope !== composerScope) return;
    const projection = operation.capture;

    let selected: SelectedUpload;
    try {
      selected = createTextUpload(
        `pasted-snippet-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        "text/plain",
        projection.attachmentText,
      );
    } catch (cause) {
      clearLargePasteOperation(operation);
      dialog.alert("Could not attach pasted text", cause instanceof Error ? cause.message : "Could not create the text attachment");
      return;
    }

    const attachmentsBeforeUpload = [...latestAttachmentsRef.current.latest];
    updateDraft(projection.draftText);
    draftSelectionRef.current = { start: projection.insertionOffset, end: projection.insertionOffset };
    voiceController?.setPendingSelection(composerScope, draftSelectionRef.current);
    const attachment = await uploadSelectedAttachment(selected, (uploaded) => {
      const next = [...attachmentsBeforeUpload.filter((candidate) => candidate.id !== uploaded.id), uploaded];
      if (largePasteOperationRef.current === operation && conversationOwner.isCurrent()) {
        updateAttachments(next);
      } else if (!conversationOwner.hasReplacement() && saveDraftAttachments !== undefined && operation.connectionId !== null && operation.threadId !== null) {
        void saveDraftAttachments(operation.connectionId, operation.threadId, next).catch(() => undefined);
      }
    }, false);
    if (attachment === null) {
      if (largePasteOperationRef.current === operation && conversationOwner.isCurrent()) {
        const current = latestDraftRef.current.latest;
        const offset = Math.min(projection.insertionOffset, current.length);
        updateDraft(`${current.slice(0, offset)}${projection.attachmentText}${current.slice(offset)}`);
      } else if (!conversationOwner.hasReplacement() && saveDraft !== undefined && operation.connectionId !== null && operation.threadId !== null) {
        void saveDraft(operation.connectionId, operation.threadId, operation.capture.pastedDraftText).catch(() => undefined);
      }
    }
    clearLargePasteOperation(operation);
  };
  const handleComposerTextChange = (nextText: string) => {
    updateDraft(nextText);
  };
  const handleComposerLargePaste = (event: LargePasteEvent) => {
    if (largePasteOperationRef.current?.scope === composerScope) return;
    const capture = captureClipboardLargePaste(
      latestDraftRef.current.latest,
      event.text,
      { start: event.start, end: event.end },
    );
    if (capture === null) return;
    const operation = {
      scope: composerScope,
      connectionId: draftConnectionId,
      threadId: draftThreadId,
      capture,
    };
    largePasteOperationRef.current = operation;
    pastedAttachmentPendingRef.current = true;
    setPastedAttachmentPending(true);
    void flushLargePasteCapture(operation);
  };
  useUnmount(() => {
    cleanUpTimeline();
    const operation = largePasteOperationRef.current;
    if (operation?.scope === composerScope) clearLargePasteOperation(operation);
  });
  const openAccessoryAction = (action: ComposerAccessoryAction) => {
    setComposerTrayVisible(false);
    if (action === "files") {
      void pickComposerAttachment();
      return;
    }
    if (action === "terminal") {
      createAndOpenTerminal();
      return;
    }
    if (action === "ports") {
      openControls("ports");
      return;
    }
    openControls(action);
    if (action === "goal") void onGetGoal?.();
  };
  const useAnchoredComposerMenu = Platform.OS === "android";
  const anchoredComposerActions: ActionMenuItem[] = [
    { id: "files", label: "Attach file", icon: "attach-outline", disabled: !fileAttachmentEnabled },
    { id: "terminal", label: "Terminal", icon: "terminal-outline", disabled: newChat || Platform.OS !== "android" || draftConnectionId === null || draftThreadId === null },
    { id: "ports", label: "Port forward", icon: "git-network-outline", disabled: portForwardingConnectionId === null },
    { id: "skills", label: "Skills", icon: "sparkles-outline" },
    { id: "goal", label: "Goal", icon: "flag-outline" },
  ];
  const handleAnchoredComposerAction = (id: string) => {
    if (id === "files" || id === "terminal" || id === "ports" || id === "skills" || id === "goal") {
      openAccessoryAction(id);
    }
  };
  const deliveryActions: ActionMenuItem[] = [
    { id: "start", label: "Send now", icon: "send-outline", disabled: threadLifecycleActive },
    { id: "queue", label: "Queue after current turn", icon: "time-outline", disabled: !threadLifecycleActive },
    { id: "steer", label: "Steer active turn", icon: "navigate-outline", disabled: currentTurnId === null },
  ];
  const handleDeliveryAction = (id: string) => {
    if (id !== "start" && id !== "queue" && id !== "steer") return;
    if (voicePhase !== "idle") void finishVoice(true, id);
    else send(undefined, id);
  };
  const selectModel = (model: string, effort: string) => {
    const modelMutation = ++settingsMutationRef.current.model;
    const effortMutation = ++settingsMutationRef.current.effort;
    const previousModel = selectedModel;
    const previousEffort = selectedEffort;
    updateComposerPreferences((current) => ({ ...current, model, effort }));
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ model, effort }).catch((cause) => {
      const ownsModel = settingsMutationRef.current.model === modelMutation;
      const ownsEffort = settingsMutationRef.current.effort === effortMutation;
      if ((ownsModel || ownsEffort) && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        updateComposerPreferences((current) => ({
          ...current,
          ...rollbackOwnedModelSelection(
            current,
            { model, effort },
            { model: previousModel, effort: previousEffort },
            { model: ownsModel, effort: ownsEffort },
          ),
        }));
      }
      if ((ownsModel || ownsEffort) && conversationOwner.isCurrent()) {
        setControlError(cause instanceof Error ? cause.message : "Could not update model settings");
      }
    });
  };

  const selectEffort = (effort: string) => {
    const mutation = ++settingsMutationRef.current.effort;
    const previous = selectedEffort;
    setSelectedEffort(effort);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ effort }).catch((cause) => {
      const ownsMutation = settingsMutationRef.current.effort === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        setSelectedEffort((current) => current === effort ? previous : current);
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(cause instanceof Error ? cause.message : "Could not update thinking effort");
      }
    });
  };

  const selectPermissions = (permissions: string | null) => {
    const mutation = ++settingsMutationRef.current.permissions;
    const previous = selectedPermissions;
    setSelectedPermissions(permissions);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ permissions }).catch((cause) => {
      const ownsMutation = settingsMutationRef.current.permissions === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        setSelectedPermissions((current) => current === permissions ? previous : current);
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
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

  const finishVoice = async (sendAfter: boolean, preference: ComposerSendPreference = "start") => {
    await voiceController?.finish(sendAfter, (text) => send(text, preference));
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

  // Authoritative revalidation is deliberately invisible: resident content
  // remains the presented truth while fresh rows reconcile in place. Only a
  // real connection transition or an actionable retry state changes chrome.
  const conversationActivity: ConnectionActivity | null = server?.status === "connecting"
    ? "connecting"
    : null;
  const conversationSubtitle = conversationActivity === "connecting"
    ? "connecting…"
    : historyViewport.status === "background-retrying"
      ? "update delayed"
      : threadContextLabel(server?.name ?? "", cwd);
  const conversationSubtitleColor = conversationActivity !== null
    ? connectionActivityColor(conversationActivity)
    : historyViewport.status === "background-retrying"
      ? colors.amber
      : colors.textMuted;
  const stoppingResponse = currentTurnId !== null && voicePhase === "idle" && draft.trim() === "" && attachments.length === 0;
  const sendDisabled = voicePhase === "finishing"
    || pastedAttachmentPending
    || (voicePhase === "idle" && !stoppingResponse && draft.trim() === "" && attachments.length === 0);
  return (
    <AppVoiceInputProvider runtime={appVoiceInputRuntime}>
    <AppFullscreenOverlayBoundary scope={composerScope} lifecycle={fullscreenOverlayLifecycle}>
    <SubagentNavigationContext.Provider value={onOpenSubagentThread
      ?? (draftConnectionId !== null && draftThreadId !== null && onReadSubagentThread !== undefined
        ? (threadId) => openSubagents(currentSubagentSummaries(), threadId)
        : null)}>
    <LargeContentViewerHost>
    <View
      testID="thread-detail-pane-shell"
      style={styles.conversation}
      onLayout={({ nativeEvent }) => {
        const paneWidth = Math.max(0, Math.floor(nativeEvent.layout.width));
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
        {!newChat && <Pressable onPress={() => { if (threadSearchVisible) closeThreadSearch(); else setThreadSearchVisible(true); }} style={styles.headerIcon} accessibilityLabel="Search in thread">
          <Ionicons name="search" size={21} color={colors.text} />
        </Pressable>}
        {!newChat && <UsagePopover
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
        </UsagePopover>}
        {!readOnly && !newChat && <ThreadHeaderMenu
          key={thread.id}
          threadId={thread.id}
          archived={archived}
          pinned={pinned}
          onOpenMenu={dismissComposerKeyboardForOverlay}
          onRenameRequest={openThreadRename}
          {...(onTogglePin === undefined ? {} : { onTogglePin })}
          {...(archived
            ? (onUnarchive === undefined ? {} : { onUnarchive })
            : (onArchive === undefined ? {} : { onArchive }))}
          {...(onCompact === undefined ? {} : { onCompact })}
          {...(onFork === undefined ? {} : { onFork })}
          {...(deleteThread === undefined ? {} : { onDelete: deleteThread })}
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
      <View ref={timelineViewportRef} style={styles.timelineShell}>
      {draftConnectionId !== null && draftThreadId !== null && (
        <CommitOnChangeProbe
          scope={`timeline-surface:${composerScope}`}
          revision={composerScope}
          onCommit={() => {
            const navigationId = recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_surface_visible", {
              values: { itemCount: timeline.length },
              tags: { readOnly: readOnly ? "true" : "false", status: historyViewport.status },
            });
            return navigationId === null
              ? undefined
              : () => recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_surface_hidden_or_unmounted", {}, navigationId);
          }}
        />
      )}
      <CommitOnChangeProbe
        scope={composerScope}
        revision={latestUnreadReceiptKey}
        onCommit={commitUnreadReceipt}
      />
      <ThreadTimelineNavigationCommit
        connectionId={draftConnectionId}
        threadId={draftThreadId}
        modelReady={timelineModelReady}
        visible={timelinePositioned}
        itemCount={timeline.length}
        turnCount={remoteThread?.turns.length ?? 0}
        loadStatus={historyViewport.status}
        restoreOffset={initialRestoreOffset}
        restoreAnchorTurnId={initialRestoreAnchorTurnId}
      >
      <ThreadTimelineList
        ref={timelineRef}
        freeze={timelineOverlayFreeze}
        testID="conversation-timeline"
        data={displayedTimeline}
        initialPosition={timelineInitialPosition}
        extraData={`${threadSearch}:${threadSearchMatch}:${windowLayout.measurementRevision}`}
        renderRevision={composerScope}
        measurementRevision={windowLayout.measurementRevision}
        style={styles.conversationScroll}
        contentContainerStyle={[styles.conversationContent, timelineCompact ? styles.conversationContentCompact : styles.conversationContentWide, liveTurnPlanVisible && styles.conversationContentLivePlanInset]}
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
          if (draftConnectionId !== null && draftThreadId !== null) {
            recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_first_draw", {
              values: { nativeListDrawMs: elapsedTimeInMs, itemCount: displayedTimeline.length },
              tags: { status: historyViewport.status },
            });
          }
          historyViewport.prefetch();
          if (draftConnectionId !== null && draftThreadId !== null) {
            markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_first_draw", {
              values: { nativeListDrawMs: elapsedTimeInMs, itemCount: displayedTimeline.length },
            });
          }
          scheduleInitialTimelinePosition();
        }}
        onLayout={({ nativeEvent }) => {
          timelineViewportHeightRef.current = nativeEvent.layout.height;
          scheduleUnreadAgentVisibilityCheck();
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
          scrollGestureActiveRef.current = true;
          scrollDirectionRef.current = null;
          historyViewport.freeze();
          updateFollowingLatest(false);
          momentumActiveRef.current = false;
          if (timelineSettleTimerRef.current !== null) clearTimeout(timelineSettleTimerRef.current);
        }}
        onScroll={({ nativeEvent }) => {
          timelineViewportHeightRef.current = nativeEvent.layoutMeasurement.height;
          timelineContentHeightRef.current = nativeEvent.contentSize.height;
          scheduleUnreadAgentVisibilityCheck();
          if (timelineOverlay.observeNativeOffset(nativeEvent.contentOffset.y) || threadSearchActive) return;
          const previousOffsetY = lastTimelineOffsetYRef.current;
          if (previousOffsetY !== null && Math.abs(nativeEvent.contentOffset.y - previousOffsetY) >= 0.5) {
            scrollDirectionRef.current = nativeEvent.contentOffset.y < previousOffsetY ? "older" : "newer";
          }
          lastTimelineOffsetYRef.current = nativeEvent.contentOffset.y;
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
          scrollGestureActiveRef.current = false;
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
          scrollGestureActiveRef.current = true;
          if (timelineSettleTimerRef.current !== null) clearTimeout(timelineSettleTimerRef.current);
          timelineSettleTimerRef.current = null;
        }}
        onMomentumScrollEnd={({ nativeEvent }) => {
          if (threadSearchActive || timelineOverlay.isActive()) return;
          momentumActiveRef.current = false;
          scrollGestureActiveRef.current = false;
          scrollDirectionRef.current = null;
          reconcileTimelineEndPosition(nativeEvent.contentSize.height, nativeEvent.layoutMeasurement.height, nativeEvent.contentOffset.y, true);
        }}
        onContentSizeChange={(_width, height) => {
          timelineContentHeightRef.current = height;
          if (draftConnectionId !== null && draftThreadId !== null) {
            recordThreadNavigationVisualEvent(draftConnectionId, draftThreadId, "timeline_content_size_changed", {
              values: {
                heightPx: height,
                viewportHeightPx: timelineViewportHeightRef.current,
                itemCount: displayedTimeline.length,
              },
              tags: {
                positioned: timelinePositioned ? "true" : "false",
                status: historyViewport.status,
              },
            });
          }
          historyViewport.prefetch();
          scheduleUnreadAgentVisibilityCheck();
          if (timelineOverlay.isActive()) {
            timelineOverlay.restore(false);
            return;
          }
          if (threadSearchActive) return;
          if (pendingRestoreOffsetRef.current !== null) {
            // The list owns initial placement. This callback only marks the
            // already positioned semantic anchor as ready for display.
            scheduleInitialTimelinePosition(height);
          }
        }}
        showsVerticalScrollIndicator={false}
        onFirstVisibleItemChanged={onTimelineFirstVisibleItemChanged}
        keyExtractor={timelineItemKey}
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
                {workspaceSupport !== null && onChangeWorkspaceMode !== undefined ? (
                  <ActionMenu
                    accessibilityLabel="Choose workspace mode"
                    actions={[
                      {
                        id: "current",
                        section: "Workspace",
                        label: "In this folder",
                        description: "Use the selected project directly",
                        icon: "folder-outline",
                        selected: workspaceMode === "current",
                      },
                      {
                        id: "isolated",
                        section: "Workspace",
                        label: "New workspace",
                        description: `Create an isolated ${workspaceSupport.displayName}`,
                        icon: "git-branch-outline",
                        selected: workspaceMode === "isolated",
                      },
                    ]}
                    placement="bottom"
                    align="center"
                    onSelect={(id) => {
                      if (id === "current" || id === "isolated") onChangeWorkspaceMode(id);
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Workspace mode, ${workspaceMode === "isolated" ? "new workspace" : "in this folder"}`}
                      style={({ pressed }) => [styles.newChatWorkspaceButton, pressed && styles.pressed]}
                    >
                      <Ionicons
                        name={workspaceMode === "isolated" ? "git-branch-outline" : "folder-outline"}
                        size={16}
                        color={colors.textMuted}
                      />
                      <Text style={styles.newChatWorkspaceText}>
                        {workspaceMode === "isolated" ? "New workspace" : "In this folder"}
                      </Text>
                      <Ionicons name="chevron-down" size={15} color={colors.textMuted} />
                    </Pressable>
                  </ActionMenu>
                ) : null}
              </View>
            ) : (
              <>
                {!threadSearchActive && historyViewport.status === "initial-loading" ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                <Text style={styles.emptyText}>{threadSearchActive ? "No matches" : historyViewport.status === "initial-error" ? historyViewport.error ?? "Could not load messages" : historyViewport.status === "initial-loading" ? "Loading messages…" : "Start by typing a message"}</Text>
              </>
            )}
          </View>
        }
        renderItem={renderTimelineItem}
      />
      </ThreadTimelineNavigationCommit>
      {historyViewport.status === "loading-history" && timeline.length > 0 && (
        <View pointerEvents="none" testID="history-loading-indicator" style={styles.historyLoadingIndicator}>
          <View style={styles.historyLoadingIndicatorPill}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        </View>
      )}
      {liveTurnPlanVisible && (
        <View pointerEvents="box-none" testID="live-plan-float" style={styles.livePlanFloat}>
          <LiveTurnPlanPopover plan={liveTurnPlan} />
        </View>
      )}
      </View>
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
        <ComposerControlChips
          resources={workspaceResources}
          resourceId={controlsResourceId}
          cwd={cwd}
          remoteThread={remoteThread}
          readOnly={readOnly}
          selectedModel={selectedModel}
          selectedEffort={selectedEffort}
          selectedPersonality={selectedPersonality}
          selectedPermissions={selectedPermissions}
          error={controlError}
          {...(onLoadControls === undefined ? {} : { load: onLoadControls })}
          onQuickOpen={openQuickControlMenu}
          onClose={closeQuickControlMenu}
          onFallback={openControls}
          onSelectModel={selectModel}
          onSelectEffort={selectEffort}
          onSelectPersonality={setSelectedPersonality}
          onSelectPermissions={selectPermissions}
        />
        {onLoadThreadResources !== undefined && <ThreadResourceContextChips
          model={threadResourcesModel}
          resourceId={threadResourceId}
          revision={threadResourceRevision}
          load={onLoadThreadResources}
          preferences={changesPreferences}
          onPreferencesChange={setChangesPreferences}
          onOpen={openThreadResources}
        />}
        <ComposerPortContextChip connectionId={portForwardingConnectionId} onOpen={() => openControls("ports")} />
        <ComposerTerminalContextChip connectionId={draftConnectionId} threadId={draftThreadId} onOpen={openTerminal} />
        {onReadSubagentThread !== undefined && <ComposerSubagentContextChip
          database={subagentSummaryDatabase}
          connectionId={draftConnectionId}
          parentThreadId={draftThreadId}
          onOpen={(summaries) => openSubagents(summaries)}
        />}
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
        <CompactAttachmentStrip
          testID="composer-attachment-strip"
          attachments={attachments}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess: getStableTransferAccess })}
          onRemove={(attachmentId) => {
            updateAttachments(latestAttachmentsRef.current.latest.filter((candidate) => candidate.id !== attachmentId));
            if (contentReviewAttachmentId === attachmentId) setContentReviewAttachmentId(composerScope, null);
          }}
        />
      )}
      {composerTrayVisible && !useAnchoredComposerMenu && (
        <ComposerAccessoryTray
          fileEnabled={fileAttachmentEnabled}
          terminalEnabled={Platform.OS === "android" && draftConnectionId !== null && draftThreadId !== null}
          portForwardEnabled={portForwardingConnectionId !== null}
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
              {...(fileAttachmentEnabled && !pastedAttachmentPending && attachments.length < MAX_TURN_ATTACHMENTS
                ? {
                    largePasteThreshold: AUTO_ATTACH_PASTE_MIN_CHARS,
                    onLargePaste: handleComposerLargePaste,
                  }
                : {})}
              value={draft}
              onChangeText={handleComposerTextChange}
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

      <ContentReviewComposer targetPrefix="agent-response:" />

      <ResourceComposerMenu
        visible={menuVisible}
        thread={remoteThread ?? null}
        initialPage={menuInitialPage}
        onClose={closeControls}
        resources={workspaceResources}
        controlsResourceId={controlsResourceId}
        backgroundTerminalsResourceId={backgroundTerminalsResourceId}
        goalResourceId={goalResourceId}
        tunnelResourceId={tunnelResourceId}
        portForwardingConnectionId={portForwardingConnectionId}
        portForwardingServerName={portForwardingServerName}
        {...(onOpenPortForward === undefined ? {} : { onOpenPortForward })}
        controlError={controlError}
        queuedPrompts={visibleQueuedPrompts}
        activeTurnId={currentTurnId}
        voiceScope={composerScope}
        voiceResource={voiceResource}
        voiceController={voiceController}
        selectedModel={selectedModel}
        selectedEffort={selectedEffort}
        selectedPersonality={selectedPersonality}
        selectedPermissions={selectedPermissions}
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
        {...(getTransferAccess === undefined ? {} : { getTransferAccess: getStableTransferAccess })}
        {...(onListTerminals === undefined ? {} : { onListTerminals })}
        {...(onTerminateTerminal === undefined ? {} : { onTerminateTerminal })}
        {...(onSetGoal === undefined ? {} : { onSetGoal })}
        {...(onClearGoal === undefined ? {} : { onClearGoal })}
        {...(onStartReview === undefined ? {} : { onStartReview })}
        {...(onCreateTunnel === undefined ? {} : { onCreateTunnel })}
        {...(onRevokeTunnel === undefined ? {} : { onRevokeTunnel })}
      />
      <ProjectPickerSheet
        visible={projectPickerVisible}
        cwd={cwd}
        projects={projects}
        discoveredProjects={discoveredProjects}
        busy={projectChangeBusy}
        error={projectChangeError ?? projectLoadError}
        onSelect={selectProject}
        {...(onAddProject === undefined ? {} : { onAddProject })}
        {...(onReadDirectory === undefined ? {} : { onReadDirectory })}
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
        model={threadResourcesModel}
        resourceId={threadResourceId}
        revision={threadResourceRevision}
        cwd={cwd}
        thread={remoteThread ?? null}
        voiceRuntime={appVoiceInputRuntime}
        getTransferAccess={getStableTransferAccess}
        onAttachReview={attachCodeReview}
        {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadThreadChangeDiff })}
        {...(onLoadThreadResources === undefined ? {} : { onReload: () => onLoadThreadResources(undefined, "attachments") })}
        onClose={closeThreadResources}
      />
    </View>
    </View>
    </LargeContentViewerHost>
    </SubagentNavigationContext.Provider>
    </AppFullscreenOverlayBoundary>
    </AppVoiceInputProvider>
  );
}

type ThreadResourceDocumentRoute = {
  request: DocumentPreviewRequest;
  revision: number;
};

function ThreadResourcesSheet({
  visible,
  model,
  resourceId,
  revision,
  cwd,
  thread,
  voiceRuntime,
  getTransferAccess,
  onLoadThreadChangeDiff,
  onAttachReview,
  onReload,
  onClose,
}: {
  visible: boolean;
  model: ThreadResourcesModel | null;
  resourceId: string | null;
  revision: string;
  cwd: string;
  thread: Thread | null;
  voiceRuntime: AppVoiceInputRuntime | null;
  getTransferAccess: GetTransferAccess;
  onLoadThreadChangeDiff?(path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue>;
  onAttachReview(comments: readonly CodeReviewComment[]): Promise<boolean>;
  onReload?(): Promise<ThreadResourcesValue>;
  onClose(): void;
}) {
  const resource = useThreadResources(model, resourceId, onReload, { revision });
  const dialog = useAppDialog();
  const openDocument = useDocumentPreview();
  const downloadDocument = useDocumentDownload();
  const fullscreenOverlay = useAppFullscreenOverlay();
  const previewResourceOwnerId = useId();
  const previewRevisionRef = useRef(0);
  const [documentStack, setDocumentStack] = useState<ThreadResourceDocumentRoute[]>([]);
  const [documentViewportWidth, setDocumentViewportWidth] = useState(0);
  const changes = resource?.value?.changes ?? [];
  const attachments = resource?.value?.attachments ?? [];
  const attachmentsPending = resource === null
    || (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes("attachments"));
  const attachmentsReady = resource?.readyKinds === undefined
    ? resource?.value != null
    : resource.readyKinds.includes("attachments");
  const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;
  const attachmentsError = resource?.resourceErrors?.attachments
    ?? (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const title = `Attachments · ${attachments.length}`;
  const document = documentStack.at(-1) ?? null;
  const documentSource = document?.request.source ?? (document === null ? null : { kind: "path" as const, path: document.request.path });
  const documentPreviewResource = useEphemeralAsyncResource<Extract<DocumentPreviewResult, { phase: "ready" }>>(
    document === null || documentSource === null
      ? null
      : `thread-resource-document:${previewResourceOwnerId}:${privateAssetCacheKey(documentSource)}`,
    document === null ? "none" : `${document.request.kind}:${document.revision}`,
    async (_publish, signal) => {
      if (document === null) throw new Error("Document preview is closed");
      const loaded = await loadDocumentPreview(document.request, signal);
      return {
        phase: "ready",
        source: loaded.source,
        segments: document.request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
        truncated: loaded.truncated,
      };
    },
    (value) => value.source.length * 2,
  );
  const documentResult: DocumentPreviewResult = documentPreviewResource.status === "ready" && documentPreviewResource.value !== null
    ? documentPreviewResource.value
    : documentPreviewResource.status === "error"
      ? { phase: "error", message: documentPreviewResource.error ?? "Document preview failed" }
      : { phase: "loading" };
  const reload = () => {
    if (onReload === undefined || attachmentsPending) return;
    void onReload().catch((cause) => dialog.alert("Refresh failed", cause instanceof Error ? cause.message : "Could not refresh session resources"));
  };
  const loadPreview = (request: DocumentPreviewRequest, replace: boolean) => {
    previewRevisionRef.current += 1;
    const revision = previewRevisionRef.current;
    const route: ThreadResourceDocumentRoute = { request, revision };
    setDocumentStack((current) => replace ? [...current.slice(0, -1), route] : [...current, route]);
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
          changeScope={resource?.value?.changeScope ?? "session"}
          changeScopes={resource?.value?.changeScopes ?? ["session", "lastTurn"]}
          initialPath={request.path}
          {...(request.line === undefined ? {} : { initialLine: request.line })}
          {...(request.column === undefined ? {} : { initialColumn: request.column })}
          cwd={cwd}
          thread={thread}
          voiceRuntime={voiceRuntime}
          getTransferAccess={getTransferAccess}
          onAttach={onAttachReview}
          onClose={close}
          onDownload={() => void downloadDocument(request)}
          {...(onLoadThreadChangeDiff === undefined ? {} : { onLoadDiff: onLoadThreadChangeDiff })}
        />
      ));
      return;
    }
    loadPreview(request, false);
  };
  const closeSheet = () => {
    previewRevisionRef.current += 1;
    setDocumentStack([]);
    onClose();
  };
  const navigateBack = () => {
    previewRevisionRef.current += 1;
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
          <Pressable accessibilityLabel="Refresh session resources" disabled={onReload === undefined || attachmentsPending} onPress={reload} style={[styles.headerIcon, (onReload === undefined || attachmentsPending) && styles.disabled]}>
            {attachmentsInitialLoading ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="refresh" size={20} color={colors.text} />}
          </Pressable>
          <Pressable accessibilityLabel="Close attachments" onPress={closeSheet} style={styles.headerIcon}>
            <Ionicons name="close" size={21} color={colors.text} />
          </Pressable>
        </View>
        <AppSheetScrollView style={styles.menuScroll} contentContainerStyle={styles.threadResourcesContent} keyboardShouldPersistTaps="handled">
          {attachmentsError !== null && <Text selectable style={styles.errorText}>{attachmentsError}</Text>}
          {attachments.map((attachment) => (
            <ThreadAttachmentResourceRow key={attachment.key} attachment={attachment} onPress={() => openAttachment(attachment)} />
          ))}
          {attachmentsReady && attachments.length === 0 && (
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
          {documentResult.phase === "loading" && (
            <View style={styles.threadResourcePreviewCenter}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.menuNotice}>Loading document…</Text>
            </View>
          )}
          {documentResult.phase === "error" && (
            <View style={styles.threadResourcePreviewCenter}>
              <Text selectable style={styles.errorText}>{documentResult.message}</Text>
              <Pressable accessibilityRole="button" onPress={retryPreview} style={styles.primaryAction}>
                <Ionicons name="refresh" size={18} color={colors.onPrimary} />
                <Text style={styles.primaryActionText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {documentResult.phase === "ready" && document.request.kind === "html" && (
            <WebView
              testID="thread-resource-html-preview"
              source={{ html: isolatedHtmlDocument(documentResult.source), baseUrl: "about:blank" }}
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
          {documentResult.phase === "ready" && document.request.kind !== "html" && (
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
                    value={documentResult.source}
                    language={nativeCodeLanguageForPath(document.request.path)}
                    maxHeight={TOOL_RESULT_MAX_HEIGHT}
                    fillAvailableWidth
                  />
                : (
                  <RichContentWidthProvider width={documentViewportWidth > 0 ? documentViewportWidth : null}>
                    <MarkdownLocalLinkProvider onOpen={openNestedDocument}>
                      {documentResult.segments.map((segment, index) => (
                        <RichMarkdown
                          key={index}
                          source={segment}
                          reviewTarget={{
                            id: `markdown-document:${document.request.path}`,
                            label: document.request.name,
                            reference: document.request.path,
                          }}
                          reviewPathPrefix={`segment-${index}`}
                        />
                      ))}
                    </MarkdownLocalLinkProvider>
                  </RichContentWidthProvider>
                )}
              {documentResult.truncated && <Text style={styles.menuNotice}>Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download the file to read the rest.</Text>}
            </AppSheetScrollView>
          )}
          {documentResult.phase === "ready" && document.request.kind === "markdown" && (
            <ContentReviewComposer targetId={`markdown-document:${document.request.path}`} />
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
          {change.binary ? (
            <Text style={styles.threadResourceStat}>Binary</Text>
          ) : (
            <>
              <Text style={[styles.threadResourceStat, styles.diffStatAdd]}>+{change.additions}</Text>
              <Text style={[styles.threadResourceStat, styles.diffStatDelete]}>−{change.deletions}</Text>
            </>
          )}
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
    if (id === "copy-session-id") void copySessionId(threadId).catch((cause) => dialog.alert("Copy failed", cause instanceof Error ? cause.message : "Could not copy session ID"));
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

function CompactAttachmentStrip({
  attachments,
  getTransferAccess,
  onRemove,
  testID,
}: {
  attachments: readonly ComposerAttachment[];
  getTransferAccess?: GetTransferAccess;
  onRemove(attachmentId: string): void;
  testID?: string;
}) {
  const previewGroupId = `composer-attachments:${useId()}`;
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.composerAttachments}
      contentContainerStyle={styles.composerAttachmentsContent}
      keyboardShouldPersistTaps="handled"
    >
      {attachments.map((attachment, index) => attachment.kind === "image" && getTransferAccess !== undefined
        ? (
            <CompactImageAttachmentCard
              key={attachment.id}
              attachment={attachment}
              getTransferAccess={getTransferAccess}
              groupId={previewGroupId}
              order={index}
              onRemove={onRemove}
            />
          )
        : (
            <CompactFileAttachmentCard
              key={attachment.id}
              attachment={attachment}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              onRemove={onRemove}
            />
          ))}
    </ScrollView>
  );
}

function CompactImageAttachmentCard({
  attachment,
  getTransferAccess,
  groupId,
  order,
  onRemove,
}: {
  attachment: ComposerAttachment;
  getTransferAccess: GetTransferAccess;
  groupId: string;
  order: number;
  onRemove(attachmentId: string): void;
}) {
  const openImagePreview = useImagePreview();
  const [retryRevision, setRetryRevision] = useState(0);
  const source = composerAttachmentSource(attachment);
  const privateImage = usePrivateAssetUri(source, retryRevision, getTransferAccess);
  const resolvedSource = privateImage.source;
  const previewItem = {
    id: `composer-image:${attachment.id}`,
    label: attachment.name,
    source: resolvedSource ?? { uri: "about:blank" },
    reference: `scoped:${attachment.rootId}:${attachment.path}`,
    order,
  };
  useRegisterImagePreviewItem(resolvedSource === null ? null : groupId, previewItem);
  const retrying = resolvedSource === null && privateImage.failed;
  return (
    <View style={styles.composerAttachmentCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retrying ? `Retry ${attachment.name}` : `Open ${attachment.name}`}
        disabled={resolvedSource === null && !retrying}
        onPress={() => {
          if (retrying) setRetryRevision((current) => current + 1);
          else if (resolvedSource !== null) openImagePreview({ ...previewItem, source: resolvedSource, groupId });
        }}
        style={({ pressed }) => [styles.composerAttachmentOpen, pressed && styles.pressed]}
      >
        <View style={styles.composerAttachmentThumbnail}>
          {resolvedSource !== null
            ? <Image accessibilityLabel={attachment.name} source={resolvedSource} resizeMode="cover" style={styles.openableImage} />
            : retrying
              ? <Ionicons name="refresh" size={19} color={colors.red} />
              : <ActivityIndicator size="small" color={colors.textMuted} />}
        </View>
        <View style={styles.composerAttachmentText}>
          <Text numberOfLines={1} style={styles.composerAttachmentName}>{attachment.name}</Text>
          <Text numberOfLines={1} style={styles.composerAttachmentKind}>{retrying ? "Preview failed · Retry" : "Image"}</Text>
        </View>
      </Pressable>
      <CompactAttachmentRemove attachment={attachment} onRemove={onRemove} />
    </View>
  );
}

function CompactFileAttachmentCard({
  attachment,
  getTransferAccess,
  onRemove,
}: {
  attachment: ComposerAttachment;
  getTransferAccess?: GetTransferAccess;
  onRemove(attachmentId: string): void;
}) {
  const openDocument = useDocumentPreview();
  const kind = composerAttachmentPreviewKind(attachment);
  const canOpen = getTransferAccess !== undefined;
  return (
    <View style={styles.composerAttachmentCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${attachment.name}`}
        accessibilityState={{ disabled: !canOpen }}
        disabled={!canOpen}
        onPress={() => {
          if (getTransferAccess === undefined) return;
          openDocument({
            kind,
            name: attachment.name,
            path: attachment.path,
            source: composerAttachmentSource(attachment),
            getTransferAccess,
          });
        }}
        style={({ pressed }) => [styles.composerAttachmentOpen, pressed && styles.pressed]}
      >
        <View style={styles.composerAttachmentFileIcon}>
          <Ionicons
            name={attachment.kind === "audio" ? "mic-outline" : fileKindIcon(kind)}
            size={20}
            color={canOpen ? colors.accent : colors.textMuted}
          />
        </View>
        <View style={styles.composerAttachmentText}>
          <Text numberOfLines={1} style={styles.composerAttachmentName}>{attachment.name}</Text>
          <Text numberOfLines={1} style={styles.composerAttachmentKind}>{attachment.kind === "audio" ? "Audio" : kind === "download" ? "File" : kind}</Text>
        </View>
      </Pressable>
      <CompactAttachmentRemove attachment={attachment} onRemove={onRemove} />
    </View>
  );
}

function CompactAttachmentRemove({ attachment, onRemove }: { attachment: ComposerAttachment; onRemove(attachmentId: string): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${attachment.name}`}
      hitSlop={8}
      onPress={() => onRemove(attachment.id)}
      style={({ pressed }) => [styles.composerAttachmentRemove, pressed && styles.pressed]}
    >
      <Ionicons name="close" size={17} color={colors.textMuted} />
    </Pressable>
  );
}

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
  getTransferAccess,
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
  getTransferAccess?: GetTransferAccess;
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
                    {editingAttachments.length > 0 && (
                      <CompactAttachmentStrip
                        testID="queue-attachment-strip"
                        attachments={editingAttachments}
                        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                        onRemove={(attachmentId) => setEditingAttachments((current) => current.filter((candidate) => candidate.id !== attachmentId))}
                      />
                    )}
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
                  {TOKEN_SYMBOL}{goal.tokensUsed.toLocaleString()} · {formatDuration(goal.timeUsedSeconds * 1_000)}
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
    if (onStartReview === undefined) {
      setBusy(false);
      setError("Review is unavailable for this conversation");
      return;
    }
    const operation = onStartReview(target, delivery);
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
  { id: "terminal", icon: "terminal-outline", label: "Terminal" },
  { id: "ports", icon: "git-network-outline", label: "Port forward" },
  { id: "skills", icon: "extension-puzzle-outline", label: "Skill" },
  { id: "goal", icon: "flag-outline", label: "Goal" },
];

function ComposerAccessoryTray({
  fileEnabled,
  terminalEnabled,
  portForwardEnabled,
  onSelect,
}: {
  fileEnabled: boolean;
  terminalEnabled: boolean;
  portForwardEnabled: boolean;
  onSelect(action: ComposerAccessoryAction): void;
}) {
  const enabled = (action: ComposerAccessoryAction) => action === "files"
    ? fileEnabled
    : action === "terminal"
      ? terminalEnabled
      : action !== "ports" || portForwardEnabled;
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

type ComposerMenuProps = Parameters<typeof ComposerMenu>[0];

function ResourceComposerMenu({
  resources,
  controlsResourceId,
  backgroundTerminalsResourceId,
  goalResourceId,
  tunnelResourceId,
  portForwardingConnectionId,
  portForwardingServerName,
  onOpenPortForward,
  controlError,
  ...props
}: Omit<ComposerMenuProps, "controls" | "terminalsResource" | "goalResource" | "tunnelResource" | "portForwarding" | "loading" | "error"> & {
  resources: WorkspaceResourceDatabase | null;
  controlsResourceId: string | null;
  backgroundTerminalsResourceId: string | null;
  goalResourceId: string | null;
  tunnelResourceId: string | null;
  portForwardingConnectionId: string | null;
  portForwardingServerName: string;
  onOpenPortForward?(title: string, url: string): void;
  controlError: string | null;
}) {
  const controlsResource = useTurnControlsRow(resources, controlsResourceId);
  const terminalsResource = useBackgroundTerminalsRow(resources, backgroundTerminalsResourceId);
  const goalResource = useThreadGoalRow(resources, goalResourceId);
  const tunnelResource = useTunnelRow(resources, tunnelResourceId);
  const portSnapshot = useNativePortForwarding(portForwardingConnectionId);
  const controls = controlsResource?.value ?? EMPTY_TURN_CONTROLS;
  const loading = controlsResource?.status === "loading" && controlsResource.value === null;
  const serverExecution = props.thread === null ? null : latestProjectedThreadExecutionSettings(props.thread);
  const defaultModel = controls.models.find((candidate) => candidate.isDefault) ?? null;
  const selectedModel = props.selectedModel ?? serverExecution?.model ?? controls.defaults.model ?? defaultModel?.id ?? null;
  const selectedModelCatalog = controls.models.find((candidate) => candidate.id === selectedModel) ?? null;
  const selectedEffort = props.selectedEffort
    ?? serverExecution?.effort
    ?? (props.selectedModel === null && serverExecution?.model == null ? controls.defaults.effort : null)
    ?? selectedModelCatalog?.defaultEffort
    ?? null;
  const selectedPermissions = props.selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  const portForwarding = portForwardingConnectionId === null || onOpenPortForward === undefined
    ? undefined
    : nativePortForwardingManagerProps(portForwardingConnectionId, portForwardingServerName, portSnapshot, onOpenPortForward);
  return <ComposerMenu
    {...props}
    selectedModel={selectedModel}
    selectedEffort={selectedEffort}
    selectedPermissions={selectedPermissions}
    controls={controls}
    terminalsResource={terminalsResource}
    goalResource={goalResource}
    tunnelResource={tunnelResource}
    {...(portForwarding === undefined ? {} : { portForwarding })}
    loading={loading}
    error={controlError ?? controlsResource?.error ?? null}
  />;
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
  getTransferAccess,
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
  getTransferAccess?: GetTransferAccess;
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
  const model = controls.models.find((candidate) => candidate.id === selectedModel) ?? controls.models[0];
  const reasoningEfforts = model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];
  if (page === "goal") {
    if (!visible) return null;
    if (onSetGoal === undefined || onClearGoal === undefined) {
      return (
        <AppSheet
          isOpen={visible}
          onOpenChange={(open) => { if (!open) onClose(); }}
          contentProps={{ index: 0, enableDynamicSizing: true }}
        >
          <Text style={styles.errorText}>Goals are unavailable for this conversation</Text>
        </AppSheet>
      );
    }
    const currentGoal = goalResource?.goal ?? null;
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
        onSet={onSetGoal}
        onClear={onClearGoal}
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
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
          />
        ) : page === "review" ? (
          <ReviewSheet
            embedded
            visible
            onClose={onClose}
            {...(onStartReview === undefined ? {} : { onStartReview })}
          />
        ) : page === "ports" ? (
          portForwarding !== undefined
            ? <PortForwardingManager {...portForwarding} />
            : <Text style={styles.menuNotice}>Port forwarding is unavailable for this server</Text>
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
  if (page === "ports") return "Ports";
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
        {!embedded && tunnel === null && <View style={styles.previewHeader}>
          <Pressable accessibilityLabel="Close localhost preview" onPress={close} style={styles.headerIcon}>
            <Ionicons name="close" size={25} color={colors.text} />
          </Pressable>
          <View style={styles.previewIdentity}>
            <Text numberOfLines={1} style={styles.conversationTitle}>Localhost preview</Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.conversationSubtitle}>Explicit server-scoped tunnel</Text>
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
            <InternalBrowser
              url={tunnel.url}
              headers={{ Authorization: tunnel.authorization }}
              {...(!embedded ? {
                header: {
                  title: "Localhost preview",
                  closeLabel: "Close localhost preview",
                  closeIcon: "close" as const,
                  status: "LIVE",
                  onClose: close,
                },
              } : {})}
              originWhitelist={[new URL(tunnel.url).origin]}
              onHttpError={(statusCode) => setError(statusCode === 502 ? "Nothing is listening on that local service" : `Preview returned HTTP ${statusCode}`)}
              onError={setError}
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
  headerMeta,
  copyText,
  collapsible = false,
  initiallyExpanded = true,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  status?: string;
  headerMeta?: ReactNode;
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
          {headerMeta}
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

function OptimisticTurn({ item, onRetry, getTransferAccess }: {
  item: Extract<TimelineItem, { kind: "optimistic" }>;
  onRetry?(commandId: string): Promise<void>;
  getTransferAccess?: GetTransferAccess;
}) {
  const failed = item.status === "failed";
  const delivered = item.status === "delivered";
  const deliveryLabel = failed
    ? "Failed"
    : delivered
      ? "Sent"
      : item.status === "uncertain"
        ? "Checking delivery"
        : item.workspaceRequestId !== null && item.workspaceRequestId !== undefined
          ? "Preparing workspace"
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
        <ImagePreviewGroup id={`${item.scope}:${item.id}:user`}>
        <View style={styles.userMessageRow}>
          <Text style={styles.messageTime}>{formatClockTime(item.createdAt / 1_000)}</Text>
          <Bubble
            variant="user"
            testID="user-bubble"
            errorLabel="Pending user message"
            errorContext={`Delivery: ${item.id}`}
            errorResetKey={`${item.scope}:${item.id}`}
          >
          <BubbleContent>
            <UserMessageContent
              content={item.text === "" ? [] : [{ type: "text", text: item.text }]}
              localAttachments={item.attachments}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            />
          </BubbleContent>
          </Bubble>
        </View>
        </ImagePreviewGroup>
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
  renderWindow: ReturnType<typeof selectTurnRenderWindow>;
  userBlocks: RenderBlock[];
  latestAgentBlock: RenderBlock | null;
  liveActivityBlocks: RenderBlock[];
};

function projectTurnProjection(turn: Extract<TimelineItem, { kind: "turn" }>): CachedTurnProjection {
  const rawTurn = turn.turn;
  const renderWindow = selectTurnRenderWindow(rawTurn);
  const userBlocks = renderWindow.userItemIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const latestAgentItem = renderWindow.latestAgentIndex < 0 ? undefined : rawTurn.items[renderWindow.latestAgentIndex];
  const latestAgentBlock = latestAgentItem === undefined
    ? null
    : projectThreadItem(turn, latestAgentItem, renderWindow.latestAgentIndex);
  const liveActivityBlocks = renderWindow.liveActivityIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  return { renderWindow, userBlocks, latestAgentBlock, liveActivityBlocks };
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
  latestAgentRef,
  onLatestAgentLayout,
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
  latestAgentRef?(node: View | null): void;
  onLatestAgentLayout?(): void;
}) {
  const rawTurn = turn.turn;
  const { renderWindow, userBlocks, latestAgentBlock, liveActivityBlocks } = projectTurnProjection(turn);
  const liveActivityEntries = renderWindow.liveActivityIndexes.flatMap((itemIndex, projectionIndex) => {
    const block = liveActivityBlocks[projectionIndex];
    return block === undefined ? [] : [{ index: itemIndex, block }];
  });
  const liveActivitySequence = rawTurn.status === "inProgress"
    ? activeTurnSequence(liveActivityEntries, renderWindow.collapsedActivityIndexes)
    : [];
  const liveMarkdownProjections = new Map<string, LiveMarkdownProjection>();
  const visibleLiveActivitySequence = liveActivitySequence.map((part) => {
    if (part.kind !== "agent") return part;
    const itemId = typeof part.block.raw.id === "string" ? part.block.raw.id : null;
    const projection = projectCachedLiveMarkdown(
      part.block.key,
      part.block.body ?? "",
      itemId !== null && !isAgentMessageStillStreaming(rawTurn, itemId),
    );
    liveMarkdownProjections.set(part.block.key, projection);
    return { ...part, block: { ...part.block, body: projection.visibleSource } };
  });
  const latestAgentProjection = rawTurn.status === "inProgress" && latestAgentBlock !== null
    ? liveMarkdownProjections.get(latestAgentBlock.key)
      ?? projectCachedLiveMarkdown(latestAgentBlock.key, latestAgentBlock.body ?? "")
    : null;
  if (latestAgentProjection !== null && latestAgentBlock !== null) {
    liveMarkdownProjections.set(latestAgentBlock.key, latestAgentProjection);
  }
  const visibleLatestAgentBlock = latestAgentProjection === null || latestAgentBlock === null
    ? latestAgentBlock
    : { ...latestAgentBlock, body: latestAgentProjection.visibleSource };
  const copyText = latestAgentBlock?.body ?? "";
  const userCopyText = userBlocks.map((block) => protocolCopyText(block)).join("\n");
  const canForkThrough = rawTurn.status !== "inProgress" && onForkThroughTurn !== undefined;
  const completedWithoutFinal = rawTurn.status === "completed" && latestAgentBlock === null;
  const completedActivityCount = rawTurn.status === "inProgress" ? 0 : completedActivityItemCount(rawTurn);
  const agentBubbleFill = latestAgentBlock?.content?.fields["/text"] !== undefined
    || (latestAgentBlock !== null && richMarkdownLayout(latestAgentBlock.body ?? "") === "fill");
  const hasAgentContent = (rawTurn.status !== "inProgress"
    ? rawTurn.itemsView !== "full" || completedActivityCount > 0 || latestAgentBlock !== null
    : visibleLiveActivitySequence.length > 0 || latestAgentBlock !== null)
    || pendingRequest !== null
    || completedWithoutFinal;
  const showAgentBubble = hasAgentContent || rawTurn.status !== "inProgress";

  return (
    <TurnUsageContext.Provider value={usage}>
    <PrivateAssetRecoveryProvider {...(onLoadItems === undefined ? {} : { recover: () => onLoadItems(turn.id) })}>
    <View testID="turn-group" style={styles.turnGroup}>
      {userBlocks.length > 0 && (
        <View style={styles.userTurnCluster}>
        <RecoverableRenderBoundary scope="bubble" label="User message" context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`} resetKey={`${turn.key}:user`}>
        <MessageContextMenu copyText={userCopyText} forkEnabled={canForkThrough} {...(onForkThroughTurn === undefined ? {} : { onFork: () => onForkThroughTurn(turn.id) })}>
          <ImagePreviewGroup id={`${turn.key}:user`}>
          <View style={styles.userMessageRow}>
          {rawTurn.startedAt !== null && <Text style={styles.messageTime}>{formatClockTime(rawTurn.startedAt)}</Text>}
          <Bubble
            variant="user"
            testID="user-bubble"
            errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
            errorResetKey={`${turn.key}:user`}
          >
          <BubbleContent>
            <View style={styles.userMessageContent}>
              {userBlocks.map((block, index) => (
                <View key={`${block.key}:${index}`} style={styles.userMessageBlock}>
                  <UserMessageContent
                    content={Array.isArray(block.raw.content) ? block.raw.content : []}
                    projectedAttachments={block.raw.codewideAttachments}
                    {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  />
                  <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
                </View>
              ))}
            </View>
          </BubbleContent>
          </Bubble>
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
          <Bubble
            variant="agent"
            fill={agentBubbleFill}
            testID="codex-bubble"
            errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
            errorResetKey={`${turn.key}:agent`}
          >
          <BubbleContent>
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
            <AgentResponseMarkdown
              block={latestAgentBlock}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(latestAgentRef === undefined ? {} : { visibilityRef: latestAgentRef })}
              {...(onLatestAgentLayout === undefined ? {} : { onVisibilityLayout: onLatestAgentLayout })}
            />
          )}
          {rawTurn.status === "inProgress" && visibleLiveActivitySequence.map((part, index) => part.kind === "collapsedActivity"
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
              ? <LiveAgentResponse
                  key={`${part.key}:${index}`}
                  cacheKey={part.block.key}
                  projection={liveMarkdownProjections.get(part.block.key)!}
                  streamMetricKey={liveStreamMetricKey(turn.connectionId, turn.threadId, rawTurn.id, part.block.raw.id)}
                />
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
          </BubbleContent>
          </Bubble>
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
    </TurnUsageContext.Provider>
  );
}

type LiveContentMode = "markdown" | "code";

function StableLiveTextSegment({ text, mode, streaming = false }: { text: string; mode: LiveContentMode; streaming?: boolean }) {
  return mode === "markdown"
    ? <RichMarkdown source={text} streaming={streaming} />
    : <Text selectable style={styles.codeLine}>{text}</Text>;
}

function AppendOnlyLiveContent({ cacheKey, source, mode, streamMetricKey = null, markdownProjection }: { cacheKey: string; source: string; mode: LiveContentMode; streamMetricKey?: string | null; markdownProjection?: LiveMarkdownProjection }) {
  const singleMarkdownTree = mode === "markdown";
  const projection = markdownProjection ?? projectCachedLiveText(cacheKey, source);
  const visibleRemainder = markdownProjection?.visibleRemainder ?? projection.remainder;
  const visibleMarkdownSource = singleMarkdownTree
    ? markdownProjection?.visibleSource ?? [...projection.segments, visibleRemainder].join("")
    : "";
  return (
    <>
    <View
      testID={mode === "markdown" ? "live-agent-response" : "live-tool-output"}
      style={[styles.liveAgentResponse, mode === "code" && styles.liveAgentResponseFill, mode === "markdown" && styles.liveMarkdownResponse]}
    >
      {singleMarkdownTree
        ? visibleMarkdownSource === "" ? null : <StableLiveTextSegment text={visibleMarkdownSource} mode={mode} streaming />
        : <>
            {projection.segments.map((segment, index) => <StableLiveTextSegment key={`${cacheKey}:${index}`} text={segment} mode={mode} />)}
            {visibleRemainder !== "" && <StableLiveTextSegment text={visibleRemainder} mode={mode} />}
          </>}
    </View>
    {streamMetricKey === null ? null : (
      <CommitOnChangeProbe
        scope={streamMetricKey}
        revision={source}
        onCommit={() => { if (source !== "") recordLiveRenderCommit(streamMetricKey); }}
      />
    )}
    </>
  );
}

function LiveAgentResponse({ cacheKey, projection, streamMetricKey }: { cacheKey: string; projection: LiveMarkdownProjection; streamMetricKey: string | null }) {
  return <AppendOnlyLiveContent cacheKey={cacheKey} source={projection.source} mode="markdown" streamMetricKey={streamMetricKey} markdownProjection={projection} />;
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
  const outputFootprint = activityOutputFootprint(indexes.flatMap((index) => {
    const rawItem = rawTurn.items[index];
    if (rawItem === undefined || rawItem.type !== "commandExecution") return [];
    const raw = rawItem as unknown as Record<string, unknown>;
    return [{ raw, visibleOutput: typeof raw.aggregatedOutput === "string" ? raw.aggregatedOutput : "" }];
  }));

  return (
    <TurnActivity
      expanded={isExpanded}
      forceExpandCards={forceExpanded}
      label={`${turnActivityLabel(activityKinds, compact)} · ${indexes.length}`}
      outputFootprint={outputFootprint}
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
  const outputFootprint = activityItems.length > 0
    ? activityOutputFootprint(activityItems.flatMap(({ rawItem }) => {
        if (rawItem.type !== "commandExecution") return [];
        const raw = rawItem as unknown as Record<string, unknown>;
        return [{ raw, visibleOutput: typeof raw.aggregatedOutput === "string" ? raw.aggregatedOutput : "" }];
      }))
    : activitySummary?.outputFootprint ?? null;
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
      outputFootprint={outputFootprint}
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
      outputFootprint={activityOutputFootprint(part.blocks.flatMap((block) => block.kind === "commandExecution"
        ? [{ raw: block.raw, visibleOutput: block.body }]
        : []))}
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

function TurnActivity({ expanded, forceExpandCards = false, loading = false, label, outputFootprint = null, onToggle, children }: { expanded: boolean; forceExpandCards?: boolean; loading?: boolean; label: string; outputFootprint?: OutputFootprintProjection | null; onToggle(): void; children: React.ReactNode }) {
  return (
    <View testID="turn-activity" style={[styles.turnActivity, expanded && styles.turnActivityExpanded]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity ${label}`} hitSlop={10} onPress={onToggle} style={({ pressed }) => [styles.turnActivityToggle, pressed && styles.pressed]}>
        <View style={styles.activityIconSlot}><Ionicons name="construct-outline" size={13} color={colors.textMuted} /></View>
        {loading
          ? <WaveText testID="turn-activity-loading-shimmer" text={label} style={styles.turnActivityLabel} containerStyle={styles.turnActivityLabelWave} />
          : <Text numberOfLines={1} style={styles.turnActivityLabel}>{label}</Text>}
        <OutputFootprintMetric footprint={outputFootprint} />
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
      {tokenUsage !== null && (
        <View accessible accessibilityLabel={`${tokenUsage.inputTokens.toLocaleString()} input tokens, ${tokenUsage.outputTokens.toLocaleString()} output tokens`} style={styles.turnTokenMetrics}>
          <Text style={styles.turnMetaText}>{TOKEN_SYMBOL}</Text>
          {status === "inProgress"
            ? <AnimatedNumber value={tokenUsage.inputTokens} format={compactNumberFormat} prefix="↓" style={styles.turnMetaText} />
            : <Text style={styles.turnMetaText}>↓{compactNumber(tokenUsage.inputTokens)}</Text>}
          {status === "inProgress"
            ? <AnimatedNumber value={tokenUsage.outputTokens} format={compactNumberFormat} prefix="↑" style={styles.turnMetaText} />
            : <Text style={styles.turnMetaText}>↑{compactNumber(tokenUsage.outputTokens)}</Text>}
        </View>
      )}
      {estimatedCost !== null && <CostBreakdownPopover estimate={estimatedCost} animated={status === "inProgress"} />}
    </View>
  );
}

function CalmSpinner({ size, color }: { size: number; color: string; durationMs: number }) {
  const reducedMotion = useReducedMotionPreference();
  if (reducedMotion) {
    return (
      <View
        testID="calm-running-spinner"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.25,
          borderColor: color,
          borderTopColor: "transparent",
          opacity: 0.72,
        }}
      />
    );
  }
  return (
    <ActivityIndicator
      testID="calm-running-spinner"
      animating
      color={color}
      size={size}
      style={{
        width: size,
        height: size,
        opacity: 0.72,
      }}
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
        <UserMessageContent content={content} projectedAttachments={block.raw.codewideAttachments} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
        <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
      </View>
    );
  }
  if (block.kind === "agentMessage") {
    const reviewTarget: ContentReviewTarget = {
      id: `agent-response:${block.key}`,
      label: "Completed agent response",
      reference: block.key,
    };
    return (
      <View style={styles.agentMessage}>
        <CompleteAgentMarkdown source={block.body ?? ""} reviewTarget={reviewTarget} />
        <MemoryCitationList value={block.raw.memoryCitation} />
        <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
      </View>
    );
  }
  if (block.kind === "tokenUsage") return <TokenUsageProtocolBlock block={block} />;
  if (block.kind === "commandExecution") return <CommandExecutionProtocolBlock block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />;
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
              code={block.kind === "fileChange" || block.kind === "turnDiff"}
              collapsible={block.collapsible}
              {...(block.kind === "turnDiff" || block.kind === "fileChange" ? { codeVariant: "diff" as const, language: "diff" } : {})}
            />
      )}
      {block.durationMs !== null && <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>}
      <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
    </Card>
  );
}

function CommandExecutionProtocolBlock({ block, getTransferAccess }: {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const command = commandActivityInput(block.raw, block.title);
  const running = activeToolCall || block.status === "inProgress" || block.status === "running";
  const outputFootprint = commandOutputFootprint(block.raw, block.body ?? "");
  const hasExternalOutput = block.content !== null && [
    ...Object.keys(block.content.fields),
    ...(block.content.whole === null ? [] : ["/"]),
  ].some((pointer) => pointer === "/aggregatedOutput" || pointer.endsWith("/aggregatedOutput") || pointer === "/");
  return (
    <Card
      title={commandActivityTitle(command)}
      icon="terminal-outline"
      {...(block.status === null ? {} : { status: block.status })}
      headerMeta={<OutputFootprintMetric footprint={outputFootprint} />}
      collapsible
      initiallyExpanded={false}
    >
      <View style={styles.commandActivitySection}>
        <View style={styles.commandActivitySectionHeader}>
          <Text style={styles.commandActivitySectionLabel}>Input</Text>
          <CopyButton text={command} compact />
        </View>
        <NativeCodeBlock value={command} language="shellscript" maxHeight={TOOL_RESULT_MAX_HEIGHT} fillAvailableWidth truncate={false} />
      </View>
      <View style={styles.commandActivitySection}>
        <View style={styles.commandActivitySectionHeader}>
          <Text style={styles.commandActivitySectionLabel}>Output</Text>
          {block.body !== null && block.body !== "" && <CopyButton text={block.body} compact />}
        </View>
        {block.body !== null && block.body !== ""
          ? <ProtocolBody body={block.body} code collapsible={block.collapsible} expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT} section="output" codeVariant="terminal" showCopyAction={false} />
          : <Text style={styles.menuNotice}>{hasExternalOutput ? "Full output is available below." : running ? "Waiting for output…" : "No output"}</Text>}
      </View>
      {block.durationMs !== null && <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>}
      <LargeContentControls block={block} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />
    </Card>
  );
}

function OutputFootprintMetric({ footprint }: { footprint: OutputFootprintProjection | null }) {
  const usage = useContext(TurnUsageContext);
  if (footprint === null || footprint.estimatedTokens === 0) return null;
  const costUsd = estimatedOutputInputCostUsd(footprint, usage);
  const label = costUsd === null
    ? `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens`
    : `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens, ${formatEstimatedTurnCost(costUsd)} API-equivalent input cost`;
  const value = `≈${TOKEN_SYMBOL}${compactNumber(footprint.estimatedTokens)}${costUsd === null ? "" : ` · ≈${formatEstimatedTurnCost(costUsd)}`}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.outputFootprintMetric}>
      <Text numberOfLines={1} style={styles.outputFootprintMetricText}>{value}</Text>
    </View>
  );
}

const CONTENT_VIEW_CHUNK_BYTES = 64 * 1024;

function AgentResponseMarkdown({ block, getTransferAccess, visibilityRef, onVisibilityLayout }: {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
  visibilityRef?(node: View | null): void;
  onVisibilityLayout?(): void;
}) {
  const resourceScope = usePrivateFileAccessScope();
  const reviewTarget: ContentReviewTarget = {
    id: `agent-response:${block.key}`,
    label: "Completed agent response",
    reference: block.key,
  };
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
      <View ref={visibilityRef} onLayout={onVisibilityLayout} style={styles.agentMarkdownDocument}>
        <CompleteAgentMarkdown source={block.body ?? ""} reviewTarget={reviewTarget} />
        {loading && <ActivityIndicator accessibilityLabel="Loading complete response" size="small" color={colors.textMuted} />}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }
  return (
    <View ref={visibilityRef} onLayout={onVisibilityLayout} style={styles.agentMarkdownDocument}>
      {segments.map((segment, index) => <RichMarkdown key={`${reference.id}:${index}`} source={segment} reviewTarget={reviewTarget} reviewPathPrefix={`segment-${index}`} />)}
      {loading && <ActivityIndicator accessibilityLabel="Loading complete response" size="small" color={colors.textMuted} />}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

function markdownSegmentsWeight(segments: string[]): number {
  return segments.reduce((bytes, segment) => bytes + segment.length * 2, 0);
}

function CompleteAgentMarkdown({ source, reviewTarget }: { source: string; reviewTarget?: ContentReviewTarget }) {
  const segments = projectCompleteMarkdown(source);
  return (
    <View style={styles.agentMarkdownDocument}>
      {segments.map((segment, index) => <RichMarkdown key={index} source={segment} {...(reviewTarget === undefined ? {} : { reviewTarget, reviewPathPrefix: `segment-${index}` })} />)}
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
  const open = useEvent((request: LargeContentViewerRequest) => {
    fullscreenOverlay.present(({ close }) => (
      <LargeContentViewerSession initialRequest={request} onClose={close} />
    ));
  });
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
  const resourceNamespace = useId();
  const [selection, setSelection] = useState({ request: initialRequest, offset: 0 });
  const resourceRevision = `${selection.request.reference.id}:${selection.request.reference.contentType}:${selection.offset}`;
  const content = useEphemeralAsyncResource<PrivateAssetTextResult>(
    `large-content:${resourceNamespace}`,
    resourceRevision,
    async (_publish, signal) => await readPrivateAssetText(
      { kind: "content", id: selection.request.reference.id },
      selection.request.getTransferAccess,
      {
        offset: selection.offset,
        limit: CONTENT_VIEW_CHUNK_BYTES,
        accept: selection.request.reference.contentType,
        signal,
      },
    ),
  );
  const selected: LargeContentViewerSelection = {
    ...selection.request,
    offset: selection.offset,
    nextOffset: content.value?.nextOffset ?? selection.offset,
    text: content.value?.text ?? null,
    loading: content.status === "idle" || content.status === "loading",
    error: content.error,
  };
  const load = (request: LargeContentViewerRequest, offset: number) => {
    setSelection({ request, offset });
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
      onClose={onClose}
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
    { icon: "speedometer-outline", label: "Total", value: numberValue(total.totalTokens) },
    { icon: "log-in-outline", label: "Input", value: numberValue(total.inputTokens) },
    { icon: "log-out-outline", label: "Output", value: numberValue(total.outputTokens) },
    { icon: "flash-outline", label: "Last turn", value: numberValue(last.totalTokens) },
    { icon: "scan-outline", label: "Context window", value: numberValue(block.raw.modelContextWindow) },
  ];
  return (
    <View style={styles.tokenStrip}>
      <View style={styles.tokenStripTitle}>
        <Ionicons name="speedometer-outline" size={17} color={colors.textMuted} />
        <Text style={styles.cardTitle}>Usage</Text>
      </View>
      <View style={styles.tokenMetrics}>
        {metrics.map((metric) => metric.value === null ? null : (
          <View key={metric.label} accessible accessibilityLabel={`${metric.label}: ${metric.value.toLocaleString()} tokens`} style={styles.tokenMetric}>
            <Ionicons name={metric.icon} size={14} color={colors.textMuted} />
            <Text style={styles.tokenMetricValue}>{TOKEN_SYMBOL}{compactNumber(metric.value)}</Text>
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

function UserMessageContent({
  content,
  projectedAttachments,
  localAttachments = [],
  getTransferAccess,
}: {
  content: unknown[];
  projectedAttachments?: unknown;
  localAttachments?: readonly ComposerAttachment[];
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const parts = content.flatMap((raw) => raw !== null && typeof raw === "object" && !Array.isArray(raw) ? [raw as Record<string, unknown>] : []);
  const attachments = projectUserMessageAttachments(content, projectedAttachments, localAttachments);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const otherAttachments = attachments.filter((attachment) => attachment.kind !== "image");
  const bodyParts = parts.filter((part) => !["image", "localImage", "audio", "localAudio", "mention"].includes(String(part.type ?? "")));
  return (
    <View style={[styles.userMessageContent, imageAttachments.length > 0 && styles.userMessageMediaContent]}>
      {imageAttachments.length > 0 && (
        <UserImageGallery
          attachments={imageAttachments}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      )}
      {bodyParts.map((part, index) => {
        const type = typeof part.type === "string" ? part.type : "unknown";
        if (type === "text" && typeof part.text === "string") {
          const normalized = normalizeUserMessage(part.text);
          return normalized.text === "" ? null : <CollapsibleUserMessage key={index} text={normalized.text} partIndex={index} />;
        }
        const label = type === "skill" && typeof part.name === "string" ? `Skill · ${part.name}` : `Attachment · ${type}`;
        return (
          <View key={index} style={styles.attachmentChip}>
            <Ionicons name="attach-outline" size={15} color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.attachmentText}>{label}</Text>
          </View>
        );
      })}
      {otherAttachments.map((attachment) => (
        <UserMessageAttachmentChip
          key={`${attachment.kind}:${attachment.name}:${userMessageAttachmentReference(attachment)}`}
          attachment={attachment}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      ))}
    </View>
  );
}

function CollapsibleUserMessage({ text, partIndex }: { text: string; partIndex: number }) {
  const canCollapse = text.length > USER_MESSAGE_COLLAPSED_CHARS || text.split("\n").length > USER_MESSAGE_COLLAPSED_LINES;
  const [expanded, setExpanded] = usePersistentExpansion(`user-message:${partIndex}:${textFingerprint(text)}`, false);
  return (
    <View style={styles.userMessageTextBlock}>
      <RichMarkdown
        source={text}
        {...(!expanded && canCollapse ? { maxLines: USER_MESSAGE_COLLAPSED_LINES } : {})}
      />
      {canCollapse && (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((current) => !current)} style={styles.userMessageExpandButton}>
          <Text style={styles.userMessageExpandText}>{expanded ? "Collapse" : "Show full message"}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function UserMessageAttachmentChip({ attachment, getTransferAccess }: {
  attachment: UserMessageAttachment;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  if (attachment.kind === "file" && attachment.source.type === "path") {
    return <DocumentAttachmentChip name={attachment.name} path={attachment.source.path} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />;
  }
  return (
    <View style={styles.attachmentChip}>
      <Ionicons name={attachment.kind === "audio" ? "mic-outline" : "attach-outline"} size={15} color={colors.textMuted} />
      <Text numberOfLines={1} style={styles.attachmentText}>{attachment.name}</Text>
    </View>
  );
}

function userMessageAttachmentReference(attachment: UserMessageAttachment): string {
  const source = attachment.source;
  if (source.type === "path") return source.path;
  if (source.type === "content") return source.asset.id;
  if (source.type === "url") return source.url;
  return `${source.rootId}:${source.path}`;
}

function UserImageGallery({ attachments, getTransferAccess }: { attachments: UserMessageAttachment[]; getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }> }) {
  return (
    <View testID="user-image-gallery" style={styles.userImageGallery}>
      {attachments.map((attachment, index) => {
        const hero = attachments.length === 1 || (attachments.length % 2 === 1 && index === 0);
        const containerStyle = hero ? styles.userImageGalleryHero : styles.userImageGalleryTile;
        const source = attachment.source;
        if (source.type === "content") {
          if (getTransferAccess !== undefined) {
            return (
              <ScopedPrivateAssetImage
                key={source.asset.id}
                previewId={`user-private-image:${source.asset.id}`}
                label={attachment.name}
                reference={`private-asset:${source.asset.id}`}
                source={{ kind: "content", id: source.asset.id }}
                getTransferAccess={getTransferAccess}
                containerStyle={containerStyle}
                order={index}
              />
            );
          }
          return <View key={index} style={[styles.userImage, containerStyle]}><Text style={styles.menuNotice}>Attached image</Text></View>;
        }
        if (source.type === "url") {
          return <OpenableImage key={source.url} previewId={`user-image:${index}:${source.url}`} label={attachment.name} source={{ uri: source.url }} variant="user" containerStyle={containerStyle} order={index} reference={source.url} />;
        }
        if (source.type === "path") {
          return getTransferAccess === undefined
            ? <View key={source.path} style={[styles.userImage, containerStyle]}><Text style={styles.menuNotice}>{attachment.name}</Text></View>
            : <ScopedRemoteImage key={source.path} previewId={`user-local-image:${index}:${source.path}`} path={source.path} getTransferAccess={getTransferAccess} containerStyle={containerStyle} order={index} />;
        }
        if (source.type === "scoped") {
          return getTransferAccess === undefined
            ? <View key={`${source.rootId}:${source.path}`} style={[styles.userImage, containerStyle]}><Text style={styles.menuNotice}>{attachment.name}</Text></View>
            : <ScopedPrivateAssetImage
                key={`${source.rootId}:${source.path}`}
                previewId={`user-scoped-image:${source.rootId}:${source.path}`}
                label={attachment.name}
                reference={`scoped:${source.rootId}:${source.path}`}
                source={{ kind: "scoped", rootId: source.rootId, path: source.path }}
                getTransferAccess={getTransferAccess}
                containerStyle={containerStyle}
                order={index}
              />;
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

function ProtocolBody({ body, code, collapsible, expandedMaxHeight, section = "body", language = "text", codeVariant = "code", showCopyAction = true }: { body: string; code: boolean; collapsible: boolean; expandedMaxHeight?: number; section?: string; language?: string; codeVariant?: "code" | "diff" | "terminal"; showCopyAction?: boolean }) {
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
          {showCopyAction && <CopyButton text={body} />}
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
  servers: ThreadListServer[];
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

function ConnectionSheet({
  visible,
  openedAt,
  localReady,
  localError,
  onRetryStartup,
  onClose,
  onSave,
  initialCode,
}: {
  visible: boolean;
  openedAt: number;
  localReady: boolean;
  localError: string | null;
  onRetryStartup(): Promise<void>;
  onClose(): void;
  onSave(input: ConnectionInput): Promise<void>;
  initialCode: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (!saving) onClose();
  };
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => { if (!open) close(); }}
      contentProps={{ index: 0, snapPoints: ["55%", "90%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      <ConnectionSheetSession
        visible={visible}
        openedAt={openedAt}
        localReady={localReady}
        localError={localError}
        onRetryStartup={onRetryStartup}
        onClose={close}
        onSave={onSave}
        initialCode={initialCode}
        saving={saving}
        setSaving={setSaving}
      />
    </AppSheet>
  );
}

function ConnectionSheetSession({
  visible,
  openedAt,
  localReady,
  localError,
  onRetryStartup,
  onClose,
  onSave,
  initialCode,
  saving,
  setSaving,
}: {
  visible: boolean;
  openedAt: number;
  localReady: boolean;
  localError: string | null;
  onRetryStartup(): Promise<void>;
  onClose(): void;
  onSave(input: ConnectionInput): Promise<void>;
  initialCode: string | null;
  saving: boolean;
  setSaving(value: boolean): void;
}) {
  const openIdentity = visible ? initialCode === null ? "manual" : `code:${initialCode}` : null;
  const initialPairing = initialCode === null ? null : pairingParseResult(initialCode);
  const initialValue = initialPairing?.value ?? null;
  const [presentedOpenIdentity, setPresentedOpenIdentity] = useState(openIdentity);
  const [mode, setMode] = useState<"choose" | "review" | "manual" | "success">(initialValue === null ? "choose" : "review");
  const [displayName, setDisplayName] = useState(initialValue?.displayName ?? "");
  const [emoji, setEmoji] = useState(initialValue?.emoji ?? "🖥️");
  const [endpoint, setEndpoint] = useState(initialValue?.endpoint ?? "");
  const [token, setToken] = useState(initialValue?.pairingToken ?? "");
  const [tlsPinSha256, setTlsPinSha256] = useState(initialValue?.tlsPinSha256 ?? "");
  const [expiresAt, setExpiresAt] = useState<number | null>(initialValue?.expiresAt ?? null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const fullscreenOverlay = useAppFullscreenOverlay();
  const [error, setError] = useState<string | null>(initialPairing?.error ?? null);
  if (openIdentity !== null && openIdentity !== presentedOpenIdentity) {
    // This is a new pairing session, not synchronization with an external
    // system. Adjust the session state during render so React discards the
    // stale render before committing it; keeping the child mounted preserves
    // AppSheet's close animation and avoids a post-paint reset effect.
    setPresentedOpenIdentity(openIdentity);
    setMode(initialValue === null ? "choose" : "review");
    setDisplayName(initialValue?.displayName ?? "");
    setEmoji(initialValue?.emoji ?? "🖥️");
    setEndpoint(initialValue?.endpoint ?? "");
    setToken(initialValue?.pairingToken ?? "");
    setTlsPinSha256(initialValue?.tlsPinSha256 ?? "");
    setExpiresAt(initialValue?.expiresAt ?? null);
    setError(initialPairing?.error ?? null);
  } else if (openIdentity === null && presentedOpenIdentity !== null) {
    // Preserve the rendered contents through the closing animation. Marking
    // the session closed makes the next open a new identity and resets it.
    setPresentedOpenIdentity(null);
  }
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
  const close = () => {
    if (saving) return;
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
  const openPairingScanner = async () => {
    let permission = cameraPermission;
    if (permission?.granted !== true && (permission === null || permission.canAskAgain)) {
      permission = await requestCameraPermission();
    }
    fullscreenOverlay.present(({ close: closeScanner }) => (
      <PairingQrScanner
        initialPermission={permission}
        requestPermission={requestCameraPermission}
        onClose={closeScanner}
        onScan={(raw) => {
          const message = consumeCode(raw);
          if (message === null) closeScanner();
          return message;
        }}
      />
    ));
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
      setSaving(false);
      onClose();
      return;
    } catch (cause) {
      setError(humanPairingError(cause));
    }
    setSaving(false);
  };
  const endpointLabel = pairingEndpointLabel(endpoint);
  const minutesLeft = expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - openedAt) / 60_000));
  return (
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
                    <Pressable accessibilityRole="button" accessibilityLabel="Scan pairing QR" onPress={() => void openPairingScanner()} style={styles.pairingPrimaryAction}>
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

function PairingQrScanner({
  initialPermission,
  requestPermission,
  onClose,
  onScan,
}: {
  initialPermission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  onClose(): void;
  onScan(raw: string): string | null;
}) {
  const [permission, setPermission] = useState(initialPermission);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
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
            <Pressable onPress={() => void (permission.canAskAgain ? requestPermission().then(setPermission) : Linking.openSettings())} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{permission.canAskAgain ? "Allow camera" : "Open settings"}</Text></Pressable>
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
            <Text selectable style={styles.settingsVersion}>Version {Constants.expoConfig?.version ?? "unknown"}</Text>
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
  const codeCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loginActionBusy, setLoginActionBusy] = useState(false);
  const profiles = accountPool?.profiles ?? [];
  const profileIds = profiles.map((profile) => profile.id).sort().join("|");
  const pendingAccountLogin = pendingAccountLoginState?.profileIds === profileIds
    ? pendingAccountLoginState
    : null;

  useUnmount(() => {
    if (codeCopiedTimerRef.current !== null) clearTimeout(codeCopiedTimerRef.current);
  });

  const markCodeCopied = () => {
    if (codeCopiedTimerRef.current !== null) clearTimeout(codeCopiedTimerRef.current);
    setCodeCopied(true);
    codeCopiedTimerRef.current = setTimeout(() => {
      codeCopiedTimerRef.current = null;
      setCodeCopied(false);
    }, 2_400);
  };

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
    markCodeCopied();
  };
  const openAccountSignIn = async () => {
    if (pendingAccountLogin === null || loginActionBusy) return;
    setLoginActionBusy(true);
    setError(null);
    try {
      await Clipboard.setStringAsync(pendingAccountLogin.userCode);
      markCodeCopied();
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

function threadSelectionKey(thread: Pick<ThreadListItem, "id" | "serverId">): string {
  return `${thread.serverId}\u0000${thread.id}`;
}

function parseThreadSelectionKey(value: string | null): { connectionId: string; threadId: string } | null {
  if (value === null) return null;
  const separator = value.indexOf("\u0000");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { connectionId: value.slice(0, separator), threadId: value.slice(separator + 1) };
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

function serverGlyph(server: Pick<ThreadListServer, "emoji" | "name">): string {
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

function deduplicateThreadSummaries(rows: readonly StoredThreadSummary[]): StoredThreadSummary[] {
  const byKey = new Map<string, StoredThreadSummary>();
  for (const row of rows) byKey.set(`${row.connectionId}\u0000${row.remoteThreadId}`, row);
  return [...byKey.values()];
}

function storedThreadToListItem(thread: StoredThreadSummary): ThreadListItem {
  const state = thread.pendingRequestCount > 0
    ? "approval"
    : thread.status.type === "active" ? "running" : thread.status.type === "systemError" ? "failed" : null;
  return {
    id: thread.remoteThreadId,
    serverId: thread.connectionId,
    title: thread.name ?? firstLine(thread.preview) ?? "New Chat",
    preview: thread.preview,
    timestamp: thread.recencyAt ?? thread.updatedAt,
    pinned: thread.pinned,
    archived: thread.archived,
    unread: thread.unread,
    ...(state === null ? {} : { state }),
  };
}

function subagentThreadListItem(summary: StoredThreadSummary, thread: Thread, connectionId: string): ThreadListItem {
  return {
    id: thread.id,
    serverId: connectionId,
    title: subagentDisplayName(summary),
    preview: summary.preview,
    timestamp: summary.recencyAt ?? summary.updatedAt,
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
  sidebarHeader: { paddingLeft: spacing.sm, paddingRight: 0, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  serverTitleRow: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  serverTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: "700" },
  headerIcon: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.large },
  headerMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  topBarAction: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.large },
  topBarActionActive: { backgroundColor: colors.primaryContainer },
  threadSearchRow: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  threadSearchBox: { flex: 1, minWidth: 0 },
  threadFilterButton: { width: 40, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow, position: "relative" },
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
  threadMeta: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 5 },
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
  conversation: { flex: 1, minWidth: 0, backgroundColor: colors.background },
  conversationKeyboard: { flex: 1, minWidth: 0, alignSelf: "stretch", backgroundColor: colors.background },
  emptyConversation: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.background },
  emptyText: { color: colors.textMuted, fontSize: 16 },
  newChatEmptyState: { maxWidth: 520, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.lg },
  newChatPrompt: { color: colors.text, ...typeScale.titleLarge, textAlign: "center" },
  newChatProjectButton: { maxWidth: "100%", minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xxs, paddingHorizontal: spacing.sm, borderRadius: radii.large },
  newChatProjectText: { minWidth: 0, flexShrink: 1, color: colors.accent, ...typeScale.titleMedium },
  newChatWorkspaceButton: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xxs, paddingHorizontal: spacing.sm, borderRadius: radii.large },
  newChatWorkspaceText: { color: colors.textMuted, ...typeScale.labelLarge },
  projectSearch: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.xs, borderRadius: radii.large, backgroundColor: colors.surfaceContainerLow },
  projectSearchInput: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.bodyLarge, paddingVertical: 0 },
  projectPickerProgress: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  conversationHeader: { minHeight: 56, paddingLeft: spacing.xs, paddingRight: 0, flexDirection: "row", alignItems: "center", gap: 0, backgroundColor: colors.surface },
  conversationIdentity: { flex: 1, minWidth: 0 },
  conversationTitle: { color: colors.text, ...typeScale.titleMedium },
  emojiText: { fontFamily: Platform.select({ web: "system-ui", default: "sans-serif" }) },
  conversationSubtitle: { color: colors.textMuted, ...typeScale.labelMedium, marginTop: 1 },
  threadSearchBar: { minHeight: 50, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  threadSearchCount: { color: colors.textMuted, fontSize: 11, minWidth: 34, textAlign: "right" },
  conversationScroll: { flex: 1 },
  conversationKeyboardBody: { flex: 1, minHeight: 0 },
  timelineShell: { flex: 1 },
  historyLoadingIndicator: { position: "absolute", top: spacing.xs, left: 0, right: 0, zIndex: 11, alignItems: "center" },
  historyLoadingIndicatorPill: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerHigh },
  livePlanFloat: { position: "absolute", left: 0, right: 0, bottom: spacing.sm, zIndex: 10, alignItems: "center" },
  conversationContent: { paddingHorizontal: spacing.xs, paddingTop: 6 },
  conversationContentLivePlanInset: { paddingBottom: 58 },
  conversationContentCompact: { flexGrow: 1, justifyContent: "flex-end" },
  conversationContentWide: { flexGrow: 1, paddingLeft: 52, paddingRight: spacing.md },
  timelineItem: { width: "100%", maxWidth: 880, alignSelf: "center" },
  timelineItemWide: { alignSelf: "flex-start" },
  turnGroup: { gap: 5 },
  messageContextRoot: { alignSelf: "stretch", position: "relative" },
  turnMessages: { gap: 3 },
  turnBlock: { width: "100%" },
  turnFooter: { minHeight: TURN_FOOTER_MIN_HEIGHT, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 5 },
  turnTokenMetrics: { flexDirection: "row", alignItems: "baseline", gap: 3 },
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
  userBubbleText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  userMessageContent: { minWidth: 0, gap: 6 },
  userMessageMediaContent: { width: 320, maxWidth: "100%" },
  userMessageBlock: { minWidth: 0 },
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
  outputFootprintMetric: { flexShrink: 0, justifyContent: "center" },
  outputFootprintMetricText: { color: colors.textDim, fontSize: 9, lineHeight: 13, fontVariant: ["tabular-nums"] },
  turnActivityList: { width: "100%", minWidth: 0, maxWidth: "100%", gap: 5, paddingTop: 2, paddingLeft: 18, paddingRight: 1, paddingBottom: 2 },
  activityMoreButton: { minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  activityMoreText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  copyButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  copyButtonCompact: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  agentText: { minWidth: 0, maxWidth: "100%", color: colors.text, fontSize: 13, lineHeight: 18 },
  liveAgentResponse: { minWidth: 0, maxWidth: "100%", alignSelf: "flex-start" },
  liveAgentResponseFill: { width: "100%", alignSelf: "stretch" },
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
  commandActivitySection: { width: "100%", minWidth: 0, maxWidth: "100%", gap: 3 },
  commandActivitySectionHeader: { minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  commandActivitySectionLabel: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
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
  composerContextContent: { alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, paddingTop: 2, paddingBottom: spacing.xxs },
  composerContextChip: { flexGrow: 0, flexShrink: 0, alignSelf: "flex-start", minHeight: 24, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, backgroundColor: colors.surfaceContainer },
  composerContextText: { flexGrow: 0, flexShrink: 0, color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "600" },
  composerContextCount: { flexGrow: 0, flexShrink: 0, alignSelf: "center", justifyContent: "center" },
  composerContextCountHidden: { opacity: 0 },
  composerContextRefreshOverlay: { position: "absolute", inset: 0, alignItems: "flex-start", justifyContent: "center" },
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
  composerAttachmentsContent: { alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
  composerAttachmentCard: { width: 224, minHeight: 58, flexDirection: "row", alignItems: "stretch", overflow: "hidden", borderRadius: 12, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  composerAttachmentOpen: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 9, padding: 4 },
  composerAttachmentThumbnail: { width: 48, height: 48, flexShrink: 0, overflow: "hidden", borderRadius: 9, backgroundColor: colors.surfaceContainerHigh, alignItems: "center", justifyContent: "center" },
  composerAttachmentFileIcon: { width: 42, height: 42, flexShrink: 0, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh, alignItems: "center", justifyContent: "center" },
  composerAttachmentText: { minWidth: 0, flex: 1, gap: 1 },
  composerAttachmentName: { color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  composerAttachmentKind: { color: colors.textMuted, fontSize: 10, lineHeight: 14, textTransform: "capitalize" },
  composerAttachmentRemove: { width: 32, flexShrink: 0, alignItems: "center", justifyContent: "center" },
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
  queueTextButton: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  queueTextButtonLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  queueSteerButton: { height: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 17, backgroundColor: colors.accent },
  queueSteerLabel: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },
  optimisticAttachments: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  menuNotice: { color: colors.textMuted, fontSize: 13, paddingVertical: 8 },
  menuScroll: { flex: 1, minHeight: 0 },
  menuScrollContent: { paddingBottom: spacing.sm },
  settingsVersion: { color: colors.textDim, fontSize: 11, lineHeight: 15, textAlign: "center", paddingTop: spacing.lg, paddingBottom: spacing.sm },
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
