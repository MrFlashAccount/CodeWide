import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { InlineEmoji, InlineIcon } from "./ui/InlineIcon";
import { ComposerEditorTrialEntry } from "./ui/ComposerEditorTrialEntry";
import { ComposerMarkdownInput } from "./ui/ComposerMarkdownInput";
import type { ComposerMarkdownInputHandle } from "./ui/ComposerMarkdownInput.types";
import type { ComposerMention } from "./ui/composer-mentions";
import {
  composerSkillSuggestions,
  composerSkillUrl,
  containsSkillInvocation,
  markdownForComposerSubmission,
} from "./ui/composer-skill-suggestions";
import { ConversationPanelUnderlay } from "./ui/ConversationPanelUnderlay";
import { ThreadErrorBanner } from "./ui/ThreadErrorBanner";
import { threadFailureNotice, type ThreadCurrentOutcome } from "./data/thread-current-outcome";
import { InlineQueueOverlay, type InlineQueueOverlayItem } from "./ui/InlineQueueOverlay";
import {
  conversationBottomContentInset,
  conversationChromeEdgeInset,
  conversationHeaderChromeHeight,
  conversationTopContentInset,
} from "./ui/conversation-chrome-layout";
import { searchFieldLayout } from "./presentation/input/searchLayout";
import { isComposeIconName } from "./presentation/icons/composeIconNames";
import { AppListRow } from "./ui/AppListRow";
import { AttachmentListRow } from "./ui/AttachmentListRow";
import { listRowStyles } from "./ui/AppListRow.styles";
import { listRowHeight, listRowPosition } from "./ui/AppListRow.types";
import { desktopThreadSidebarWidth } from "./presentation/layouts/windowLayout";
import { catalogSummaryModel } from "./data/catalog-summary-model";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { Accordion } from "heroui-native/accordion";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { FieldError } from "heroui-native/field-error";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import {
  LegendList,
  type LegendListRenderItemProps,
  useRecyclingState,
} from "@legendapp/list/react-native";
import { SkillsPicker } from "./ui/SkillsPicker";
import { useSelector } from "@legendapp/state/react";
import { parsePairingPayload } from "@codewide/codex-protocol/pairing";
import type {
  ReviewDelivery,
  ReviewTarget,
  Thread,
  ThreadGoal,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import { connectionId, normalizeThreadItem } from "@codewide/domain";
import { projectCompleteMarkdown, projectMarkdownStream } from "@codewide/rendering-core";
import { toRenderBlock, type RenderBlock, type RenderContentReference } from "@codewide/renderers";
import {
  MAX_TURN_ATTACHMENTS,
  MAX_TURN_TEXT_CHARS,
  projectedThreadExecutionSettings,
  projectedTurnMetadata,
  type OutputFootprintProjection,
  type TurnUsageProjection,
} from "@codewide/sync-client";
import { useLiveQuery } from "@tanstack/react-db";
import {
  Gesture,
  GestureDetector,
  Pressable as GesturePressable,
} from "react-native-gesture-handler";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import {
  KeyboardController,
  KeyboardGestureArea,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import {
  createContext,
  Fragment,
  memo,
  startTransition,
  Suspense,
  type ReactNode,
  useContext,
  useDeferredValue,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  findNodeHandle,
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

import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  iconSize,
  typeWeight,
  controlSize,
  controlHitSlop,
  typeTracking,
  layoutSize,
} from "./theme";
import { threadListLayout } from "./ui/thread-list-layout";
import { setNativeVoiceAuraOrigin } from "./native/native-transport";
import {
  useRemoteWorkspace,
  type BackgroundTerminal,
  type ComposerAttachment,
  type QueuedPrompt,
  type RemoteWorkspace,
  type SendMode,
  type ThreadChangeDiffValue,
  type ThreadGoalInput,
  type ThreadSettings,
  type TunnelPreview,
  type TurnControls,
  type TurnSendOptions,
  type VoiceTranscriptionEvent,
  type VoiceTranscriptionOptions,
  type VoiceTranscriptionSession,
} from "./data/use-remote-workspace";
import type { ThreadForkOptions } from "./data/thread-fork";
import { type ThreadHistoryState } from "./data/thread-pagination";
import {
  COMPLETE_STATIC_THREAD_HISTORY,
  useThreadHistoryController,
  type ThreadHistoryViewport,
} from "./data/use-thread-history-controller";
import { useThreadHistoryActivity, useThreadHistoryCursor } from "./data/use-thread-history";
import { recordThreadHistoryTelemetry } from "./data/thread-history-telemetry";
import type { ThreadHistoryModel } from "./data/thread-history-model";
import { isPersistableHistoryAnchor } from "./data/thread-history-anchor";
import { useThreadChatWindow } from "./data/use-thread-chat-window";
import { useThreadUiState } from "./data/use-thread-ui-state";
import { composerUploads } from "./data/composer-uploads";
import { randomUUID } from "expo-crypto";
import { ComposerAttachmentTray } from "./rendering/ComposerAttachmentTray";
import { AttachmentCard } from "./rendering/AttachmentCard";
import { MessageAttachmentCard } from "./rendering/MessageAttachmentCard";
import { MessageAttachmentGrid } from "./rendering/MessageAttachmentTile";
import { MessageFooterRow, MessageFooterStatus } from "./rendering/MessageFooterRow";
import { TurnChangesFooter } from "./rendering/TurnChangesFooter";
import { TurnChangesContext, type TurnChangesTarget } from "./rendering/TurnChangesContext";
import { turnItemChanges, type TurnChangedFile } from "./rendering/turn-changes";
import { GlobalSearchScreen, type LocatedSearchHit } from "./search/GlobalSearchScreen";
import { SearchSession } from "./search/search-session";
import { SearchConversationWindow } from "./search/search-conversation-window";
import { useSearchConversationWindowLifecycle } from "./search/use-search-conversation-window";
import {
  SearchMessage,
  SearchMessageFocus,
  SearchHighlightQuery,
} from "./search/SearchMessageFocus";
import { BrowserFeedbackContext } from "./browser/BrowserFeedbackContext";
import { sendBrowserFeedback } from "./browser/send-feedback";
import type { BrowserFeedbackCapability, BrowserFeedbackSubmission } from "./browser/feedback";
import { StreamingRevealSurface } from "./rendering/StreamingRevealSurface";
import { TimelineMotionContext } from "./rendering/FluidLayoutFrame";
import { NativeRevealSurface } from "./rendering/NativeRevealSurface";
import { projectAgentArtifacts } from "./rendering/agent-artifacts";
import {
  ArtifactImageReferences,
  artifactImageReferences,
} from "./rendering/ArtifactImageReferences";
import { fileMediaKind } from "@codewide/file-types";
import { useThreadResources } from "./data/use-thread-resources";
import type { ThreadResourcesModel } from "./data/thread-resources-model";
import { useRemoteProjectCatalog } from "./data/use-remote-project-catalog";
import { useDeepLinkListener } from "./data/use-deep-link-listener";
import { useSecondClock } from "./data/second-clock";
import type { ThreadChatModel, ThreadChatWindowRequest } from "./data/thread-chat-model";
import {
  projectThreadChatWindow,
  type ProjectedThreadChatDelivery,
  type ProjectedThreadChatTimelineEntry,
} from "./data/thread-chat-projection";
import { threadLoadBlocksPresentation } from "./data/thread-load-status";
import { mergeProjectedThreadPartitions } from "./data/thread-partitions";
import { plainThreadPreview } from "./data/thread-cache";
import type { ThreadDetailDatabase } from "./data/thread-detail-database";
import type { ThreadSummaryDatabase } from "./data/thread-summary-database";
import { useThreadSummaryView } from "./data/use-thread-summary-view";
import { sidebarProjects, type SidebarProject } from "./data/sidebar-projects";
import { sidebarRows, type SidebarRow } from "./data/sidebar-rows";
import {
  SidebarProjectHeader,
  SidebarProjectRow,
  SidebarProjectsSheet,
} from "./ui/SidebarProjects";
import {
  SidebarListFeedback,
  sidebarListState,
  type SidebarListState,
} from "./ui/SidebarListFeedback";
import { useSidebarProjectOrder } from "./data/use-sidebar-project-order";
import { orderSidebarProjects } from "./data/sidebar-project-order";
import {
  subagentActivityTargetThreadId,
  subagentDisplayName,
  subagentsForThread,
} from "./data/subagent-projection";
import { projectLabel, threadContextLabel } from "./data/thread-projects";
import type { RemoteDirectoryEntry, RemoteProject } from "./data/remote-projects";
import type { DraftSelection } from "./data/voice-draft";
import {
  isProfileOnlyConnectionUpdate,
  validateConnectionProfile,
  validateConnectionUpdateInput,
  type ConnectionInput,
  type ConnectionUpdateInput,
} from "./data/connection-validation";
import {
  resolveComposerSendMode,
  type ComposerSendPreference,
} from "./data/composer-delivery-mode";
import { composerModelSettings } from "./data/composer-model-settings";
import { useComposerLatestValues } from "./data/use-composer-latest-values";
import {
  mergeFailedComposerAttachments,
  mergeFailedComposerText,
  rollbackOwnedModelSelection,
} from "./data/composer-mutation-recovery";
import { validateGoalEditorDraft } from "./data/goal-editor";
import {
  contextUsageFromProjection,
  selectWeeklyRateLimit,
  type AccountRateLimitsRow,
} from "./data/account-rate-limits";
import { accountProfileLabel, type AccountPoolSnapshot } from "./data/account-pool";
import { formatDeviceTime } from "./data/device-time";
import {
  isSafeHttpUrl,
  mcpElicitationFields,
  parseElicitationValue,
} from "./data/elicitation-form";
import { parseThreadDeepLink } from "./data/deep-link";
import {
  AUTO_ATTACH_PASTE_MIN_CHARS,
  captureClipboardLargePaste,
  type ClipboardLargePasteCapture,
} from "./data/composer-paste-attachment";
import type { LargePasteEvent } from "./native/large-paste";
import { useEvent } from "./react/useEvent";
import { useAppLockSettings } from "./ui/AppLockGate";
import {
  incrementDiagnosticMetric,
  liveStreamMetricKey,
  operationalDiagnosticsEnabled,
  recordLiveRenderCommit,
  recordTiming,
} from "./data/operational-metrics";
import {
  activeThreadNavigationIdFor,
  beginThreadNavigation,
  finalizeThreadNavigationProfile,
  isThreadNavigationActiveFor,
  markThreadNavigationStage,
  measureThreadNavigationWork,
  recordThreadNavigationRowCommit,
  recordThreadNavigationVisualEvent,
} from "./data/thread-navigation-metrics";
import {
  usePerformanceExperiment,
} from "./data/performance-experiments";
import { beginNavigationFrameTrace, endNavigationFrameTrace } from "./native/performance-metrics";
import { humanPairingError } from "./data/pairing-error";
import { resolveNewThreadRoute } from "./data/new-thread-routing";
import { UiGenerationControl } from "./boot/UiGenerationControl";
import { subscribeUiGeneration, uiGenerationSnapshot } from "./boot/uiGenerationResource";
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
import { isThreadLifecycleActive, pendingDeliveryMayOwnTurn } from "./data/thread-lifecycle";
import type { StoredConnection } from "./data/connection-profile-types";
import { connectionDiagnosticReport } from "./data/connection-diagnostic-report";
import type { PendingServerRequest } from "./data/pending-request-types";
import type { StoredThreadSummary } from "./data/thread-summary-types";
import {
  normalizePendingDeliveryState,
  type VisiblePendingDeliveryState,
} from "./data/thread-delivery-state";
import { ThreadListProjection } from "./data/thread-list-projection";
import {
  createThreadNavigationModel,
  type ConversationDestination as ConversationNavigationDestination,
  type ThreadNavigationModel,
} from "./data/thread-navigation-model";
import { SubagentListProjection } from "./data/subagent-projection";
import type { StoredComposerPreferences, ThreadUiStateRow } from "./data/thread-ui-state-types";
import {
  threadHistoryResourceKey,
  threadResourceKey,
  tunnelResourceKey,
  turnControlsResourceKey,
  type BackgroundTerminalsRow,
  type ThreadAttachmentResource,
  type ThreadChangeResource,
  type ThreadChangeScope,
  type ThreadGoalRow,
  type ThreadResourcesRow,
  type ThreadResourcesValue,
  type TunnelRow,
  type TurnControlsRow,
  type VoiceInputRow,
  type WorkspaceResourceDatabase,
} from "./data/workspace-resource-database";
import {
  useBackgroundTerminalsRow,
  useThreadGoalRow,
  useTunnelRow,
  useTurnControlsRow,
} from "./data/use-workspace-resource-row";
import type { VoiceInputController } from "./data/voice-input-controller";
import type { FileTransferController } from "./data/file-transfer-controller";
import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "./data/attachment-upload";
import {
  imageAnnotationAttachment,
  isQuickdrawDraftAttachment,
  quickdrawAttachmentName,
  quickdrawPngBytes,
  remoteAttachment,
} from "./data/quickdraw-attachment";
import { annotatedImageName } from "./data/quickdraw-image";
import { loadQuickdrawImageSnapshot } from "./data/quickdraw-image-source";
import { windowLayoutStore } from "./native/window-layout-store";
import {
  createBinaryUpload,
  createTextUpload,
  pickUploadFile,
  selectedUploadUri,
  selectedUploadText,
  startUpload,
  type SelectedUpload,
} from "./native/file-transfer";
import { RichMarkdown } from "./rendering/RichMarkdown";
import { RichContentWidthProvider } from "./rendering/RichContentLayout";
import {
  ImagePreviewGroup,
  useImagePreview,
  useImagePreviewAnnotationHandler,
  useImagePreviewGroup,
  useRegisterImagePreviewItem,
  type ImagePreviewItem,
} from "./rendering/ImagePreviewHost";
import {
  HtmlDocumentPreview,
  loadDocumentPreview,
  MAX_DOCUMENT_PREVIEW_BYTES,
  useDocumentDownload,
  useDocumentPreview,
  type DocumentPreviewRequest,
  type DocumentPreviewResult,
} from "./rendering/DocumentPreviewHost";
import {
  remoteDocumentDirectory,
  remoteFileKind,
  resolvePreviewableDocumentLink,
  resolveRemoteDocumentPath,
  type DocumentPreviewKind,
} from "./rendering/document-preview";
import { MarkdownLocalLinkProvider } from "./rendering/MarkdownLinkHandler";
import {
  forwardedLoopbackUrl,
  parseLoopbackLink,
  type LoopbackLinkTarget,
} from "./rendering/loopback-link";
import { NativeCodeBlock } from "./rendering/NativeCodeBlock";
import { CodeReviewWorkspace } from "./rendering/CodeReviewWorkspace";
import { ThreadCodeDocumentContext } from "./rendering/ThreadCodeDocumentContext";
import { isAttachmentVideo, useAttachmentVideoPreview } from "./rendering/AttachmentVideoPreview";
import { changeScopeMenuActions, changeScopeTitle } from "./rendering/change-menu";
import { codeReviewFilesForDocument } from "./rendering/code-review-files";
import { serializeCodeReviewAttachment, type CodeReviewComment } from "./rendering/code-review";
import {
  ContentReviewComments,
  ContentReviewComposer,
  useContentReview,
  useContentReviewRuntime,
} from "./rendering/ContentReviewHost";
import type { ContentReviewTarget } from "./rendering/content-review";
import {
  collapsedCodePreview,
  nativeCodeLanguageForPath,
  stripTerminalControlSequences,
} from "./rendering/native-code-block";
import { boundedJsonStringify } from "./rendering/bounded-json";
import { useAsyncResource, useEphemeralAsyncResource } from "./rendering/async-resource-store";
import { commandOutputReferences } from "@codewide/sync-client";
import {
  COMMAND_OUTPUT_PAGE_BYTES,
  commandOutputRevision,
  readCommandOutput,
  type CommandOutputPage,
} from "./rendering/command-output-resource";
import { changedFileDisplayPath } from "./rendering/changed-file-path";
import { projectFileChange } from "./rendering/file-change-rendering";
import { privateImageAssetProjection, safeImageUri } from "./rendering/image-source";
import {
  privateAssetCacheKey,
  readPrivateAssetText,
  type GetTransferAccess,
  type PrivateAssetSource,
  type PrivateAssetTextResult,
} from "./data/private-transfer";
import {
  projectCachedLiveMarkdown,
  projectCachedLiveText,
  type LiveMarkdownProjection,
} from "./rendering/live-text-stream";
import { reasoningActivityTitle } from "./rendering/reasoning-title";
import { richMarkdownLayout } from "./rendering/rich-markdown-layout";
import { selectLiveTurnPlan } from "./rendering/live-turn-plan";
import {
  isAgentMessageStillStreaming,
  selectTurnRenderWindow,
} from "./rendering/thread-render-window";
import {
  ThreadTimelineList,
  type ThreadTimelineListRef,
  type TimelineInitialPosition,
} from "./rendering/ThreadTimelineList";
import {
  MessageListBoundary,
  MessageListSkeleton,
  type MessageListState,
} from "./ui/MessageListBoundary";
import { TimelineDateSeparator } from "./rendering/TimelineDateSeparator";
import {
  TimelineDateSequence,
  type TimelineTurnDateLabels,
} from "./presentation/conversation/timelineDates";
import { protocolTimestampMs } from "./data/thread-chat-timeline";
import { optimisticTimelineKey, remoteTurnTimelineKey } from "./rendering/timeline-identity";
import {
  activeTurnSequence,
  chronologicalTurnSequence,
  type TurnSequencePart,
} from "./rendering/turn-sequence";
import { Bubble, BubbleContent, useInsideBubbleSurface } from "./rendering/Bubble";
import { claimUnreadReceipt, shouldMarkAgentResponseRead } from "./rendering/unread-visibility";
import { normalizeUserMessage } from "./rendering/user-message-normalizer";
import {
  projectUserMessageAttachments,
  type UserMessageAttachment,
} from "./rendering/user-message-attachments";
import {
  activityOutputFootprint,
  commandActivityInput,
  commandActivityTitle,
  commandOutputFootprint,
  estimatedOutputInputCostUsd,
} from "./rendering/command-activity";
import {
  PrivateAssetRecoveryProvider,
  PrivateImageAccessProvider,
  usePrivateAssetUri,
  usePrivateFileAccessScope,
  usePrivateImageUri,
} from "./rendering/use-private-image-uri";
import { useReducedMotionPreference } from "./rendering/reduced-motion-store";
import { AppSheet, AppSheetScrollView } from "./ui/AppSheet";
import {
  AppFullscreenOverlayBoundary,
  useAppFullscreenOverlay,
  type AppFullscreenOverlayLifecycle,
} from "./ui/AppFullscreenOverlay";
import { createFullscreenScrollOwnership } from "./ui/fullscreen-scroll-ownership";
import { ActionMenu, type ActionMenuItem } from "./ui/ActionMenu";
import { MessageActionMenuProvider, useMessageActionMenu } from "./ui/MessageActionMenu";
import type { MessageActionMenuRequest } from "./ui/MessageActionMenu.types";
import { useAppDialog } from "./ui/AppDialog";
import { useMicrophoneAccess } from "./ui/use-microphone-access";
import { ModelThinkingMenu, PermissionsMenu } from "./ui/TurnControlMenus";
import { AppText as Text, AppTextInput as TextInput } from "./ui/Typography";
import {
  AppVoiceInputProvider,
  useAppVoiceInputRuntime,
  useVoiceInputLevel,
  useVoiceInputResource,
  useScopedVoiceInputResource,
  type AppVoiceInputRuntime,
} from "./ui/VoiceInputRuntime";
import { WorkspaceVoiceAura } from "./ui/WorkspaceVoiceAura";
import { WorkspaceConversationHost, WorkspaceThreadListVisibility } from "./ui/WorkspaceConversationHost";
import { WaveText } from "./ui/WaveText";
import { ThreadRenameDialog } from "./ui/ThreadRenameDialog";
import { SwipeDiscardAction } from "./ui/SwipeDiscardAction";
import { ComposerDeliveryMenu } from "./ui/ComposerDeliveryMenu";
import { ContextRing } from "./ui/UsagePopover";
import { WorkspaceAccountUsagePopover } from "./ui/WorkspaceAccountUsagePopover";
import type { AccountRateLimitsDatabase } from "./data/account-rate-limits-database";
import type { AccountUsageServer } from "./data/thread-list-account-usage";
import { CostBreakdownPopover } from "./ui/CostBreakdownPopover";
import { SettingsVersion } from "./ui/SettingsVersion";
import { SettingsSection, SettingsSheet } from "./ui/SettingsSheet";
import { LiveTurnPlanPopover } from "./ui/LiveTurnPlanPopover";
import { ThreadGoalChip } from "./ui/ThreadGoalChip";
import { TOKEN_SYMBOL } from "./ui/token-display";
import { formatEstimatedTurnCost } from "./turn-cost";
import { AnimatedNumber, compactNumberFormat, integerNumberFormat } from "./ui/AnimatedNumber";
import { formatNumber } from "./ui/number-format";
import { PerformanceDiagnostics } from "./ui/PerformanceDiagnostics";
import { DrawingWorkspace, type DrawingCommit } from "./ui/DrawingWorkspace";
import { RecoverableRenderBoundary, RenderRecoveryProvider } from "./ui/RecoverableRenderBoundary";
import { renderRecoveryPrompt, type RecoverableRenderFailure } from "./ui/render-recovery-prompt";
import { SubagentSheet } from "./ui/SubagentSheet";
import { PortForwardingManager, type PortForwardingManagerProps } from "./ui/PortForwardingManager";
import { ProjectPickerSheet } from "./ui/ProjectPickerSheet";
import { TerminalWorkspace } from "./ui/TerminalWorkspace";
import { InternalBrowser } from "./ui/InternalBrowser";
import { useAndroidBackHandler } from "./ui/use-android-back-handler";
import {
  useConversationCleanup,
  useConversationRef,
  useConversationState,
} from "./ui/use-conversation-scope";
import { useUnmount } from "./ui/use-unmount";
import { CommitOnChangeProbe, EveryCommitProbe } from "./ui/CommitProbe";
import { useConversationOwner } from "./ui/use-conversation-owner";

const ALL_SERVERS_ID = "__all_servers__";
const THREAD_LIST_PAGE_SIZE = 36;
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

const COLLAPSED_BODY_CHARS = 360;
const EXPANDED_BODY_CHARS = 96_000;
const TOOL_RESULT_MAX_HEIGHT = 400;
const TURN_FOOTER_MIN_HEIGHT = 20;
const USER_MESSAGE_COLLAPSED_LINES = 25;
const USER_MESSAGE_COLLAPSED_CHARS = 1_800;
const COMPOSER_MIN_HEIGHT = touchTarget;
// Optical spacing: more room towards the input; do not stack strip and row padding.
const COMPOSER_CHIP_TOP_INSET = spacing.xxs;
const COMPOSER_CHIP_BOTTOM_INSET = spacing.xxs;
const COMPOSER_MAX_HEIGHT = 132;

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
const sessionConversationHistoryAnchors = new Map<
  string,
  { turnId: string; viewportOffsetPx: number | null }
>();
const ForceExpandCardsContext = createContext(false);
const ActiveToolCallContext = createContext(false);
const TurnActivityContentContext = createContext(false);
const TurnUsageContext = createContext<TurnUsageProjection | null>(null);
const ExpansionItemKeyContext = createContext("item");
const ThreadCwdContext = createContext("/workspace");
const SubagentNavigationContext = createContext<((threadId: string) => void) | null>(null);
type LargeContentViewerRequest = {
  pointer: string;
  reference: RenderContentReference;
  presentation: "markdown" | "terminal" | "text";
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
};
const LargeContentViewerContext = createContext<
  ((request: LargeContentViewerRequest) => void) | null
>(null);
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

function writePersistentExpansionState(key: string, expanded: boolean): void {
  persistentExpansionStates.delete(key);
  persistentExpansionStates.set(key, expanded);
  while (persistentExpansionStates.size > PERSISTENT_EXPANSION_STATE_LIMIT) {
    const oldest = persistentExpansionStates.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    persistentExpansionStates.delete(oldest);
  }
}

type ComposerMenuPage =
  | "model"
  | "skills"
  | "permissions"
  | "queue"
  | "goal"
  | "review"
  | "runtime"
  | "ports";
type QueuedComposerEdit = {
  readonly commandId: string;
  readonly text: string;
  readonly attachments: ComposerAttachment[];
};
type ComposerAccessoryAction = "files" | "drawing" | "skills" | "goal" | "terminal" | "ports";
type ChangesDisplayMode = "unified" | "split" | "source";
type ChangesPreferences = {
  scope: ThreadChangeScope | null;
  mode: ChangesDisplayMode;
  wrapLines: boolean;
};

const changesPreferencesByThread = new Map<string, ChangesPreferences>();

function readChangesPreferences(key: string): ChangesPreferences {
  return changesPreferencesByThread.get(key) ?? { scope: null, mode: "unified", wrapLines: false };
}

function executionPermissionsLabel(
  settings: ReturnType<typeof projectedThreadExecutionSettings>,
  pending = true,
): string {
  if (settings?.permissions !== null && settings?.permissions !== undefined)
    return permissionProfileLabel(settings.permissions);
  const sandbox =
    settings?.sandboxPolicy === "dangerFullAccess"
      ? "Full access"
      : settings?.sandboxPolicy === "workspaceWrite"
        ? "Workspace"
        : settings?.sandboxPolicy === "readOnly"
          ? "Read only"
          : settings?.sandboxPolicy === "externalSandbox"
            ? "External sandbox"
            : null;
  const approval =
    settings?.approvalPolicy === "on-request"
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
  return loading ? (
    <WaveText
      {...(testID === undefined ? {} : { testID })}
      text={text}
      style={styles.composerContextText}
      containerStyle={styles.composerContextWave}
    />
  ) : (
    <Text testID={testID} numberOfLines={1} style={styles.composerContextText}>
      {text}
    </Text>
  );
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
        containerStyle={[
          styles.composerContextValue,
          refreshing && styles.composerContextCountHidden,
        ]}
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
  load(
    scope?: ThreadChangeScope,
    kind?: "all" | "changes" | "attachments",
  ): Promise<ThreadResourcesValue>;
  preferences: ChangesPreferences;
  onPreferencesChange(preferences: ChangesPreferences): void;
  onOpen(kind: "changes" | "attachments"): void;
}) {
  const dialog = useAppDialog();
  const resource = useThreadResources(model, resourceId, () => load(), { revision });
  const pending = (kind: "changes" | "attachments") =>
    resource === null ||
    (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes(kind));
  const ready = (kind: "changes" | "attachments") =>
    resource?.readyKinds === undefined
      ? resource?.value != null
      : resource.readyKinds.includes(kind);
  const changesPending = pending("changes");
  const attachmentsPending = pending("attachments");
  const changesReady = ready("changes");
  const attachmentsReady = ready("attachments");
  const changesInitialLoading = changesPending && !changesReady;
  const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;
  const changesError =
    resource?.resourceErrors?.changes ??
    (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const attachmentsError =
    resource?.resourceErrors?.attachments ??
    (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const changesUnavailable = changesError !== null && !changesReady;
  const attachmentsUnavailable = attachmentsError !== null && !attachmentsReady;
  const changeCount = resource?.value?.changes.length ?? 0;
  const attachmentCount = resource?.value?.attachments.length ?? 0;
  const changeScopes = resource?.value?.changeScopes ?? ["session" as const, "lastTurn" as const];
  const changeScope =
    preferences.scope !== null && changeScopes.includes(preferences.scope)
      ? preferences.scope
      : (resource?.value?.changeScope ?? changeScopes[0] ?? "session");
  const changesEmpty = changesReady && changeCount === 0;
  const attachmentsEmpty = attachmentsReady && attachmentCount === 0;
  const changesLabel = changesInitialLoading
    ? "Loading changes…"
    : changesUnavailable
      ? "Changes unavailable"
      : changesEmpty
        ? "No changes"
        : `Changes · ${changeCount}`;
  const attachmentsLabel = attachmentsInitialLoading
    ? "Loading attachments…"
    : attachmentsUnavailable
      ? "Attachments unavailable"
      : attachmentsEmpty
        ? "No attachments"
        : `Attachments · ${attachmentCount}`;
  const selectScope = (id: string) => {
    if (!id.startsWith("scope:")) return;
    const scope = id.slice("scope:".length) as ThreadChangeScope;
    if (!changeScopes.includes(scope)) return;
    onPreferencesChange({ ...preferences, scope });
    void load(scope, "changes").catch((cause) => {
      dialog.alert(
        "Changes unavailable",
        cause instanceof Error ? cause.message : "Could not load changes",
      );
    });
  };
  return (
    <>
      {!changesUnavailable && (
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
            <InlineIcon
              name="git-compare-outline"
              role="label"
              color={changesEmpty ? colors.textDim : colors.textMuted}
            />
            {changesInitialLoading || changesEmpty ? (
              <ComposerContextLabel
                loading={changesInitialLoading}
                testID="composer-changes-label"
                text={changesLabel}
              />
            ) : (
              <ComposerContextCount
                label="Changes"
                value={changeCount}
                testID="composer-changes-label"
              />
            )}
          </Pressable>
        </ActionMenu>
      )}
      {!attachmentsUnavailable && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={attachmentsLabel}
          accessibilityState={{ disabled: attachmentsEmpty }}
          disabled={attachmentsEmpty}
          onPress={() => onOpen("attachments")}
          style={[styles.composerContextChip, attachmentsEmpty && styles.disabled]}
        >
          <InlineIcon
            name="attach-outline"
            role="label"
            color={attachmentsEmpty ? colors.textDim : colors.textMuted}
          />
          {attachmentsInitialLoading || attachmentsEmpty ? (
            <ComposerContextLabel
              loading={attachmentsInitialLoading}
              testID="composer-attachments-label"
              text={attachmentsLabel}
            />
          ) : (
            <ComposerContextCount
              label="Attachments"
              value={attachmentCount}
              testID="composer-attachments-label"
            />
          )}
        </Pressable>
      )}
    </>
  );
}

function pairingParseResult(
  raw: string,
):
  | { value: ReturnType<typeof parsePairingPayload>; parsedAt: number; error: null }
  | { value: null; parsedAt: number; error: string } {
  const parsedAt = Date.now();
  try {
    return { value: parsePairingPayload(raw, parsedAt), parsedAt, error: null };
  } catch (cause) {
    return { value: null, parsedAt, error: humanPairingError(cause) };
  }
}

function useWindowLayout() {
  return useSyncExternalStore(
    windowLayoutStore.subscribe,
    windowLayoutStore.getSnapshot,
    windowLayoutStore.getSnapshot,
  );
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
  | {
      kind: "optimistic";
      scope: string;
      id: string;
      text: string;
      attachments: ComposerAttachment[];
      status: VisiblePendingDeliveryState;
      workspaceRequestId?: string | null;
      lastError: string | null;
      createdAt: number;
    }
  | {
      kind: "meta";
      key: string;
      status: "completed" | "interrupted" | "failed" | "inProgress";
      durationMs: number | null;
      completedAt: number | null;
    };

function ThreadTimelineNavigationCommit({
  connectionId,
  threadId,
  modelReady,
  visible,
  itemCount,
  turnCount,
  loadStatus,
  restoreAnchorTurnId,
  children,
}: {
  connectionId: string | null;
  threadId: string | null;
  modelReady: boolean;
  visible: boolean;
  itemCount: number;
  turnCount: number;
  loadStatus: ThreadHistoryState["status"];
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
      markThreadNavigationStage(
        connectionId,
        threadId,
        "scope_commit",
        {
          tags: { position: restoreAnchorTurnId === null ? "end" : "anchor" },
        },
        navigationId,
      );
    }
    if (modelReady && !modelReportedRef.current) {
      modelReportedRef.current = true;
      markThreadNavigationStage(
        connectionId,
        threadId,
        "timeline_model_ready",
        {
          values: { itemCount, turnCount },
          tags: { loadStatus },
        },
        navigationId,
      );
    }
    if (visible && !visibleReportedRef.current) {
      visibleReportedRef.current = true;
      markThreadNavigationStage(
        connectionId,
        threadId,
        "visible_commit",
        {
          values: { itemCount },
          tags: { timeline: itemCount === 0 ? "empty" : "populated" },
        },
        navigationId,
      );
    }
    if (!visible || nextFrameReportedRef.current || nextFrameRef.current !== null) return;
    nextFrameRef.current = requestAnimationFrame(() => {
      nextFrameRef.current = null;
      const completed = markThreadNavigationStage(
        connectionId,
        threadId,
        "next_frame",
        {
          values: { itemCount },
        },
        navigationId,
      );
      if (completed !== null) {
        nextFrameReportedRef.current = true;
        void endNavigationFrameTrace(completed.id).then((frames) =>
          finalizeThreadNavigationProfile(completed, frames),
        );
      }
    });
    return () => {
      if (nextFrameRef.current !== null) cancelAnimationFrame(nextFrameRef.current);
      nextFrameRef.current = null;
    };
  };
  return (
    <>
      {children}
      <EveryCommitProbe onCommit={onCommit} />
    </>
  );
}

type ConversationPaneProps = Parameters<typeof ConversationPane>[0];

type ConversationDestinationBaseProps = Omit<
  ConversationPaneProps,
  | "remoteThread"
  | "remoteSealedTurns"
  | "remoteLiveTurns"
  | "timelineEntries"
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
};

/**
 * Local composer state is restored before editing. Transcript loading is
 * progressive and must not suspend the header, menus, or composer.
 */
function MainConversationDetail({
  remote,
  connectionId,
  threadId,
  threadOpenGeneration,
  navigationKey,
  ...conversation
}: MainConversationDetailProps) {
  const uiStateDatabase = remote.threadUiStateDatabase;
  const chatDatabase = remote.threadDetails;
  if (uiStateDatabase === null || chatDatabase === null) {
    throw new Error("Native conversation databases are unavailable");
  }

  const summaryView = useThreadSummaryView(
    remote.threadSummaryDatabase,
    {
      // Metadata and history load independently; route/catalog metadata already
      // provides the header and actions while this summary is being restored.
      viewId: `conversation:${connectionId}:${threadId}`,
      connectionId: null,
      recentLimit: 0,
      archivedLimit: 0,
      selectedConnectionId: connectionId,
      selectedThreadId: threadId,
      subagentConnectionId: null,
      subagentLimit: 0,
    },
    false,
  );
  const storedThread = summaryView?.selected[0] ?? null;
  const composerState = useThreadUiState(uiStateDatabase, connectionId, threadId);
  const searchWindow =
    conversation.searchWindow?.target.connectionId === connectionId &&
    conversation.searchWindow.target.hit.threadId === threadId
      ? conversation.searchWindow
      : null;
  useSearchConversationWindowLifecycle(searchWindow);
  const isSelectedSearchWindow = useEvent(
    (selected: SearchConversationWindow) => searchWindow === selected,
  );
  // The selected window owns its cached promise. A chat-keyed resource would
  // reuse the first result when another message in that same chat is selected.
  void searchWindow?.read();
  const searchState = useSelector(() => searchWindow?.state$.get() ?? null);
  const [initialHistoryAnchorTurnId, setHistoryAnchorTurnId] = useConversationState(
    `${connectionId}\u0000${threadId}`,
    () => composerState.historyAnchorTurnId ?? null,
  );
  const historyResourceId = threadHistoryResourceKey(connectionId, threadId);
  const historyModel = remote.resourceDatabase?.threadHistories ?? null;
  const historyResourceRaw = useThreadHistoryCursor(historyModel, historyResourceId);
  const chatWindowRequest: ThreadChatWindowRequest = {
    connectionId,
    threadId,
    anchorTurnId: searchWindow === null ? initialHistoryAnchorTurnId : null,
    openGeneration: threadOpenGeneration,
  };
  const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false);
  if (chatWindow === null) throw new Error("Conversation window is unavailable");

  const chatSnapshot = chatWindow.snapshot;
  const latestResidentOrdinal = chatWindow.turnRows.reduce<number | null>(
    (maximum, row) =>
      row.kind !== "turn" || !row.sealed
        ? maximum
        : maximum === null
          ? row.ordinal
          : Math.max(maximum, row.ordinal),
    null,
  );
  const isLatestRange =
    chatSnapshot.latestSealedOrdinal === null ||
    (latestResidentOrdinal !== null && latestResidentOrdinal >= chatSnapshot.latestSealedOrdinal);
  const earliestResidentOrdinal = chatWindow.turnRows.reduce<number | null>(
    (minimum, row) =>
      row.kind !== "turn" || !row.sealed
        ? minimum
        : minimum === null
          ? row.ordinal
          : Math.min(minimum, row.ordinal),
    null,
  );
  const isEarliestRange =
    chatSnapshot.earliestSealedOrdinal === null ||
    (earliestResidentOrdinal !== null &&
      earliestResidentOrdinal <= chatSnapshot.earliestSealedOrdinal);
  const historyEpoch = chatSnapshot.historyEpoch;
  const historyResource =
    historyResourceRaw?.historyEpoch === historyEpoch
      ? (historyModel?.get(historyResourceId) ?? null)
      : null;
  const putHistoryState = (state: ThreadHistoryState): void => {
    remote.resourceDatabase?.putThreadHistory({
      id: historyResourceId,
      connectionId,
      threadId,
      generation: threadOpenGeneration,
      ...state,
    });
  };
  const projection = projectThreadChatWindow(
    chatDatabase,
    chatWindow,
    connectionId,
    threadId,
    false,
    storedThread,
  );
  const remoteThread = projection.remoteThread ?? storedThread?.provisionalThread ?? null;
  const conversationCwd =
    remoteThread?.cwd ?? storedThread?.cwd ?? conversation.cwd ?? "/workspace";
  const historyRestoreReady = !threadLoadBlocksPresentation(chatSnapshot.status);
  const messageListState: MessageListState =
    chatSnapshot.status === "initial-error"
      ? {
          status: "error",
          message: chatSnapshot.error ?? "Could not load messages",
          retry: async () => await chatDatabase.loadWindow(chatWindowRequest),
        }
      : historyRestoreReady
        ? { status: "ready" }
        : { status: "loading" };
  const historyState: ThreadHistoryState = historyResource ?? {
    historyEpoch,
    status: remoteThread === null ? "initial-loading" : "ready",
    nextCursor: chatDatabase.historyCursor(connectionId, threadId),
    error: null,
  };
  const readHistoryState = (): ThreadHistoryState | null => {
    const row = historyModel?.get(historyResourceId) ?? null;
    return row?.historyEpoch === historyEpoch ? row : historyState;
  };
  const historyViewport = useThreadHistoryController({
    enabled: true,
    connectionId,
    threadId,
    historyEpoch,
    cursorState: historyState,
    readState: readHistoryState,
    readHistoryCursor: () => chatDatabase.historyCursor(connectionId, threadId),
    readRangeRevision: () =>
      chatDatabase.chat.window$(connectionId, threadId).peek().layoutRevision,
    isLatestRange,
    isEarliestRange,
    putState: putHistoryState,
    pullRange: async (direction) => await chatDatabase.pullRange(connectionId, threadId, direction),
    trimRange: async (direction) => await chatDatabase.trimRange(connectionId, threadId, direction),
  });

  return (
    <>
      <CommitOnChangeProbe
        scope={`main-conversation:${navigationKey}`}
        revision={navigationKey}
        onCommit={() => {
          const navigationId = recordThreadNavigationVisualEvent(
            connectionId,
            threadId,
            "conversation_destination_visible",
          );
          return navigationId === null
            ? undefined
            : () =>
                recordThreadNavigationVisualEvent(
                  connectionId,
                  threadId,
                  "conversation_destination_hidden_or_unmounted",
                  {},
                  navigationId,
                );
        }}
      />
      <CommitOnChangeProbe
        scope={`main-window:${navigationKey}`}
        revision={`${chatSnapshot.requestKey ?? "none"}:${chatSnapshot.status}:${chatSnapshot.layoutRevision}:${chatSnapshot.revision}:${chatWindow.turnRows.length}:${chatWindow.detailRows.length}:${chatWindow.liveRows.length}`}
        onCommit={() => {
          recordThreadNavigationVisualEvent(connectionId, threadId, "chat_window_committed", {
            values: {
              historyEpoch: chatSnapshot.historyEpoch,
              residentTurnLimit: chatSnapshot.residentTurnLimit,
              layoutRevision: chatSnapshot.layoutRevision,
              contentRevision: chatSnapshot.revision,
              turnRows: chatWindow.turnRows.length,
              detailRows: chatWindow.detailRows.length,
              liveRows: chatWindow.liveRows.length,
            },
            tags: {
              status: chatSnapshot.status,
              request: chatWindowRequest.anchorTurnId === null ? "tail" : "anchor",
              history: historyResourceRaw === null ? "missing" : "resident",
            },
          });
        }}
      />
      <CommitOnChangeProbe
        scope={`main-presentation:${navigationKey}`}
        revision={navigationKey}
        onCommit={() => chatDatabase.chat.finishPresentation(connectionId, threadId)}
      />
      <ConversationPane
        {...conversation}
        searchWindow={searchWindow}
        liveTextRecovery={chatSnapshot.backendRefreshing}
        cwd={conversationCwd}
        remoteThread={remoteThread}
        currentUsage={projection.currentUsage}
        currentOutcome={projection.currentOutcome}
        remoteSealedTurns={projection.remoteSealedTurns}
        remoteLiveTurns={projection.remoteLiveTurns}
        timelineEntries={
          searchState === null
            ? projection.timeline
            : (searchState.page?.turns ?? []).map((turn) => ({ kind: "turn", turn }))
        }
        queuedPrompts={projection.queuedPrompts}
        composerState={composerState}
        historyRestoreReady={searchState === null ? historyRestoreReady : searchState.page !== null}
        messageListState={
          searchState === null
            ? messageListState
            : searchState.status === "error"
              ? {
                  status: "error",
                  message: searchState.message,
                  retry: async () => await searchWindow?.retry(),
                }
              : searchState.page !== null
                ? { status: "ready" }
                : { status: "loading" }
        }
        historyViewport={
          searchWindow === null
            ? historyViewport
            : {
                readStatus: () =>
                  searchWindow.state$.peek().status === "loading" ? "loading-history" : "ready",
                completeTurnHeaders: false,
                containsBeginning: false,
                containsLatest: false,
                loadOlder: async () => await searchWindow.loadRange("older"),
                loadNewer: async () => await searchWindow.loadRange("newer"),
                loadLatest: async () => {
                  searchWindow.cancelViewportFill();
                  await historyViewport.loadLatest();
                  if (!isSelectedSearchWindow(searchWindow)) return;
                  startTransition(() => {
                    setHistoryAnchorTurnId(null);
                    conversation.onExitSearchHistory?.();
                  });
                },
                reportViewport: async (viewportHeight, contentHeight) =>
                  await searchWindow.reportViewport(viewportHeight, contentHeight),
                trimAfterGesture: async () => {},
              }
        }
        historyActivityModel={historyModel}
        historyActivityResourceId={historyResourceId}
        threadChatModel={chatDatabase.chat}
        onLoadTurnItems={async (turnId) => {
          const items = await remote.loadTurnItems(connectionId, threadId, turnId);
          searchWindow?.replaceItems(turnId, items);
        }}
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
        {...conversation}
        remoteThread={null}
        remoteSealedTurns={[]}
        remoteLiveTurns={[]}
        timelineEntries={[]}
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
  return route.kind === "thread" ? (
    <MainConversationDetail {...conversation} {...route} />
  ) : (
    <NewConversationDetail {...conversation} {...route} />
  );
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
            <Pressable
              onPress={onBack}
              style={styles.headerIcon}
              accessibilityLabel="Back to threads"
            >
              <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
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
        <MessageListSkeleton />
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
            const navigationId = recordThreadNavigationVisualEvent(
              connectionId,
              threadId,
              "suspense_fallback_visible",
            );
            return navigationId === null
              ? undefined
              : () =>
                  recordThreadNavigationVisualEvent(
                    connectionId,
                    threadId,
                    "suspense_fallback_hidden",
                    {},
                    navigationId,
                  );
          }}
        />
      )}
      <ConversationNavigationLoader {...loader} />
    </>
  );
}

const timelineRowCache = new WeakMap<
  Thread["turns"][number],
  Extract<TimelineItem, { kind: "turn" }>
>();
const optimisticTimelineRowCache = new WeakMap<
  object,
  Extract<TimelineItem, { kind: "optimistic" }>
>();

function projectOptimisticTimelineItem(
  delivery: ProjectedThreadChatDelivery,
  composerScope: string,
): Extract<TimelineItem, { kind: "optimistic" }> {
  const cached = optimisticTimelineRowCache.get(delivery);
  if (cached?.scope === composerScope) return cached;
  const item: Extract<TimelineItem, { kind: "optimistic" }> = {
    kind: "optimistic",
    scope: composerScope,
    id: delivery.commandId,
    text: delivery.text,
    attachments: delivery.attachments ?? [],
    ...(delivery.workspaceRequestId === undefined
      ? {}
      : { workspaceRequestId: delivery.workspaceRequestId }),
    status: normalizePendingDeliveryState(delivery.state),
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
  };
  optimisticTimelineRowCache.set(delivery, item);
  return item;
}

function projectTimelineTurns(
  turns: readonly Thread["turns"][number][],
  composerScope: string,
  connectionId: string,
  threadId: string,
): Extract<TimelineItem, { kind: "turn" }>[] {
  return turns.map((rawTurn) => {
    const cached = timelineRowCache.get(rawTurn);
    if (cached !== undefined) return cached;
    const item: Extract<TimelineItem, { kind: "turn" }> = {
      kind: "turn",
      id: rawTurn.id,
      key: `${composerScope}\u0000${rawTurn.id}`,
      connectionId,
      threadId,
      scope: composerScope,
      turn: rawTurn,
    };
    timelineRowCache.set(rawTurn, item);
    return item;
  });
}

function timelineItemKey(item: TimelineItem): string {
  if (item.kind === "turn") return remoteTurnTimelineKey(item.scope, item.id, item.turn.items);
  if (item.kind === "optimistic") return optimisticTimelineKey(item.scope, item.id);
  return `turn-meta-${item.key}`;
}

function projectTimelineDateLabels(
  items: readonly TimelineItem[],
  includesBeginning: boolean,
): ReadonlyMap<TimelineItem, TimelineTurnDateLabels> {
  const labels = new Map<TimelineItem, TimelineTurnDateLabels>();
  const dates = new TimelineDateSequence(includesBeginning);
  for (const item of items) {
    if (item.kind === "meta") continue;
    const timestampMs = timelineItemTimestampMs(item);
    const before =
      item.kind === "optimistic" || item.turn.items.some((entry) => entry.type === "userMessage")
        ? dates.next(timestampMs)
        : null;
    const completedAt = item.kind === "turn" ? item.turn.completedAt : null;
    const agent =
      item.kind === "turn"
        ? dates.next(completedAt === null ? timestampMs : protocolTimestampMs(completedAt))
        : null;
    if (before !== null || agent !== null) labels.set(item, { before, agent });
  }
  return labels;
}

function timelineItemTimestampMs(item: TimelineItem): number | null {
  if (item.kind === "optimistic") return Number.isFinite(item.createdAt) ? item.createdAt : null;
  if (item.kind !== "turn") return null;
  return protocolTimestampMs(item.turn.startedAt);
}

const timelineSearchTextCache = new WeakMap<object, string>();

class ScrollOffsetMemory {
  #values = new Map<string, number>();

  read(key: string): number {
    return this.#values.get(key) ?? 0;
  }
  write(key: string, value: number): void {
    this.#values.set(key, value);
  }
}

class ThreadListItemProjection {
  #source: readonly StoredThreadSummary[] | null = null;
  #value: ThreadListItem[] = [];

  project(source: readonly StoredThreadSummary[]): ThreadListItem[] {
    if (source === this.#source) return this.#value;
    this.#source = source;
    this.#value = source.map(storedThreadToListItem);
    return this.#value;
  }
}

class ThreadServerProjection {
  #value: ThreadListServer[] = [];

  project(connections: readonly StoredConnection[]): ThreadListServer[] {
    const next = connections.map((server) => ({
      id: server.id,
      name: server.displayName,
      emoji: server.emoji,
      status: server.enabled ? server.state : ("offline" as const),
    }));
    if (
      next.length === this.#value.length &&
      next.every((server, index) => {
        const current = this.#value[index];
        return (
          current !== undefined &&
          current.id === server.id &&
          current.name === server.name &&
          current.emoji === server.emoji &&
          current.status === server.status
        );
      })
    )
      return this.#value;
    this.#value = next;
    return this.#value;
  }
}

class ThreadListScopeProjection {
  #source: readonly ThreadListItem[] | null = null;
  #serverId = "";
  #value = {
    scoped: [] as ThreadListItem[],
    active: [] as ThreadListItem[],
    archived: [] as ThreadListItem[],
  };

  project(
    source: readonly ThreadListItem[],
    serverId: string,
  ): {
    scoped: ThreadListItem[];
    active: ThreadListItem[];
    archived: ThreadListItem[];
  } {
    if (source === this.#source && serverId === this.#serverId) return this.#value;
    this.#source = source;
    this.#serverId = serverId;
    const scoped =
      serverId === ALL_SERVERS_ID
        ? [...source]
        : source.filter((thread) => thread.serverId === serverId);
    this.#value = {
      scoped,
      active: scoped.filter((thread) => !thread.archived),
      archived: scoped.filter((thread) => thread.archived),
    };
    return this.#value;
  }
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
      if (profile.status === "live" && profile.previewUrl !== null)
        onOpen(profile.label, profile.previewUrl);
    },
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
        preference:
          existing?.preference === "excluded" ? "included" : (existing?.preference ?? "included"),
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
    onReconnect: async (profileId) =>
      await nativePortForwardingStore.reconnect(connectionId, profileId),
    onRemove: async (profileId) => await nativePortForwardingStore.remove(connectionId, profileId),
    onSetPreference: async (profileId, preference) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile === undefined) throw new Error("Port forward not found");
      const candidate = snapshot.discoveredPorts.find(
        (value) => value.forwardingKey === profile.serviceKey,
      );
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: candidate?.port ?? profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference,
        startImmediately:
          preference === "included" ||
          (preference === "automatic" && candidate?.defaultForwardingEnabled === true),
      });
    },
  };
}

export function CodeWideScreen() {
  const windowLayout = useWindowLayout();
  const insets = useSafeAreaInsets();
  const remote = useRemoteWorkspace();
  return (
    <CodeWideWorkspaceScreen
      desktop={windowLayout.desktop}
      viewportWidth={windowLayout.width}
      insets={insets}
      remote={remote}
    />
  );
}

function CodeWideWorkspaceScreen({
  desktop,
  viewportWidth,
  insets,
  remote,
}: {
  desktop: boolean;
  viewportWidth: number;
  insets: ReturnType<typeof useSafeAreaInsets>;
  remote: RemoteWorkspace;
}) {
  const [threadNavigation] = useState(createThreadNavigationModel);
  return (
    <CodeWideWorkspaceContent
      desktop={desktop}
      viewportWidth={viewportWidth}
      insets={insets}
      remote={remote}
      threadNavigation={threadNavigation}
    />
  );
}

function CodeWideWorkspaceContent({
  desktop,
  viewportWidth,
  insets,
  remote,
  threadNavigation,
}: {
  desktop: boolean;
  viewportWidth: number;
  insets: ReturnType<typeof useSafeAreaInsets>;
  remote: RemoteWorkspace;
  threadNavigation: ThreadNavigationModel;
}) {
  const dialog = useAppDialog();
  const [connectionSheetVisible, setConnectionSheetVisible] = useState(false);
  const [pendingPairingCode, setPendingPairingCode] = useState<string | null>(null);
  const [newThreadVisible, setNewThreadVisible] = useState(false);
  const newChatCounterRef = useRef(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [loopbackBrowser, setLoopbackBrowser] = useState<{ title: string; url: string } | null>(
    null,
  );
  const workspaceOverlay = useAppFullscreenOverlay();
  const [mobileThreadQuery, setMobileThreadQuery] = useState("");
  const [mobileThreadOffset] = useState(() => new ScrollOffsetMemory());
  const [threadListMode, setThreadListMode] = useState<ThreadListMode>("active");
  const [threadListFilter, setThreadListFilter] = useState<ThreadListFilter>("all");
  const [sidebarProject, setSidebarProject] = useState<SidebarProject | null>(null);
  const [projectListMode, setProjectListMode] = useState<ThreadListMode>("active");
  const [projectListFilter, setProjectListFilter] = useState<ThreadListFilter>("all");
  const [projectListLimits, setProjectListLimits] = useState<Readonly<Record<string, number>>>({});
  const [projectsSheetVisible, setProjectsSheetVisible] = useState(false);
  const projectOrder = useSidebarProjectOrder();
  const [projectDirectoryServerId, setProjectDirectoryServerId] = useState<string | null>(null);
  const [threadServerProjection] = useState(() => new ThreadServerProjection());
  const servers = threadServerProjection.project(remote.connections);
  const settingsConnections: StoredConnection[] = remote.connections;
  const [requestedServerId, setActiveServerId] = useState(ALL_SERVERS_ID);
  const [desktopDefaultThreadEnabled, setDesktopDefaultThreadEnabled] = useState(true);
  const activeServerId =
    servers.length <= 1 || requestedServerId === ALL_SERVERS_ID
      ? ALL_SERVERS_ID
      : servers.some((server) => server.id === requestedServerId)
        ? requestedServerId
        : ALL_SERVERS_ID;
  const searchSessionId = useId();
  const [searchSession] = useState(() => new SearchSession(searchSessionId));
  const [searchVisible, setSearchVisible] = useState(false);
  const [threadListLimit, setThreadListLimit] = useState(THREAD_LIST_PAGE_SIZE);
  const [threadListProjection] = useState(() => new ThreadListProjection());
  const [threadListItemProjection] = useState(() => new ThreadListItemProjection());
  const [threadListScopeProjection] = useState(() => new ThreadListScopeProjection());
  const threadConnectionId =
    activeServerId === ALL_SERVERS_ID || activeServerId === "" ? null : activeServerId;
  const threadSummaryView = useThreadSummaryView(remote.threadSummaryDatabase, {
    connectionId: threadConnectionId,
    recentLimit: threadListMode === "active" ? threadListLimit : 0,
    archivedLimit: threadListMode === "archived" ? threadListLimit : 0,
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
  const projectedThreadSummaries = threadListProjection.project(
    loadedThreadSummaries,
    remote.pendingRequests,
  );
  const threads = threadListItemProjection.project(projectedThreadSummaries);
  const threadScope = threadListScopeProjection.project(threads, activeServerId);
  const scopedThreads = threadScope.scoped;
  const serverThreads = threadScope.active;
  const archivedThreads = threadScope.archived;
  const defaultDesktopThreadId =
    desktop && desktopDefaultThreadEnabled && serverThreads[0] !== undefined
      ? threadSelectionKey(serverThreads[0])
      : null;
  const loadMoreThreads = () => {
    const loadedCount =
      threadListMode === "archived"
        ? archivedThreadSummaryRows.length
        : recentThreadSummaryRows.length + pinnedThreadSummaryRows.length;
    if (loadedCount < threadListLimit) return;
    setThreadListLimit((current) => current + THREAD_LIST_PAGE_SIZE);
  };
  const setActiveThreadId = useEvent(
    (
      value: string | null,
      navigationId?: string,
      nextServerId?: string,
      reloadSelected = false,
      searchWindow: SearchConversationWindow | null = null,
    ) => {
      const requestedThreadId = threadNavigation.current().id;
      const selectedTarget = parseThreadSelectionKey(value);
      if (selectedTarget !== null) {
        void remote
          .observeThread(selectedTarget.connectionId, selectedTarget.threadId)
          .catch((cause: unknown) => {
            console.warn(
              "Could not attach thread observer:",
              cause instanceof Error ? cause.message : "unknown error",
            );
          });
      }
      if (value !== requestedThreadId) {
        // A focused search field or composer keeps the Android IME session alive
        // when the visible surface is replaced. End that session at the navigation
        // boundary so the newly selected conversation never inherits keyboard focus.
        KeyboardController.dismiss({ animated: false, keepFocus: false });
        const target = parseThreadSelectionKey(value);
        if (target !== null)
          remote.threadDetails?.chat.beginPresentation(target.connectionId, target.threadId);
      }
      // Selection is urgent: reveal the destination's cached content or its
      // local skeleton immediately. Background hydration stays model-owned.
      const startedAt = performance.now();
      if (value !== null && searchWindow !== null) threadNavigation.openSearch(value, searchWindow);
      else threadNavigation.select(value, reloadSelected);
      if (nextServerId !== undefined) setActiveServerId(nextServerId);
      requestAnimationFrame(() => {
        const elapsed = performance.now() - startedAt;
        recordTiming("thread_selection_next_frame_ms", elapsed);
        const target = parseThreadSelectionKey(value);
        if (target !== null && navigationId !== undefined) {
          markThreadNavigationStage(
            target.connectionId,
            target.threadId,
            "selection_next_frame",
            {
              values: { animationFrameDelayMs: elapsed },
            },
            navigationId,
          );
        }
        if (__DEV__)
          console.log(`[CodeWide perf] thread_selection_next_frame_ms=${Math.round(elapsed)}`);
      });
    },
  );
  const selectThread = useEvent((value: string) => {
    const target = parseThreadSelectionKey(value);
    let navigationId: string | undefined;
    if (target !== null) {
      navigationId = beginThreadNavigation(target.connectionId, target.threadId);
      void beginNavigationFrameTrace(navigationId);
    }
    // Keep repeated selection as an explicit diagnostic reload path: it runs
    // through the same navigation, hydration, and profiling stages.
    setActiveThreadId(value, navigationId, undefined, true);
  });
  const preloadThread = useEvent((value: string): (() => void) | undefined => {
    const threadSelection = threadNavigation.current();
    const requestedThreadId = threadSelection.id;
    if (
      !remote.native ||
      remote.threadDetails === null ||
      remote.threadUiStateDatabase === null ||
      value === requestedThreadId
    )
      return;
    const target = parseThreadSelectionKey(value);
    if (target === null) return;
    void remote
      .observeThread(target.connectionId, target.threadId, false)
      .catch((cause: unknown) => {
        console.warn(
          "Could not preload thread observer:",
          cause instanceof Error ? cause.message : "unknown error",
        );
      });
    const uiState = remote.threadUiStateDatabase.get(target.connectionId, target.threadId);
    return remote.threadDetails.preloadWindow({
      connectionId: target.connectionId,
      threadId: target.threadId,
      anchorTurnId: uiState?.historyAnchorTurnId ?? null,
      openGeneration: threadSelection.generation + 1,
    });
  });
  const openSearchThread = useEvent((target: LocatedSearchHit, query: string) => {
    const searchWindow =
      target.hit.kind === "thread"
        ? null
        : new SearchConversationWindow(target, query, remote.searchConversation);
    setActiveThreadId(
      threadSelectionKey({ id: target.hit.threadId, serverId: target.connectionId }),
      undefined,
      target.connectionId,
      true,
      searchWindow,
    );
  });
  const openGlobalSearch = useEvent(() => {
    searchSession.requestFocus();
    setSearchVisible(true);
  });
  const closeGlobalSearch = useEvent(() => setSearchVisible(false));
  const sendFeedback = useEvent(
    async (submission: BrowserFeedbackSubmission, signal: AbortSignal) => {
      const target = parseThreadSelectionKey(submission.destination);
      if (
        target === null ||
        !remote.connections.some((connection) => connection.id === target.connectionId)
      )
        throw new Error("Choose an available destination chat");
      await sendBrowserFeedback(remote, target, submission, signal);
    },
  );
  const browserFeedback: Omit<BrowserFeedbackCapability, "initialDestination"> = {
    destinations: scopedThreads.map((thread) => ({
      id: threadSelectionKey(thread),
      label: `${servers.find((server) => server.id === thread.serverId)?.name ?? "Server"} · ${thread.title}`,
    })),
    send: sendFeedback,
  };
  const normalizedMobileThreadQuery = mobileThreadQuery.trim().toLocaleLowerCase();
  const mobileSearchKey = `${activeServerId}\u0000${normalizedMobileThreadQuery}`;
  const mobileRemoteSearchResource = useAsyncResource<ThreadListItem[]>(
    remote.native && sidebarProject === null ? "mobile-thread-search" : null,
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
  const mobileNativeSearch =
    normalizedMobileThreadQuery === "" ? null : (mobileRemoteSearchResource.value ?? []);
  const mobileVisibleThreads =
    mobileNativeSearch === null
      ? serverThreads
      : mobileNativeSearch.filter((thread) => !thread.archived);
  const mobileVisibleArchivedThreads =
    mobileNativeSearch === null
      ? archivedThreads
      : mobileNativeSearch.filter((thread) => thread.archived);
  const projectCatalogConnections =
    newThreadVisible || searchVisible || activeServerId === ALL_SERVERS_ID
      ? remote.connections
      : remote.connections.filter((connection) => connection.id === activeServerId);
  const projectCatalog = useRemoteProjectCatalog(
    remote.native,
    projectCatalogConnections,
    remote.listProjects,
  );
  const projectsByConnection = projectCatalog.projectsByConnection;
  const projectErrorsByConnection = projectCatalog.errorsByConnection;
  const unreadProjectKeys = useSelector(
    () => remote.threadSummaryDatabase?.projectUnread.projects$.get() ?? [],
  );
  const sidebarServers = servers.filter(
    (server) => activeServerId === ALL_SERVERS_ID || server.id === activeServerId,
  );
  const availableSidebarProjects = orderSidebarProjects(
    sidebarProjects(projectsByConnection, sidebarServers, unreadProjectKeys),
    projectOrder.order,
  );
  const pinnedSidebarProjects = availableSidebarProjects.filter((project) => project.pinned);
  const searchProjects = searchVisible
    ? orderSidebarProjects(
        sidebarProjects(projectsByConnection, servers, []),
        projectOrder.order,
      ).map((project) => ({
        id: project.key,
        serverId: project.connectionId,
        path: project.path,
        name: project.name,
        subtitle: project.subtitle,
        pinned: project.pinned,
      }))
    : [];
  const sidebarSearch = searchVisible ? (
    <GlobalSearchScreen
      remote={remote}
      servers={servers}
      threads={scopedThreads}
      projects={searchProjects}
      session={searchSession}
      onClose={closeGlobalSearch}
      onOpenThread={openSearchThread}
    />
  ) : null;
  const sidebarProjectErrors = sidebarServers.flatMap((server) => {
    const error = projectErrorsByConnection[server.id];
    return error == null ? [] : [`${server.name}: ${error}`];
  });
  const openSidebarProject = (project: SidebarProject) => {
    setSidebarProject(project);
    setProjectListMode("active");
    setMobileThreadQuery("");
  };
  const closeSidebarProject = () => {
    setSidebarProject(null);
    setMobileThreadQuery("");
  };
  const toggleSidebarProject = async (project: SidebarProject) => {
    const updated = await remote.setProjectPinned(
      project.connectionId,
      project.path,
      project.name,
      !project.pinned,
    );
    projectCatalog.mergeProject(project.connectionId, updated);
  };
  const moveSidebarProject = async (project: SidebarProject, direction: -1 | 1) => {
    await projectOrder.move(
      pinnedSidebarProjects.map((entry) => entry.key),
      project.key,
      direction,
    );
  };
  const addSidebarProject = async (connectionId: string, path: string) => {
    const project = await remote.addProject(connectionId, path);
    projectCatalog.mergeProject(connectionId, project);
    return project;
  };
  const sidebarCatalogState = sidebarListState(
    !remote.native || servers.length === 0 ? "ready" : threadSummaryView?.phase,
    threadSummaryView?.error ?? null,
    sidebarServers.some((server) => server.status === "connecting" || server.status === "syncing"),
  );
  const projectManagementSheet = !projectsSheetVisible ? null : projectDirectoryServerId ===
    null ? (
    <SidebarProjectsSheet
      projects={availableSidebarProjects}
      servers={sidebarServers}
      errors={sidebarProjectErrors}
      onToggle={toggleSidebarProject}
      onMove={moveSidebarProject}
      onBrowse={setProjectDirectoryServerId}
      onClose={() => setProjectsSheetVisible(false)}
    />
  ) : (
    <ProjectPickerSheet
      key={projectDirectoryServerId}
      visible
      browseOnly
      cwd=""
      projects={[]}
      discoveredProjects={[]}
      busy={false}
      error={null}
      onReadDirectory={(path) => remote.readDirectory(projectDirectoryServerId, path)}
      onReadHomeDirectory={() => remote.readProjectHome(projectDirectoryServerId)}
      onAddProject={(path) => addSidebarProject(projectDirectoryServerId, path)}
      onSelect={async () => {
        setProjectDirectoryServerId(null);
      }}
      onClose={() => setProjectDirectoryServerId(null)}
    />
  );
  const sidebarMode = sidebarProject === null ? threadListMode : projectListMode;
  const changeSidebarMode = sidebarProject === null ? setThreadListMode : setProjectListMode;
  const sidebarFilter = effectiveThreadListFilter(
    sidebarMode,
    sidebarProject === null ? threadListFilter : projectListFilter,
  );
  const changeSidebarFilter = sidebarProject === null ? setThreadListFilter : setProjectListFilter;
  const sidebarScopeKey = `${activeServerId}:${sidebarMode}${sidebarProject === null ? "" : `:${sidebarProject.key}`}`;
  const projectLimitKey = `${sidebarProject?.key ?? ""}:${projectListMode}`;
  const projectLimit = projectListLimits[projectLimitKey] ?? THREAD_LIST_PAGE_SIZE;
  const loadMoreProjectThreads = () =>
    setProjectListLimits((limits) => ({
      ...limits,
      [projectLimitKey]: (limits[projectLimitKey] ?? THREAD_LIST_PAGE_SIZE) + THREAD_LIST_PAGE_SIZE,
    }));
  const refreshThreadListAccountRateLimits = useEvent(async (): Promise<void> => {
    const refreshableServers =
      activeServerId === ALL_SERVERS_ID
        ? servers.filter((server) => server.status === "live" || server.status === "syncing")
        : servers.filter((server) => server.id === activeServerId);
    await Promise.all(
      refreshableServers.map((server) => remote.refreshAccountRateLimits(server.id)),
    );
  });
  useDeepLinkListener((raw) => {
    if (raw === null) return;
    if (raw.startsWith("codewide://pair") || raw.startsWith("codexremote://pair")) {
      setPendingPairingCode(raw);
      setConnectionSheetVisible(true);
      return;
    }
    const parsed = parseThreadDeepLink(raw);
    if (parsed !== null) {
      setActiveThreadId(
        threadSelectionKey({ serverId: parsed.connectionId, id: parsed.threadId }),
        undefined,
        parsed.connectionId,
      );
    }
  });

  const selectServer = (serverId: string) => {
    setThreadListLimit(THREAD_LIST_PAGE_SIZE);
    setDesktopDefaultThreadEnabled(false);
    setActiveServerId(serverId);
  };

  const openConnectionSheet = () => {
    setConnectionSheetVisible(true);
  };

  const saveConnection = async (input: ConnectionInput): Promise<void> => {
    const added = await remote.addConnection(input);
    if (threadNavigation.destination$.peek().kind === "draft") {
      setActiveServerId(added.id);
      return;
    }
    setActiveThreadId(null, undefined, added.id);
  };

  const toggleConnection = async (connectionId: string, enabled: boolean): Promise<void> =>
    await remote.setConnectionEnabled(connectionId, enabled);

  const reconnectSavedConnection = async (connectionId: string): Promise<void> =>
    await remote.reconnectConnection(connectionId);

  const deleteSavedConnection = async (connectionId: string): Promise<void> =>
    await remote.deleteConnection(connectionId);

  const updateSavedConnection = async (
    connectionId: string,
    input: ConnectionUpdateInput,
  ): Promise<void> => {
    const current = settingsConnections.find((connection) => connection.id === connectionId);
    if (current === undefined) throw new Error("Connection not found");
    if (isProfileOnlyConnectionUpdate(input, current)) {
      const profile = validateConnectionProfile(input.displayName, input.emoji);
      return await remote.updateConnectionProfile(connectionId, profile.displayName, profile.emoji);
    }
    await remote.updateConnection(connectionId, input);
  };

  const moveSavedConnection = async (connectionId: string, direction: -1 | 1): Promise<void> =>
    await remote.moveConnection(connectionId, direction);

  const defaultProjectCwd = (serverId: string): string | null =>
    projectsByConnection[serverId]?.[0]?.path ?? null;

  const createSidebarThread = (): void => {
    if (sidebarProject !== null) {
      void openNewChat(sidebarProject.connectionId, sidebarProject.path);
      return;
    }
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
    threadNavigation.openDraft({
      id: `new-chat-${Date.now()}-${newChatCounterRef.current}`,
      serverId: requestedServerId,
      cwd,
      workspaceMode: "current",
    });
    setActiveServerId(requestedServerId);
    setNewThreadVisible(false);
  };

  const createRepairThread = async (title: string, prompt: string): Promise<void> => {
    const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } =
      workspaceConversationScope(threadNavigation.destination$.peek(), activeServerId);
    if (activeConnectionId === "") throw new Error("No server selected");
    const currentCwd = loadedThreadSummaries.find(
      (candidate) =>
        candidate.connectionId === activeConnectionId &&
        candidate.remoteThreadId === activeRemoteThreadId,
    )?.cwd;
    const threadId = await remote.startThread(activeConnectionId, currentCwd);
    await remote.renameThread(activeConnectionId, threadId, title);
    await remote.sendText(activeConnectionId, threadId, prompt, { type: "start" });
    setActiveThreadId(
      threadSelectionKey({ serverId: activeConnectionId, id: threadId }),
      undefined,
      activeConnectionId,
    );
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
    const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } =
      workspaceConversationScope(threadNavigation.destination$.peek(), activeServerId);
    const activeCwd =
      loadedThreadSummaries.find(
        (row) =>
          row.connectionId === activeConnectionId && row.remoteThreadId === activeRemoteThreadId,
      )?.cwd ?? "/workspace";
    const threadContext =
      activeRemoteThreadId === null
        ? "No thread selected"
        : `Connection: ${activeConnectionId}\nThread: ${activeRemoteThreadId}\nCWD: ${activeCwd}`;
    await createRepairThread(
      `Fix ${failure.label}`.slice(0, 80),
      renderRecoveryPrompt({
        ...failure,
        context: [threadContext, failure.context]
          .filter((value): value is string => value !== undefined && value !== "")
          .join("\n"),
      }),
    );
  };

  const toggleListThreadPin = async (thread: ThreadListItem): Promise<void> => {
    await remote.setThreadPinned(thread.serverId, thread.id, !thread.pinned);
  };

  const archiveListThread = async (thread: ThreadListItem): Promise<void> => {
    await remote.archiveThread(thread.serverId, thread.id);
    if (threadNavigation.current().id === threadSelectionKey(thread)) setActiveThreadId(null);
  };

  const unarchiveListThread = async (thread: ThreadListItem): Promise<void> => {
    await remote.unarchiveThread(thread.serverId, thread.id);
    if (threadNavigation.current().id === threadSelectionKey(thread)) setActiveThreadId(null);
  };

  const markListThreadRead = async (thread: ThreadListItem): Promise<void> => {
    await remote.markThreadRead(thread.serverId, thread.id);
  };
  return (
    <RenderRecoveryProvider onFix={createRenderFailureFixThread}>
      <WorkspaceConversationProviders
        navigation={threadNavigation}
        remote={remote}
        fallbackServerId={activeServerId}
        feedback={browserFeedback}
      >
        {loopbackBrowser !== null ? (
          <ForwardedLoopbackBrowser
            title={loopbackBrowser.title}
            url={loopbackBrowser.url}
            topInset={insets.top}
            bottomInset={insets.bottom}
            onClose={() => setLoopbackBrowser(null)}
          />
        ) : (
          <WorkspaceVoiceAura
            resources={remote.resourceDatabase}
            controller={remote.voiceController}
          >
            <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
              <View style={desktop ? styles.desktopWorkspace : styles.flex}>
                <WorkspaceThreadListVisibility navigation={threadNavigation} desktop={desktop}>
                  {desktop ? (
                    <RecoverableRenderBoundary
                      scope="surface"
                      label="Chat list"
                      resetKey={`desktop-chat-list:${sidebarScopeKey}`}
                      {...(sidebarProject === null ? {} : { onDismiss: closeSidebarProject })}
                    >
                      <Suspense fallback={<ThreadListSuspenseFallback />}>
                        <ThreadSidebar
                          remote={remote}
                          projectLimit={projectLimit}
                          onLoadMoreProject={loadMoreProjectThreads}
                          initialOffset={mobileThreadOffset.read(sidebarScopeKey)}
                          onOffsetChange={(offset) =>
                            mobileThreadOffset.write(sidebarScopeKey, offset)
                          }
                          project={sidebarProject}
                          projects={pinnedSidebarProjects}
                          onOpenProject={openSidebarProject}
                          onBackToProjects={closeSidebarProject}
                          onManageProjects={() => setProjectsSheetVisible(true)}
                          catalogState={
                            normalizedMobileThreadQuery === ""
                              ? sidebarCatalogState
                              : sidebarListState(
                                  mobileRemoteSearchResource.status,
                                  mobileRemoteSearchResource.error,
                                  false,
                                )
                          }
                          width={desktopThreadSidebarWidth(viewportWidth)}
                          servers={servers}
                          activeServerId={activeServerId}
                          threads={serverThreads}
                          archivedThreads={archivedThreads}
                          mode={sidebarMode}
                          filter={sidebarFilter}
                          navigation={threadNavigation}
                          onModeChange={changeSidebarMode}
                          onFilterChange={changeSidebarFilter}
                          onLoadMore={loadMoreThreads}
                          onSelect={selectThread}
                          onOpenSearch={openGlobalSearch}
                          searchContent={sidebarSearch}
                          onPreload={preloadThread}
                          onSelectServer={selectServer}
                          onSettings={() => setSettingsVisible(true)}
                          onNewThread={createSidebarThread}
                          onTogglePin={toggleListThreadPin}
                          onArchive={archiveListThread}
                          onUnarchive={unarchiveListThread}
                          onMarkRead={markListThreadRead}
                          onRefreshAccountRateLimits={refreshThreadListAccountRateLimits}
                        />
                      </Suspense>
                    </RecoverableRenderBoundary>
                  ) : (
                    <RecoverableRenderBoundary
                      scope="surface"
                      label="Chat list"
                      resetKey={`mobile-chat-list:${sidebarScopeKey}`}
                      {...(sidebarProject === null ? {} : { onDismiss: closeSidebarProject })}
                    >
                      <Suspense fallback={<ThreadListSuspenseFallback />}>
                        <MobileThreads
                          remote={remote}
                          projectLimit={projectLimit}
                          onLoadMoreProject={loadMoreProjectThreads}
                          project={sidebarProject}
                          projects={pinnedSidebarProjects}
                          onOpenProject={openSidebarProject}
                          onBackToProjects={closeSidebarProject}
                          onManageProjects={() => setProjectsSheetVisible(true)}
                          catalogState={sidebarCatalogState}
                          servers={servers}
                          activeServerId={activeServerId}
                          threads={mobileVisibleThreads}
                          archivedThreads={mobileVisibleArchivedThreads}
                          mode={sidebarMode}
                          filter={sidebarFilter}
                          query={mobileThreadQuery}
                          onQueryChange={setMobileThreadQuery}
                          onOpenSearch={openGlobalSearch}
                          searchContent={sidebarSearch}
                          onModeChange={changeSidebarMode}
                          onFilterChange={changeSidebarFilter}
                          onLoadMore={loadMoreThreads}
                          initialOffset={mobileThreadOffset.read(sidebarScopeKey)}
                          onOffsetChange={(offset) =>
                            mobileThreadOffset.write(sidebarScopeKey, offset)
                          }
                          onSelectThread={selectThread}
                          onPreloadThread={preloadThread}
                          onSelectServer={selectServer}
                          onNewThread={createSidebarThread}
                          onTogglePin={toggleListThreadPin}
                          onArchive={archiveListThread}
                          onUnarchive={unarchiveListThread}
                          onMarkRead={markListThreadRead}
                          onSettings={() => setSettingsVisible(true)}
                          onRefreshAccountRateLimits={refreshThreadListAccountRateLimits}
                        />
                      </Suspense>
                    </RecoverableRenderBoundary>
                  )}
                </WorkspaceThreadListVisibility>
                <WorkspaceConversationHost
                  navigation={threadNavigation}
                  renderConversation={(destination) => (
                    <ActiveWorkspaceConversation
                      destination={destination}
                      remote={remote}
                      threadNavigation={threadNavigation}
                      desktop={desktop}
                      activeServerId={activeServerId}
                      servers={servers}
                      scopedThreads={scopedThreads}
                      loadedThreadSummaries={loadedThreadSummaries}
                      defaultDesktopThreadId={defaultDesktopThreadId}
                      onSelectThread={setActiveThreadId}
                      onOpenBrowser={(title, url) => setLoopbackBrowser({ title, url })}
                      onManageProjects={() => setProjectsSheetVisible(true)}
                      onShowActiveThreads={() => setThreadListMode("active")}
                      onFixUnsupportedBlock={createUnsupportedFixThread}
                    />
                  )}
                />
              </View>
              {connectionSheetVisible && (
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
              )}
              {projectManagementSheet}
              {settingsVisible && (
                <SubscribedConnectionSettings
                  connections={settingsConnections}
                  onClose={() => setSettingsVisible(false)}
                  onAddServer={() => {
                    setSettingsVisible(false);
                    openConnectionSheet();
                  }}
                  onToggle={toggleConnection}
                  onReconnect={reconnectSavedConnection}
                  onDelete={deleteSavedConnection}
                  onUpdate={updateSavedConnection}
                  onMove={moveSavedConnection}
                  accountRateLimitsDatabase={remote.accountRateLimitsDatabase}
                  {...(!remote.native
                    ? {}
                    : {
                        onRefreshAccountPool: remote.refreshAccountPool,
                        onStartAccountLogin: remote.startAccountLogin,
                        onCancelAccountLogin: remote.cancelAccountLogin,
                        onActivateAccountProfile: remote.activateAccountProfile,
                        onUpdateAccountProfile: remote.updateAccountProfile,
                        onRemoveAccountProfile: remote.removeAccountProfile,
                      })}
                />
              )}
              {newThreadVisible && (
                <NewThreadServerSheet
                  visible={newThreadVisible}
                  servers={servers}
                  onClose={() => setNewThreadVisible(false)}
                  onSelect={async (serverId) =>
                    await openNewChat(serverId, defaultProjectCwd(serverId))
                  }
                />
              )}
            </View>
          </WorkspaceVoiceAura>
        )}
      </WorkspaceConversationProviders>
    </RenderRecoveryProvider>
  );
}

function workspaceConversationScope(
  destination: ConversationNavigationDestination,
  fallbackServerId: string,
) {
  const draft = destination.kind === "draft" ? destination.draft : null;
  const target = destination.kind === "thread" ? parseThreadSelectionKey(destination.key) : null;
  return {
    connectionId:
      draft?.serverId ??
      target?.connectionId ??
      (fallbackServerId === ALL_SERVERS_ID ? "" : fallbackServerId),
    threadId: target?.threadId ?? null,
    composerThreadId: draft?.id ?? target?.threadId ?? null,
  };
}

/** Selected-input context updates must not recreate the workspace children. */
function WorkspaceConversationProviders({
  navigation,
  remote,
  fallbackServerId,
  feedback,
  children,
}: {
  navigation: ThreadNavigationModel;
  remote: RemoteWorkspace;
  fallbackServerId: string;
  feedback: Omit<BrowserFeedbackCapability, "initialDestination">;
  children: ReactNode;
}) {
  const destination = useSelector(() => navigation.destination$.get());
  const { connectionId: activeConnectionId, composerThreadId } = workspaceConversationScope(
    destination,
    fallbackServerId,
  );
  const voiceInputRuntime: AppVoiceInputRuntime = {
    controller: remote.voiceController,
    resources: remote.resourceDatabase,
    scopePrefix: `${activeConnectionId || "local"}\u0000${composerThreadId ?? "workspace"}`,
    // The workspace provider never materializes a selected chat. Each
    // ConversationPane installs its own thread-scoped provider below Suspense.
    thread: null,
    ...(remote.native && activeConnectionId !== ""
      ? {
          startRemote: async (listener, options) =>
            await remote.startVoiceTranscription(
              activeConnectionId,
              composerThreadId ?? "",
              listener,
              options,
            ),
        }
      : {}),
  };

  return (
    <BrowserFeedbackContext.Provider
      value={{
        ...feedback,
        initialDestination: destination.kind === "thread" ? destination.key : "",
      }}
    >
      <AppVoiceInputProvider runtime={voiceInputRuntime}>{children}</AppVoiceInputProvider>
    </BrowserFeedbackContext.Provider>
  );
}

type SelectWorkspaceThread = (
  value: string | null,
  navigationId?: string,
  nextServerId?: string,
  reloadSelected?: boolean,
) => void;

/** Owns destination-dependent reads and actions, never the sidebar or global sheets. */
function ActiveWorkspaceConversation({
  destination,
  remote,
  threadNavigation,
  desktop,
  activeServerId,
  servers,
  scopedThreads,
  loadedThreadSummaries,
  defaultDesktopThreadId,
  onSelectThread: setActiveThreadId,
  onOpenBrowser,
  onManageProjects,
  onShowActiveThreads,
  onFixUnsupportedBlock,
}: {
  destination: ConversationNavigationDestination;
  remote: RemoteWorkspace;
  threadNavigation: ThreadNavigationModel;
  desktop: boolean;
  activeServerId: string;
  servers: ThreadListServer[];
  scopedThreads: ThreadListItem[];
  loadedThreadSummaries: StoredThreadSummary[];
  defaultDesktopThreadId: string | null;
  onSelectThread: SelectWorkspaceThread;
  onOpenBrowser(title: string, url: string): void;
  onManageProjects(): void;
  onShowActiveThreads(): void;
  onFixUnsupportedBlock(block: RenderBlock): Promise<void>;
}) {
  const newChatDraft = destination.kind === "draft" ? destination.draft : null;
  const searchWindow = destination.kind === "thread" ? destination.searchWindow : null;
  const requestedThreadId = destination.kind === "thread" ? destination.key : null;
  const requestedThreadTarget = parseThreadSelectionKey(requestedThreadId);
  const threadOpenGeneration = destination.generation;
  const exitSearchHistory = useEvent(() => threadNavigation.exitSearch());
  const commitDefaultDesktopThread = useEvent(() => {
    if (defaultDesktopThreadId === null || threadNavigation.destination$.peek().kind !== "empty")
      return;
    threadNavigation.select(defaultDesktopThreadId);
  });
  const selectedThread =
    requestedThreadId === null
      ? null
      : (scopedThreads.find((thread) => threadSelectionKey(thread) === requestedThreadId) ?? null);
  const pendingThreadSelection = requestedThreadId !== null && selectedThread === null;
  const activeThread = newChatDraft === null ? selectedThread : null;
  const activeThreadId =
    activeThread === null
      ? pendingThreadSelection
        ? requestedThreadId
        : null
      : threadSelectionKey(activeThread);
  const activeThreadKey =
    activeThread === null ? requestedThreadId : threadSelectionKey(activeThread);
  const activeConnectionId =
    newChatDraft?.serverId ??
    activeThread?.serverId ??
    requestedThreadTarget?.connectionId ??
    (activeServerId === ALL_SERVERS_ID ? "" : activeServerId);

  const projectCatalog = useRemoteProjectCatalog(
    remote.native,
    remote.connections.filter((connection) => connection.id === activeConnectionId),
    remote.listProjects,
  );
  const { projectsByConnection, errorsByConnection: projectErrorsByConnection } = projectCatalog;
  const activeConnectionState =
    remote.connections.find((connection) => connection.id === activeConnectionId)?.state ??
    "offline";
  const activeRemoteThreadId = activeThread?.id ?? requestedThreadTarget?.threadId ?? null;
  const composerThreadId = newChatDraft?.id ?? activeRemoteThreadId;
  const visibleConversationThread: ThreadListItem | null =
    newChatDraft === null
      ? (activeThread ??
        (requestedThreadTarget === null
          ? null
          : {
              id: requestedThreadTarget.threadId,
              serverId: requestedThreadTarget.connectionId,
              title: "Loading thread…",
              preview: "",
              pinned: false,
              unread: 0,
            }))
      : {
          id: newChatDraft.id,
          serverId: newChatDraft.serverId,
          title: "New Chat",
          preview: "",
          time: "now",
          pinned: false,
          unread: 0,
        };
  const activeStoredThread =
    loadedThreadSummaries.find(
      (candidate) =>
        candidate.connectionId === activeConnectionId &&
        candidate.remoteThreadId === activeRemoteThreadId,
    ) ?? null;
  const activeCwd = newChatDraft?.cwd ?? activeStoredThread?.cwd ?? "/workspace";
  const workspaceSupportResource = useAsyncResource<WorkspaceSupport | null>(
    remote.native && newChatDraft?.cwd !== null && newChatDraft?.cwd !== undefined
      ? `new-chat-workspace-support:${newChatDraft.serverId}:${newChatDraft.cwd}`
      : null,
    `${newChatDraft?.serverId ?? "none"}:${newChatDraft?.cwd ?? "none"}`,
    async () =>
      newChatDraft?.cwd === null || newChatDraft?.cwd === undefined
        ? null
        : await remote.inspectWorkspace(newChatDraft.serverId, newChatDraft.cwd),
  );
  const activeWorkspaceSupport =
    workspaceSupportResource.status === "ready" ? workspaceSupportResource.value : null;
  const activeProjects: RemoteProject[] =
    activeConnectionId === "" || !remote.native
      ? []
      : (projectsByConnection[activeConnectionId] ?? []).filter(({ pinned }) => pinned);
  const activeDiscoveredProjects: RemoteProject[] =
    activeConnectionId === "" || !remote.native
      ? []
      : (projectsByConnection[activeConnectionId] ?? []).filter(({ pinned }) => !pinned);
  const activeProjectError =
    activeConnectionId === "" ? null : (projectErrorsByConnection[activeConnectionId] ?? null);
  const activeControlsResourceId =
    activeConnectionId === "" ? null : turnControlsResourceKey(activeConnectionId, activeCwd);
  const activeThreadResourceId =
    activeConnectionId === "" || activeRemoteThreadId === null
      ? null
      : threadResourceKey(activeConnectionId, activeRemoteThreadId);
  const activeTunnelResourceId =
    activeConnectionId === "" ? null : tunnelResourceKey(activeConnectionId);
  const activePendingRequests = remote.pendingRequests.filter(
    (request) =>
      request.connectionId === activeConnectionId &&
      request.params.threadId === activeRemoteThreadId,
  );
  const activePendingRequest = activePendingRequests[0] ?? null;

  const forkCurrentThread = async (options: ThreadForkOptions): Promise<void> => {
    if (activeThread === null || activeRemoteThreadId === null || activeConnectionId === "")
      throw new Error("No thread selected");
    const forkedId = await remote.forkThread(activeConnectionId, activeRemoteThreadId, options);
    setActiveThreadId(threadSelectionKey({ serverId: activeConnectionId, id: forkedId }));
  };

  const markActiveThreadRead = () => {
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) return;
    void remote.markThreadRead(activeConnectionId, activeRemoteThreadId).catch(() => undefined);
  };

  const changeEmptyThreadProject = async (cwd: string | null): Promise<void> => {
    if (newChatDraft !== null) {
      threadNavigation.changeDraftProject(newChatDraft.id, cwd);
      return;
    }
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) return;
    if (
      (remote.threadDetails?.getThread(activeConnectionId, activeRemoteThreadId)?.turns.length ??
        0) > 0 ||
      (remote.threadDetails?.listQueued(activeConnectionId, activeRemoteThreadId).length ?? 0) > 0
    ) {
      throw new Error("Project can only be changed before the first message");
    }
    if ((cwd ?? null) === (activeStoredThread?.cwd || null)) return;
    const previousThreadId = activeRemoteThreadId;
    const nextThreadId = await remote.startThread(activeConnectionId, cwd ?? undefined);
    setActiveThreadId(
      threadSelectionKey({ id: nextThreadId, serverId: activeConnectionId }),
      undefined,
      activeConnectionId,
    );
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

  const loadTurnChanges = useEvent(async (target: TurnChangesTarget) =>
    turnItemChanges(
      await remote.loadTurnItems(target.connectionId, target.threadId, target.turnId),
    ),
  );

  const activeConversationNavigationKey =
    newChatDraft !== null
      ? `new-chat:${newChatDraft.serverId}:${newChatDraft.id}`
      : (requestedThreadId ?? activeThreadKey ?? "none");
  const activeConversationRoute: ConversationDestinationProps["route"] | null =
    newChatDraft !== null
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
          }
        : null;
  const conversationActions =
    newChatDraft !== null
      ? {
          onSend: async (text: string, _mode: SendMode, options: TurnSendOptions) => {
            const draftChat = newChatDraft;
            let threadId: string;
            if (draftChat.workspaceMode === "isolated") {
              if (draftChat.cwd === null)
                throw new Error("Select a project before creating a workspace");
              threadId = await remote.startThreadInWorkspace(
                draftChat.serverId,
                draftChat.cwd,
                draftChat.id,
              );
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
            setActiveThreadId(
              threadSelectionKey({ id: threadId, serverId: draftChat.serverId }),
              undefined,
              draftChat.serverId,
            );
            return commandId;
          },
          onLoadControls: async (cwd: string) =>
            await remote.loadTurnControls(newChatDraft.serverId, cwd),
          getTransferAccess: async (forceRefresh = false) =>
            await remote.transferAccess(newChatDraft.serverId, forceRefresh),
          onStartVoiceTranscription: async (
            listener: (event: VoiceTranscriptionEvent) => void,
            options?: VoiceTranscriptionOptions,
          ) =>
            await remote.startVoiceTranscription(
              newChatDraft.serverId,
              newChatDraft.id,
              listener,
              options,
            ),
        }
      : activeRemoteThreadId === null
        ? {}
        : {
            onSend: async (text: string, mode: SendMode, options: TurnSendOptions) =>
              await remote.sendText(activeConnectionId, activeRemoteThreadId, text, mode, options),
            onRetryFailedMessage: async (commandId: string) =>
              await remote.retryFailedMessage(activeConnectionId, commandId),
            onLoadControls: async (cwd: string) =>
              await remote.loadTurnControls(activeConnectionId, cwd),
            onUpdateSettings: async (settings: ThreadSettings) => {
              await remote.updateThreadSettings(activeConnectionId, activeRemoteThreadId, settings);
            },
            onInterrupt: async (turnId: string) => {
              await remote.interruptTurn(activeConnectionId, activeRemoteThreadId, turnId);
            },
            onListQueue: async () =>
              await remote.listQueuedPrompts(activeConnectionId, activeRemoteThreadId),
            onEditQueued: async (
              commandId: string,
              text: string,
              attachments: ComposerAttachment[],
            ) => {
              await remote.editQueuedPrompt(activeConnectionId, commandId, text, attachments);
            },
            onCancelQueued: async (commandId: string) => {
              await remote.cancelQueuedPrompt(activeConnectionId, commandId);
            },
            onMoveQueued: async (commandId: string, direction: -1 | 1) => {
              await remote.moveQueuedPrompt(
                activeConnectionId,
                activeRemoteThreadId,
                commandId,
                direction,
              );
            },
            onSteerQueued: async (commandId: string, expectedTurnId: string) => {
              await remote.steerQueuedPrompt(activeConnectionId, commandId, expectedTurnId);
            },
            onListTerminals: async () =>
              await remote.listBackgroundTerminals(activeConnectionId, activeRemoteThreadId),
            onLoadThreadResources: async (
              scope?: ThreadChangeScope,
              kind?: "all" | "changes" | "attachments",
            ) =>
              await remote.loadThreadResources(
                activeConnectionId,
                activeRemoteThreadId,
                scope,
                kind,
              ),
            onLoadThreadChangeDiff: async (path: string, scope?: ThreadChangeScope) =>
              await remote.loadThreadChangeDiff(
                activeConnectionId,
                activeRemoteThreadId,
                path,
                scope,
              ),
            onTerminateTerminal: async (processId: string) =>
              await remote.terminateBackgroundTerminal(
                activeConnectionId,
                activeRemoteThreadId,
                processId,
              ),
            onGetGoal: async () =>
              await remote.getThreadGoal(activeConnectionId, activeRemoteThreadId),
            onSetGoal: async (input: ThreadGoalInput) =>
              await remote.setThreadGoal(activeConnectionId, activeRemoteThreadId, input),
            onClearGoal: async () =>
              await remote.clearThreadGoal(activeConnectionId, activeRemoteThreadId),
            onStartReview: async (target: ReviewTarget, delivery: ReviewDelivery) =>
              await remote.startReview(activeConnectionId, activeRemoteThreadId, target, delivery),
            onCompact: async () =>
              await remote.compactThread(activeConnectionId, activeRemoteThreadId),
            onCreateTunnel: async (port: number, ttlSeconds: number) =>
              await remote.createLocalhostTunnel(activeConnectionId, port, ttlSeconds),
            onRevokeTunnel: async (tunnelId: string) => {
              await remote.revokeLocalhostTunnel(activeConnectionId, tunnelId);
            },
            onRespondToRequest: remote.respondToServerRequest,
            getTransferAccess: async (forceRefresh = false) =>
              await remote.transferAccess(activeConnectionId, forceRefresh),
            onStartVoiceTranscription: async (
              listener: (event: VoiceTranscriptionEvent) => void,
              options?: VoiceTranscriptionOptions,
            ) =>
              await remote.startVoiceTranscription(
                activeConnectionId,
                activeRemoteThreadId,
                listener,
                options,
              ),
          };

  const openActiveLoopbackLink =
    remote.native && activeConnectionId !== ""
      ? async (target: LoopbackLinkTarget) => {
          const profile = await nativePortForwardingStore.ensureStarted({
            connectionId: activeConnectionId,
            remotePort: target.remotePort,
            label: `localhost:${target.remotePort}`,
          });
          onOpenBrowser(profile.label, forwardedLoopbackUrl(target, profile));
        }
      : undefined;
  const closeActiveConversation = () => {
    setActiveThreadId(null);
  };

  if (!desktop && destination.kind === "empty") return null;
  return (
    <>
      {desktop && (
        <CommitOnChangeProbe
          scope="desktop-default-thread"
          revision={destination.kind === "empty" ? defaultDesktopThreadId : null}
          onCommit={commitDefaultDesktopThread}
        />
      )}
      <RecoverableRenderBoundary
        scope="surface"
        label="Conversation"
        context={`Connection: ${activeConnectionId}\nThread: ${composerThreadId ?? "none"}`}
        resetKey={`${activeConnectionId}:${composerThreadId ?? "none"}`}
        onDismiss={closeActiveConversation}
      >
        <Suspense
          fallback={
            <ConversationNavigationFallback
              connectionId={activeConnectionId}
              threadId={activeRemoteThreadId}
              navigationKey={activeConversationNavigationKey}
              thread={visibleConversationThread}
              server={servers.find((server) => server.id === activeConnectionId)}
              cwd={activeCwd}
              compact={!desktop}
              onBack={desktop ? undefined : closeActiveConversation}
            />
          }
        >
          {activeConversationRoute === null ? null : (
            <ConversationDestination
              searchWindow={searchWindow}
              onExitSearchHistory={exitSearchHistory}
              route={activeConversationRoute}
              navigationKey={activeConversationNavigationKey}
              thread={visibleConversationThread}
              newChat={newChatDraft !== null}
              onLoadTurnChanges={loadTurnChanges}
              server={servers.find((server) => server.id === activeConnectionId)}
              compact={!desktop}
              {...(desktop ? {} : { onBack: closeActiveConversation })}
              accountRateLimitsDatabase={remote.accountRateLimitsDatabase}
              {...(activeConnectionId === ""
                ? {}
                : {
                    onRefreshAccountRateLimits: async () =>
                      await remote.refreshAccountRateLimits(activeConnectionId),
                  })}
              workspaceResources={remote.resourceDatabase}
              controlsResourceId={activeControlsResourceId}
              backgroundTerminalsResourceId={activeThreadResourceId}
              threadResourcesModel={remote.resourceDatabase?.threadResources ?? null}
              threadResourceId={activeThreadResourceId}
              threadResourceRevision={activeConnectionState}
              goalResourceId={activeThreadResourceId}
              tunnelResourceId={activeTunnelResourceId}
              portForwardingConnectionId={
                remote.native && activeConnectionId !== "" ? activeConnectionId : null
              }
              portForwardingServerName={
                servers.find((server) => server.id === activeConnectionId)?.name ?? "Server"
              }
              onOpenPortForward={onOpenBrowser}
              {...(openActiveLoopbackLink === undefined
                ? {}
                : { onOpenLoopbackLink: openActiveLoopbackLink })}
              voiceController={remote.voiceController}
              fileTransferController={remote.fileTransferController}
              subagentSummaryDatabase={remote.threadSummaryDatabase}
              subagentThreadDetails={remote.threadDetails}
              onRefreshSubagents={async (rootThreadId: string) =>
                await remote.refreshSubagents(activeConnectionId, rootThreadId)
              }
              loadDraft={remote.loadDraft}
              saveDraft={remote.saveDraft}
              saveDraftAttachments={remote.saveDraftAttachments}
              upsertDraftAttachment={remote.upsertDraftAttachment}
              removeDraftAttachment={remote.removeDraftAttachment}
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
                if (newChatDraft !== null)
                  threadNavigation.changeDraftWorkspaceMode(newChatDraft.id, workspaceMode);
              }}
              onAddProject={addActiveProject}
              onManageProjects={onManageProjects}
              onReadDirectory={readActiveDirectory}
              onRename={async (name) => {
                if (activeRemoteThreadId !== null)
                  await remote.renameThread(activeConnectionId, activeRemoteThreadId, name);
              }}
              onArchive={async () => {
                if (activeRemoteThreadId !== null)
                  await remote.archiveThread(activeConnectionId, activeRemoteThreadId);
                setActiveThreadId(null);
              }}
              onUnarchive={async () => {
                if (activeRemoteThreadId !== null)
                  await remote.unarchiveThread(activeConnectionId, activeRemoteThreadId);
                onShowActiveThreads();
                setActiveThreadId(null);
              }}
              archived={activeThread?.archived ?? false}
              onDelete={async () => {
                if (activeRemoteThreadId !== null)
                  await remote.deleteThread(activeConnectionId, activeRemoteThreadId);
                setActiveThreadId(null);
              }}
              onFork={forkCurrentThread}
              onFixUnsupportedBlock={onFixUnsupportedBlock}
              onTogglePin={async () => {
                if (activeRemoteThreadId === null || activeThreadId === null) return;
                await remote.setThreadPinned(
                  activeConnectionId,
                  activeRemoteThreadId,
                  !(activeThread?.pinned ?? false),
                );
              }}
              {...conversationActions}
            />
          )}
        </Suspense>
      </RecoverableRenderBoundary>
    </>
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
    <View
      testID="forwarded-loopback-browser"
      style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset }]}
    >
      {error !== null && <Text style={styles.previewError}>{error}</Text>}
      <View style={styles.flex}>
        <InternalBrowser
          url={url}
          header={{ title, closeLabel: "Close browser", onClose }}
          originWhitelist={[new URL(url).origin]}
          onHttpError={(statusCode) =>
            setError(
              statusCode === 502
                ? "This port is currently unavailable"
                : `Preview returned HTTP ${statusCode}`,
            )
          }
          onError={setError}
        />
      </View>
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

function ConnectionActivityIndicator({
  status,
  size = 14,
}: {
  status: ServerStatus;
  size?: number;
}) {
  const activity = connectionActivity(status);
  if (status === "live") return null;
  if (activity === null) {
    const icon =
      status === "offline"
        ? "cloud-offline-outline"
        : status === "authRequired"
          ? "key-outline"
          : "alert-circle-outline";
    return (
      <View
        accessible
        accessibilityLabel={connectionStateLabel(status)}
        style={styles.connectionActivityIndicator}
      >
        <Ionicons name={icon} size={size} color={connectionStateColor(status)} />
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={activity === "connecting" ? "Connecting" : "Updating"}
      style={styles.connectionActivityIndicator}
    >
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
  if (diagnostic === "native_frame_journal_overflow")
    return "Incoming update buffer overflowed. A fresh sync is required.";
  if (diagnostic.includes("Pairing or access grant required"))
    return "This device needs to be paired again.";
  if (diagnostic === "IOException") return "The server could not be reached.";
  return diagnostic.split("\n", 1)[0]?.trim() || "Unknown connection error";
}

function connectionDiagnosticTime(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type ThreadListRow = SidebarRow<ThreadListItem>;

type SidebarProjectsNavigation = {
  catalogState: SidebarListState;
  remote: RemoteWorkspace;
  projectLimit: number;
  onLoadMoreProject(): void;
  project: SidebarProject | null;
  projects: readonly SidebarProject[];
  onOpenProject(project: SidebarProject): void;
  onBackToProjects(): void;
  onManageProjects(): void;
};

function useProjectSidebarThreads(
  remote: RemoteWorkspace,
  project: SidebarProject | null,
  mode: ThreadListMode,
  limit: number,
  onLoadMore: () => void,
) {
  const scopeKey = `${project?.key ?? ""}:${mode}`;
  const [projection] = useState(() => new ThreadListProjection());
  const [items] = useState(() => new ThreadListItemProjection());
  const view = useThreadSummaryView(
    remote.threadSummaryDatabase,
    project === null
      ? null
      : {
          viewId: `sidebar-project:${scopeKey}`,
          connectionId: project.connectionId,
          projectCwd: project.path,
          recentLimit: mode === "active" ? limit : 0,
          archivedLimit: mode === "archived" ? limit : 0,
          selectedConnectionId: null,
          selectedThreadId: null,
          subagentConnectionId: null,
          subagentLimit: 0,
        },
  );
  const summaries =
    mode === "archived"
      ? (view?.archived ?? [])
      : deduplicateThreadSummaries([...(view?.pinned ?? []), ...(view?.recent ?? [])]);
  const threads = items.project(projection.project(summaries, remote.pendingRequests));
  const loadMore = () => {
    if (summaries.length < limit) return;
    onLoadMore();
  };
  return { threads, loadMore, state: sidebarListState(view?.phase, view?.error ?? null, false) };
}

function SidebarSectionHeader({ title }: { title: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: THREAD_LIST_SECTION_HEIGHT,
        paddingRight: threadListLayout.edgeInset,
      }}
    >
      <Text numberOfLines={1} style={[styles.sectionHeader, { flex: 1 }]}>
        {title}
      </Text>
    </View>
  );
}

function sidebarRowKey(row: ThreadListRow): string {
  if (row.kind === "header") return `header-${row.title}`;
  if (row.kind === "project") return `project-${row.project.key}`;
  return threadSelectionKey(row.thread);
}

const THREAD_LIST_ROW_CONTENT_HEIGHT = threadListLayout.rowContentHeight;
const THREAD_LIST_ROW_VERTICAL_MARGIN = threadListLayout.rowVerticalMargin;
const THREAD_LIST_ROW_HEIGHT = THREAD_LIST_ROW_CONTENT_HEIGHT + THREAD_LIST_ROW_VERTICAL_MARGIN * 2;
const THREAD_LIST_SECTION_HEIGHT = threadListLayout.sectionHeight;

function threadListRowHeight(row: ThreadListRow): number {
  if (row.kind === "project") return threadListLayout.projectRowHeight;
  return row.kind === "header" ? THREAD_LIST_SECTION_HEIGHT : THREAD_LIST_ROW_HEIGHT;
}

type ThreadListMode = "active" | "archived";

function threadListRowsEqual(previous: ThreadListRow, next: ThreadListRow): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "header" && next.kind === "header") return previous.title === next.title;
  if (previous.kind === "project" && next.kind === "project")
    return (
      previous.project.key === next.project.key &&
      previous.project.name === next.project.name &&
      previous.project.serverLabel === next.project.serverLabel &&
      previous.project.unread === next.project.unread
    );
  if (previous.kind !== "thread" || next.kind !== "thread") return false;
  const left = previous.thread;
  const right = next.thread;
  return (
    left === right ||
    (left.id === right.id &&
      left.serverId === right.serverId &&
      left.title === right.title &&
      left.preview === right.preview &&
      left.time === right.time &&
      left.timestamp === right.timestamp &&
      left.pinned === right.pinned &&
      left.archived === right.archived &&
      left.unread === right.unread &&
      left.state === right.state)
  );
}

function ThreadSidebar({
  catalogState,
  remote,
  project,
  projects,
  onOpenProject,
  onBackToProjects,
  onManageProjects,
  projectLimit,
  onLoadMoreProject,
  initialOffset,
  onOffsetChange,
  width,
  servers,
  activeServerId,
  threads,
  archivedThreads,
  mode,
  filter,
  navigation,
  onOpenSearch,
  searchContent,
  onModeChange,
  onFilterChange,
  onLoadMore,
  onSelect,
  onPreload,
  onSelectServer,
  onSettings,
  onNewThread,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
  onRefreshAccountRateLimits,
}: {
  width: number;
  initialOffset: number;
  onOffsetChange(offset: number): void;
  servers: ThreadListServer[];
  activeServerId: string;
  threads: ThreadListItem[];
  archivedThreads: ThreadListItem[];
  mode: ThreadListMode;
  filter: ThreadListFilter;
  navigation: ThreadNavigationModel;
  onOpenSearch(): void;
  searchContent: ReactNode;
  onModeChange(mode: ThreadListMode): void;
  onFilterChange(filter: ThreadListFilter): void;
  onLoadMore(): void;
  onSelect(id: string): void;
  onPreload(id: string): (() => void) | undefined;
  onSelectServer(id: string): void;
  onSettings(): void;
  onNewThread(): void;
  onTogglePin(thread: ThreadListItem): Promise<void>;
  onArchive(thread: ThreadListItem): Promise<void>;
  onUnarchive(thread: ThreadListItem): Promise<void>;
  onMarkRead(thread: ThreadListItem): Promise<void>;
  onRefreshAccountRateLimits?(): Promise<unknown>;
} & SidebarProjectsNavigation) {
  const projectSource = useProjectSidebarThreads(
    remote,
    project,
    mode,
    projectLimit,
    onLoadMoreProject,
  );
  const hideThreadLists = usePerformanceExperiment("hideThreadLists");
  const [query, setQuery] = useState("");
  const filtered = (project === null ? threads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const filteredArchived = (project === null ? archivedThreads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const rows = sidebarRows(
    mode === "archived" ? filteredArchived : filtered,
    projects,
    mode === "archived" ? "archive" : project === null ? "global" : "project",
  );

  return (
    <View testID="thread-list-pane" style={[styles.threadSidebar, { width }]}>
      <View style={searchContent === null ? styles.threadListHeaderChrome : undefined}>
        <View style={styles.sidebarHeader}>
          <View style={styles.serverTitleRow}>
            {mode === "archived" && project === null && (
              <Pressable
                onPress={() => onModeChange("active")}
                style={styles.headerIcon}
                accessibilityLabel="Back to threads"
              >
                <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
              </Pressable>
            )}
            {project !== null ? (
              <SidebarProjectHeader
                project={project}
                serverName={
                  servers.find((entry) => entry.id === project.connectionId)?.name ?? "Server"
                }
                archived={mode === "archived"}
                onRoot={onBackToProjects}
                onBack={() => {
                  setQuery("");
                  if (mode === "archived") onModeChange("active");
                  else onBackToProjects();
                }}
              />
            ) : mode === "archived" ? (
              <Text
                testID="server-title"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.serverTitle}
              >
                Archived threads
              </Text>
            ) : (
              <Text testID="server-title" numberOfLines={1} style={styles.serverTitle}>
                Threads
              </Text>
            )}
            <ThreadListMenu
              onManageProjects={onManageProjects}
              onSettings={onSettings}
              catalogConnectionIds={
                activeServerId === ALL_SERVERS_ID
                  ? servers.map((entry) => entry.id)
                  : [activeServerId]
              }
              onToggleArchive={() => {
                setQuery("");
                onModeChange(mode === "archived" ? "active" : "archived");
              }}
              archived={mode === "archived"}
              includeArchiveCount={project === null}
              accountDatabase={remote.accountRateLimitsDatabase}
              accountServers={servers.filter((server) => activeServerId === ALL_SERVERS_ID || server.id === activeServerId)}
              {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
            />
          </View>
        </View>
        {searchContent === null && (
          <View style={styles.mobileSearchWrap}>
            <View style={styles.threadSearchRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search threads and messages"
                onPress={onOpenSearch}
                style={[styles.searchBox, styles.threadSearchBox]}
              >
                <InlineIcon name="search" color={colors.textMuted} role="body" />
                <Text style={styles.searchInput}>Search</Text>
              </Pressable>
              <ThreadFilterMenu
                mode={mode}
                projectScoped={project !== null}
                servers={servers}
                activeServerId={activeServerId}
                selected={filter}
                onSelect={onFilterChange}
                onSelectServer={onSelectServer}
              />
            </View>
          </View>
        )}
      </View>
      <View style={styles.threadListContentSurface}>
        {searchContent ??
          (hideThreadLists ? (
            <View style={styles.threadListSuspended}>
              <ThreadListExperimentSuspended />
            </View>
          ) : (
            <LegendList
              data={rows}
              key={`${activeServerId}:${mode}:${project?.key ?? "global"}`}
              dataKey={`desktop-threads:${activeServerId}:${mode}:${project?.key ?? "global"}`}
              initialScrollOffset={initialOffset}
              onScroll={({ nativeEvent }) => onOffsetChange(nativeEvent.contentOffset.y)}
              scrollEventThrottle={100}
              getFixedItemSize={threadListRowHeight}
              drawDistance={320}
              recycleItems
              getItemType={(row) => row.kind}
              itemsAreEqual={threadListRowsEqual}
              keyExtractor={sidebarRowKey}
              keyboardShouldPersistTaps="handled"
              onEndReached={project === null ? onLoadMore : projectSource.loadMore}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={
                <SidebarListFeedback
                  key={`${activeServerId}:${mode}:${query}:${project?.key ?? "global"}`}
                  state={project === null ? catalogState : projectSource.state}
                  archived={mode === "archived"}
                />
              }
              ListFooterComponent={
                rows.length > 0 && mode === "active" && filtered.length === 0 ? (
                  <SidebarListFeedback
                    key={`${activeServerId}:${mode}:${query}:${project?.key ?? "global"}`}
                    state={project === null ? catalogState : projectSource.state}
                    archived={false}
                  />
                ) : null
              }
              renderItem={({ item }) =>
                item.kind === "header" ? (
                  <SidebarSectionHeader title={item.title} />
                ) : item.kind === "project" ? (
                  <SidebarProjectRow
                    project={item.project}
                    onPress={() => {
                      setQuery("");
                      onOpenProject(item.project);
                    }}
                  />
                ) : (
                  <SelectableThreadRow
                    navigation={navigation}
                    thread={item.thread}
                    server={
                      activeServerId === ALL_SERVERS_ID && servers.length > 1
                        ? servers.find((entry) => entry.id === item.thread.serverId)
                        : undefined
                    }
                    onPressIn={() => onPreload(threadSelectionKey(item.thread))}
                    onPress={() => onSelect(threadSelectionKey(item.thread))}
                    onTogglePin={() => onTogglePin(item.thread)}
                    onArchive={() => onArchive(item.thread)}
                    onUnarchive={() => onUnarchive(item.thread)}
                    onMarkRead={() => onMarkRead(item.thread)}
                  />
                )
              }
            />
          ))}
      </View>
      {searchContent === null && mode === "active" && (
        <NewThreadFloatingButton projectName={project?.name ?? null} onPress={onNewThread} />
      )}
    </View>
  );
}

function SelectableThreadRow({
  navigation,
  thread,
  ...row
}: Omit<Parameters<typeof ThreadRow>[0], "selected"> & {
  navigation: ThreadNavigationModel;
}) {
  const selectionKey = threadSelectionKey(thread);
  const selected = useSelector(() => navigation.selection$.id.get() === selectionKey);
  return <ThreadRow {...row} thread={thread} selected={selected} />;
}

function ThreadListMenu({
  onManageProjects,
  onSettings,
  catalogConnectionIds,
  onToggleArchive,
  archived,
  accountDatabase,
  accountServers,
  includeArchiveCount = true,
  onRefreshAccountRateLimits,
}: {
  onManageProjects(): void;
  onSettings(): void;
  catalogConnectionIds: string[];
  onToggleArchive(): void;
  archived: boolean;
  accountDatabase: AccountRateLimitsDatabase | null;
  accountServers: readonly AccountUsageServer[];
  includeArchiveCount?: boolean;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  const archivedCount = useSelector(() =>
    includeArchiveCount && !archived ? catalogSummaryModel.count(catalogConnectionIds) : null,
  );
  return (
    <WorkspaceAccountUsagePopover
      database={accountDatabase}
      servers={accountServers}
      {...(onRefreshAccountRateLimits === undefined
        ? {}
        : { onRefresh: onRefreshAccountRateLimits })}
      placement="bottom"
      align="end"
      actions={[
        {
          id: "projects",
          label: "Manage Projects",
          icon: "folder-outline",
          onPress: onManageProjects,
        },
        {
          id: "archived",
          label: archived ? "Active threads" : "Archived threads",
          ...(archivedCount === null
            ? {}
            : { description: archivedCount === 1 ? "1 thread" : `${archivedCount} threads` }),
          icon: archived ? "chatbubbles-outline" : "archive-outline",
          onPress: onToggleArchive,
        },
        { id: "settings", label: "Settings", icon: "settings-outline", onPress: onSettings },
      ]}
    >
      <Pressable accessibilityLabel="Thread list menu" style={styles.headerIcon}>
        <Ionicons name="ellipsis-vertical" size={iconSize.navigation} color={colors.text} />
      </Pressable>
    </WorkspaceAccountUsagePopover>
  );
}

function ThreadFilterMenu({
  mode,
  projectScoped,
  servers,
  activeServerId,
  selected,
  onSelect,
  onSelectServer,
}: {
  mode: ThreadListMode;
  projectScoped: boolean;
  servers: readonly ThreadListServer[];
  activeServerId: string;
  selected: ThreadListFilter;
  onSelect(filter: ThreadListFilter): void;
  onSelectServer(serverId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const showServerFilter = !projectScoped && servers.length > 1;
  const selectedServer = servers.find((server) => server.id === activeServerId);
  const serverFilterActive = showServerFilter && selectedServer !== undefined;
  const threadFilterActive = selected !== "all";
  const threadOptions = threadFilterOptions(mode);
  const activeCount = Number(serverFilterActive) + Number(threadFilterActive);
  const selectedCriteria = [
    ...(serverFilterActive ? [selectedServer.name] : []),
    ...(threadFilterActive ? [threadFilterLabel(selected, mode)] : []),
  ];
  const accessibilityLabel =
    selectedCriteria.length === 0
      ? "Thread filters, no filters selected"
      : `Thread filters, ${selectedCriteria.join(" and ")} selected`;
  const actions: ActionMenuItem[] = [
    ...(showServerFilter
      ? [
          {
            id: `server:${ALL_SERVERS_ID}`,
            section: "Server",
            label: "All servers",
            selected: activeServerId === ALL_SERVERS_ID,
            keepOpen: true,
          },
          ...servers.map((server) => ({
            id: `server:${server.id}`,
            section: "Server",
            label: `${serverGlyph(server)} ${server.name}`,
            selected: activeServerId === server.id,
            keepOpen: true,
          })),
        ]
      : []),
    ...threadOptions.map((option) => ({
      id: `thread:${option.id}`,
      section: "Threads",
      label: option.label,
      selected: selected === option.id,
    })),
  ];
  const select = (id: string) => {
    if (id.startsWith("server:")) {
      onSelectServer(id.slice("server:".length));
      return;
    }
    if (!id.startsWith("thread:")) return;
    const filter = threadOptions.find((option) => option.id === id.slice("thread:".length));
    if (filter !== undefined) onSelect(filter.id);
  };
  const trigger = (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: activeCount > 0, expanded: open }}
      hitSlop={2}
      style={({ pressed }) => [styles.threadFilterButton, pressed && styles.pressed]}
    >
      <Ionicons
        name={activeCount > 0 ? "filter" : "filter-outline"}
        size={iconSize.action}
        color={colors.text}
      />
      {activeCount > 0 && (
        <View testID="thread-filter-active-dot" style={styles.threadFilterActiveDot} />
      )}
    </Pressable>
  );
  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      menuWidth={344}
      placement="bottom"
      align="end"
      onOpenChange={setOpen}
      onSelect={select}
    >
      {trigger}
    </ActionMenu>
  );
}

function ThreadListSuspenseFallback() {
  return <SidebarListFeedback state={{ status: "loading" }} archived={false} />;
}

function ThreadListExperimentSuspended() {
  return (
    <View style={styles.threadListEmpty}>
      <Ionicons name="pause-circle-outline" size={iconSize.navigation} color={colors.amber} />
      <Text style={styles.threadListEmptyText}>Thread list paused by performance experiment</Text>
    </View>
  );
}

type ThreadListFilter = "all" | "running" | "approval" | "unread" | "pinned";

function threadFilterOptions(
  mode: ThreadListMode,
): ReadonlyArray<{ id: ThreadListFilter; label: string }> {
  if (mode === "archived")
    return [
      { id: "all", label: "All archived" },
      { id: "unread", label: "Unread" },
      { id: "pinned", label: "Pinned" },
    ];
  return [
    { id: "all", label: "All threads" },
    { id: "running", label: "Running" },
    { id: "approval", label: "Approval needed" },
    { id: "unread", label: "Unread" },
    { id: "pinned", label: "Pinned" },
  ];
}

function effectiveThreadListFilter(
  mode: ThreadListMode,
  filter: ThreadListFilter,
): ThreadListFilter {
  return mode === "archived" && (filter === "running" || filter === "approval") ? "all" : filter;
}

function threadFilterLabel(filter: ThreadListFilter, mode: ThreadListMode): string {
  return (
    threadFilterOptions(mode).find((option) => option.id === filter)?.label ??
    (mode === "archived" ? "All archived" : "All threads")
  );
}

function threadMatchesFilter(thread: ThreadListItem, filter: ThreadListFilter): boolean {
  if (filter === "running") return thread.state === "running";
  if (filter === "approval") return thread.state === "approval";
  if (filter === "unread") return thread.unread > 0;
  if (filter === "pinned") return thread.pinned;
  return true;
}

function ThreadRow({
  thread,
  server,
  selected,
  onPressIn,
  onPress,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
}: {
  thread: ThreadListItem;
  server: ThreadListServer | undefined;
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
  const swipeEnabled =
    onTogglePin !== undefined || archiveAction !== undefined || onMarkRead !== undefined;
  const menuActions: ActionMenuItem[] = [
    { id: "copy-session-id", label: "Copy session ID", icon: "copy-outline" },
    {
      id: "pin",
      label: thread.pinned ? "Unpin" : "Pin",
      icon: "pin-outline",
      selected: thread.pinned,
      disabled: onTogglePin === undefined,
    },
    {
      id: "read",
      label: "Mark as read",
      icon: "checkmark-done-outline",
      disabled: onMarkRead === undefined,
    },
    {
      id: "archive",
      label: archiveLabel,
      icon: thread.archived ? "archive" : "archive-outline",
      destructive: !thread.archived,
      disabled: archiveAction === undefined,
    },
  ];
  const runThreadAction = (
    action: (() => Promise<void>) | undefined,
    label: string,
    closeSwipe = false,
  ) => {
    if (action === undefined) return;
    // Start the action before closing the animated row. A close failure must
    // never swallow the actual thread command.
    void action().catch((cause) =>
      dialog.alert(
        `${label} failed`,
        cause instanceof Error ? cause.message : "Thread action failed",
      ),
    );
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
          if (pressIntentReleaseTimerRef.current !== null)
            clearTimeout(pressIntentReleaseTimerRef.current);
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
          if (pressIntentReleaseTimerRef.current !== null)
            clearTimeout(pressIntentReleaseTimerRef.current);
          pressIntentReleaseTimerRef.current = null;
          // The database keeps the transient lease until the mounted
          // conversation acquires its own lease in the retention effect.
          pressIntentCancelRef.current = null;
          swipeableRef.current?.close();
          onPress();
        }}
        {...(Platform.OS === "web"
          ? { onLongPress: () => setWebContextVisible(true), delayLongPress: 350 }
          : {})}
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
            {server !== undefined && (
              <Text accessibilityLabel={`Server ${server.name}`} style={styles.threadServerEmoji}>
                {serverGlyph(server)}
              </Text>
            )}
            <View style={styles.threadTitleSlot}>
              {thread.state === "running" ? (
                <RunningThreadTitle value={thread.title} />
              ) : (
                <ThreadTitle value={thread.title} running={false} />
              )}
            </View>
            {thread.state !== undefined && thread.state !== null && thread.state !== "running" && (
              <View
                accessible
                accessibilityLabel={`Thread ${thread.state}`}
                style={styles.threadStatusIcon}
              >
                <Ionicons
                  name={thread.state === "approval" ? "shield-checkmark" : "alert-circle"}
                  size={iconSize.inline}
                  color={thread.state === "failed" ? colors.red : colors.amber}
                />
              </View>
            )}
            <View style={styles.threadMeta}>
              {thread.unread > 0 && (
                <View style={styles.unreadSlot}>
                  <View
                    accessible
                    accessibilityLabel={`${thread.unread} unread ${thread.unread === 1 ? "message" : "messages"}`}
                    style={styles.unreadDot}
                  />
                </View>
              )}
              <Text testID="thread-time" numberOfLines={1} style={styles.threadTime}>
                {thread.time ?? formatThreadTime(thread.timestamp ?? 0)}
              </Text>
            </View>
          </View>
          <View style={styles.threadPreviewLine}>
            <Text testID="thread-preview" numberOfLines={1} style={styles.threadPreview}>
              {plainThreadPreview(thread.preview)}
            </Text>
          </View>
        </View>
      </GesturePressable>
    </ThreadRowCommitBoundary>
  );
  const rowMenu =
    Platform.OS === "web" ? (
      row
    ) : (
      <ActionMenu
        accessibilityLabel="Thread actions"
        actions={menuActions}
        trigger="long-press"
        onSelect={(id) => {
          if (id === "copy-session-id")
            void copySessionId(thread.id).catch((cause) =>
              dialog.alert(
                "Copy failed",
                cause instanceof Error ? cause.message : "Could not copy session ID",
              ),
            );
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
      {!swipeEnabled ? (
        rowMenu
      ) : (
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
            <ThreadSwipeActions>
              <ThreadSwipeAction
                label={thread.pinned ? "Unpin" : "Pin"}
                icon="push-pin"
                tone="neutral"
                {...(onTogglePin === undefined
                  ? {}
                  : {
                      onPress: () =>
                        runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin", true),
                    })}
              />
              <ThreadSwipeAction
                label="Read"
                icon="checkmark-done-outline"
                tone="accent"
                {...(onMarkRead === undefined
                  ? {}
                  : { onPress: () => runThreadAction(onMarkRead, "Mark as read", true) })}
              />
              <ThreadSwipeAction
                label={archiveLabel}
                icon={thread.archived ? "archive" : "archive-outline"}
                tone={thread.archived ? "accent" : "danger"}
                {...(archiveAction === undefined
                  ? {}
                  : { onPress: () => runThreadAction(archiveAction, archiveLabel, true) })}
              />
            </ThreadSwipeActions>
          )}
        >
          {rowMenu}
        </Swipeable>
      )}
      {Platform.OS === "web" && webContextVisible && (
        <AppSheet
          isOpen={webContextVisible}
          onOpenChange={setWebContextVisible}
          contentProps={{ index: 0, enableDynamicSizing: true }}
        >
          <Text style={styles.sheetTitle}>Thread</Text>
          <MenuAction
            icon="copy-outline"
            title="Copy session ID"
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              void copySessionId(thread.id).catch((cause) =>
                dialog.alert(
                  "Copy failed",
                  cause instanceof Error ? cause.message : "Could not copy session ID",
                ),
              );
            }}
          />
          <MenuAction
            icon="push-pin"
            title={thread.pinned ? "Unpin" : "Pin"}
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(onTogglePin, thread.pinned ? "Unpin" : "Pin");
            }}
          />
          <MenuAction
            icon="checkmark-done-outline"
            title="Mark as read"
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(onMarkRead, "Mark as read");
            }}
          />
          <MenuAction
            danger={!thread.archived}
            icon={thread.archived ? "archive" : "archive-outline"}
            title={archiveLabel}
            subtitle=""
            onPress={() => {
              setWebContextVisible(false);
              runThreadAction(archiveAction, archiveLabel);
            }}
          />
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
  return (
    <>
      {children}
      <EveryCommitProbe onCommit={onCommit} />
    </>
  );
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
  return (
    <>
      {children}
      <EveryCommitProbe
        onCommit={() => recordThreadNavigationRowCommit(connectionId, threadId, rowKey)}
      />
    </>
  );
}

const THREAD_SWIPE_ACTION_WIDTH = layoutSize.row;
const THREAD_SWIPE_UNDERLAY_OVERLAP = radii.selected;
const THREAD_SWIPE_ACTIONS_WIDTH = THREAD_SWIPE_ACTION_WIDTH * 3;

function ThreadSwipeActions({ children }: { children: ReactNode }) {
  return (
    <View style={styles.swipeActionsUnderlay}>
      <View style={styles.swipeActionsRight}>{children}</View>
    </View>
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
  const foreground =
    tone === "neutral"
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
      {icon === "push-pin" ? (
        <MaterialIcons name="push-pin" size={iconSize.action} color={foreground} />
      ) : (
        <Ionicons name={icon} size={iconSize.action} color={foreground} />
      )}
      <Text style={[styles.swipeActionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

function MobileThreads({
  catalogState,
  remote,
  project,
  projects,
  onOpenProject,
  onBackToProjects,
  onManageProjects,
  projectLimit,
  onLoadMoreProject,
  servers,
  activeServerId,
  threads,
  archivedThreads,
  mode,
  filter,
  query,
  onQueryChange,
  onOpenSearch,
  searchContent,
  onModeChange,
  onFilterChange,
  onLoadMore,
  initialOffset,
  onOffsetChange,
  onSelectThread,
  onPreloadThread,
  onSelectServer,
  onNewThread,
  onSettings,
  onTogglePin,
  onArchive,
  onUnarchive,
  onMarkRead,
  onRefreshAccountRateLimits,
}: {
  servers: ThreadListServer[];
  activeServerId: string;
  threads: ThreadListItem[];
  archivedThreads: ThreadListItem[];
  mode: ThreadListMode;
  filter: ThreadListFilter;
  query: string;
  onQueryChange(query: string): void;
  onOpenSearch(): void;
  searchContent: ReactNode;
  onModeChange(mode: ThreadListMode): void;
  onFilterChange(filter: ThreadListFilter): void;
  onLoadMore(): void;
  initialOffset: number;
  onOffsetChange(offset: number): void;
  onSelectThread(id: string): void;
  onPreloadThread(id: string): (() => void) | undefined;
  onSelectServer(id: string): void;
  onNewThread(): void;
  onSettings(): void;
  onTogglePin(thread: ThreadListItem): Promise<void>;
  onArchive(thread: ThreadListItem): Promise<void>;
  onUnarchive(thread: ThreadListItem): Promise<void>;
  onMarkRead(thread: ThreadListItem): Promise<void>;
  onRefreshAccountRateLimits?(): Promise<unknown>;
} & SidebarProjectsNavigation) {
  const projectSource = useProjectSidebarThreads(
    remote,
    project,
    mode,
    projectLimit,
    onLoadMoreProject,
  );
  const hideThreadLists = usePerformanceExperiment("hideThreadLists");
  const filteredThreads = (project === null ? threads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const filteredArchived = (project === null ? archivedThreads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const activeServer = servers.find((server) => server.id === activeServerId);
  const mobileRows = sidebarRows(
    mode === "archived" ? filteredArchived : filteredThreads,
    projects,
    mode === "archived" ? "archive" : project === null ? "global" : "project",
  );

  return (
    <View style={styles.mobileList}>
      <View style={searchContent === null ? styles.threadListHeaderChrome : undefined}>
        <View style={styles.mobileTitleRow}>
          {project !== null ? (
            <SidebarProjectHeader
              project={project}
              serverName={
                servers.find((entry) => entry.id === project.connectionId)?.name ??
                activeServer?.name ??
                "Server"
              }
              archived={mode === "archived"}
              onRoot={onBackToProjects}
              onBack={() => {
                onQueryChange("");
                if (mode === "archived") onModeChange("active");
                else onBackToProjects();
              }}
            />
          ) : mode === "archived" ? (
            <View style={styles.mobileTitleSelector}>
              <Pressable
                accessibilityLabel="Back to threads"
                onPress={() => onModeChange("active")}
                style={styles.headerIcon}
              >
                <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
              </Pressable>
              <View style={styles.mobileIdentity}>
                <Text numberOfLines={1} style={styles.mobileTitle}>
                  Archived threads
                </Text>
                <Text numberOfLines={1} style={styles.mobileSubtitle}>
                  {filteredArchived.length === 1
                    ? "1 thread"
                    : `${filteredArchived.length} threads`}
                </Text>
              </View>
            </View>
          ) : (
            <Text numberOfLines={1} style={[styles.mobileTitle, styles.mobileTitleGrow]}>
              Threads
            </Text>
          )}
          <ThreadListMenu
            onManageProjects={onManageProjects}
            onSettings={onSettings}
            catalogConnectionIds={
              activeServerId === ALL_SERVERS_ID
                ? servers.map((entry) => entry.id)
                : [activeServerId]
            }
            onToggleArchive={() => {
              onQueryChange("");
              onModeChange(mode === "archived" ? "active" : "archived");
            }}
            archived={mode === "archived"}
            includeArchiveCount={project === null}
            accountDatabase={remote.accountRateLimitsDatabase}
            accountServers={servers.filter((server) => activeServerId === ALL_SERVERS_ID || server.id === activeServerId)}
            {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
          />
        </View>
        {searchContent === null && (
          <View style={styles.mobileSearchWrap}>
            <View style={styles.threadSearchRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search threads and messages"
                onPress={onOpenSearch}
                style={[styles.searchBox, styles.threadSearchBox]}
              >
                <InlineIcon name="search" color={colors.textMuted} role="body" />
                <Text style={styles.searchInput}>Search</Text>
              </Pressable>
              <ThreadFilterMenu
                mode={mode}
                projectScoped={project !== null}
                servers={servers}
                activeServerId={activeServerId}
                selected={filter}
                onSelect={onFilterChange}
                onSelectServer={onSelectServer}
              />
            </View>
          </View>
        )}
      </View>
      <View style={styles.threadListContentSurface}>
        {searchContent ??
          (hideThreadLists ? (
            <View style={styles.threadListSuspended}>
              <ThreadListExperimentSuspended />
            </View>
          ) : (
            <LegendList
              data={mobileRows}
              key={`${activeServerId}:${mode}:${project?.key ?? "global"}`}
              dataKey={`mobile-threads:${activeServerId}:${mode}:${project?.key ?? "global"}`}
              initialScrollOffset={initialOffset}
              getFixedItemSize={threadListRowHeight}
              drawDistance={320}
              recycleItems
              getItemType={(item) => item.kind}
              itemsAreEqual={threadListRowsEqual}
              onScroll={({ nativeEvent }) => onOffsetChange(nativeEvent.contentOffset.y)}
              onEndReached={project === null ? onLoadMore : projectSource.loadMore}
              onEndReachedThreshold={0.4}
              scrollEventThrottle={100}
              keyExtractor={sidebarRowKey}
              ListEmptyComponent={
                <SidebarListFeedback
                  key={`${activeServerId}:${mode}:${query}:${project?.key ?? "global"}`}
                  state={project === null ? catalogState : projectSource.state}
                  archived={mode === "archived"}
                />
              }
              ListFooterComponent={
                mobileRows.length > 0 && mode === "active" && filteredThreads.length === 0 ? (
                  <SidebarListFeedback
                    key={`${activeServerId}:${mode}:${query}:${project?.key ?? "global"}`}
                    state={project === null ? catalogState : projectSource.state}
                    archived={false}
                  />
                ) : null
              }
              renderItem={({ item }) =>
                item.kind === "header" ? (
                  <SidebarSectionHeader title={item.title} />
                ) : item.kind === "project" ? (
                  <SidebarProjectRow
                    project={item.project}
                    onPress={() => onOpenProject(item.project)}
                  />
                ) : (
                  <ThreadRow
                    thread={item.thread}
                    server={
                      activeServerId === ALL_SERVERS_ID && servers.length > 1
                        ? servers.find((entry) => entry.id === item.thread.serverId)
                        : undefined
                    }
                    selected={false}
                    onPressIn={() => onPreloadThread(threadSelectionKey(item.thread))}
                    onPress={() => onSelectThread(threadSelectionKey(item.thread))}
                    onTogglePin={() => onTogglePin(item.thread)}
                    onArchive={() => onArchive(item.thread)}
                    onUnarchive={() => onUnarchive(item.thread)}
                    onMarkRead={() => onMarkRead(item.thread)}
                  />
                )
              }
            />
          ))}
      </View>
      {searchContent === null && mode === "active" && (
        <NewThreadFloatingButton projectName={project?.name ?? null} onPress={onNewThread} />
      )}
    </View>
  );
}

function NewThreadFloatingButton({
  projectName,
  onPress,
}: {
  projectName: string | null;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={projectName === null ? "New thread" : `New thread in ${projectName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.newThreadFab, pressed && styles.pressed]}
    >
      <Ionicons name="create-outline" size={iconSize.navigation} color={colors.onPrimary} />
    </Pressable>
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

  const elapsedSeconds =
    phase === "recording"
      ? Math.max(0, Math.floor((Math.max(startedAt, clock) - startedAt) / 1_000))
      : 0;

  return (
    <View accessibilityLabel="Voice recording" style={styles.voiceCapture}>
      {phase === "recording" ? (
        <View style={styles.voiceMeter}>
          {[0.55, 0.8, 1, 0.72, 0.45].map((weight, index) => (
            <View
              key={index}
              style={[styles.voiceMeterBar, { height: 5 + Math.max(0.12, level) * weight * 18 }]}
            />
          ))}
        </View>
      ) : (
        <ActivityIndicator size="small" color={colors.accent} />
      )}
      <Text numberOfLines={1} style={styles.voiceCaptureLabel}>
        {phase === "finishing"
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
  newChat,
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
  newChat: boolean;
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
    async () => (load === undefined ? EMPTY_TURN_CONTROLS : await load(cwd)),
  );
  const controls = resource?.value ?? EMPTY_TURN_CONTROLS;
  const loading = resource?.status === "loading" && resource.value === null;
  const refreshing = resource?.status === "loading" || resource?.status === "refreshing";
  const pending = load !== undefined && (resource === null || refreshing);
  const effectiveError = error ?? resource?.error ?? null;
  const serverExecution =
    remoteThread === null || remoteThread === undefined
      ? null
      : projectedThreadExecutionSettings(remoteThread);
  const { model: effectiveModel, effort: effectiveEffort } = composerModelSettings(
    newChat,
    serverExecution,
    { model: selectedModel, effort: selectedEffort },
    controls,
  );
  const effectivePermissions =
    selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  const modelLabel =
    controls.models.find((candidate) => candidate.id === effectiveModel)?.label ??
    effectiveModel ??
    (pending ? "Loading model…" : "Model not confirmed");
  const modelText = effectiveEffort === null ? modelLabel : `${modelLabel} · ${effectiveEffort}`;
  const permissionLabel =
    effectivePermissions === null
      ? executionPermissionsLabel(serverExecution, pending)
      : permissionProfileLabel(effectivePermissions);
  const modelPending = pending && effectiveModel === null;
  const permissionsPending = pending && effectivePermissions === null;
  return (
    <>
      {readOnly ? (
        <View testID="readonly-model-chip" style={styles.composerContextChip}>
          <InlineIcon name="sparkles-outline" role="label" color={colors.textMuted} />
          <ComposerContextLabel
            loading={modelPending}
            testID="composer-model-label"
            text={modelPending ? "Loading model…" : modelText}
          />
        </View>
      ) : (
        <ModelThinkingMenu
          accessibilityLabel={`Model and thinking: ${modelLabel}, ${effectiveEffort ?? "not specified"}`}
          triggerStyle={styles.composerContextChip}
          triggerChildren={
            <>
              <InlineIcon name="sparkles-outline" role="label" color={colors.textMuted} />
              <ComposerContextLabel
                loading={modelPending}
                testID="composer-model-label"
                text={modelPending ? "Loading model…" : modelText}
              />
            </>
          }
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
        />
      )}
      {readOnly ? (
        <View testID="readonly-permissions-chip" style={styles.composerContextChip}>
          <InlineIcon name="shield-checkmark-outline" role="label" color={colors.textMuted} />
          <ComposerContextLabel
            loading={permissionsPending}
            testID="composer-permissions-label"
            text={permissionsPending ? "Loading access…" : permissionLabel}
          />
        </View>
      ) : (
        <PermissionsMenu
          accessibilityLabel={`Permissions: ${permissionLabel}`}
          triggerStyle={styles.composerContextChip}
          triggerChildren={
            <>
              <InlineIcon name="shield-checkmark-outline" role="label" color={colors.textMuted} />
              <ComposerContextLabel
                loading={permissionsPending}
                testID="composer-permissions-label"
                text={permissionsPending ? "Loading access…" : permissionLabel}
              />
            </>
          }
          permissions={controls.permissions}
          loading={loading}
          error={effectiveError}
          selectedPermissions={effectivePermissions}
          onOpen={() => onQuickOpen("permissions-menu")}
          onClose={() => onClose("permissions-menu")}
          onFallbackPress={() => onFallback("permissions")}
          onSelectPermissions={onSelectPermissions}
        />
      )}
    </>
  );
}

function ComposerPortContextChip({
  connectionId,
  onOpen,
}: {
  connectionId: string | null;
  onOpen(): void;
}) {
  if (connectionId === null) return null;
  return <ComposerPortContextChipLoaded connectionId={connectionId} onOpen={onOpen} />;
}

function ComposerPortContextChipLoaded({
  connectionId,
  onOpen,
}: {
  connectionId: string;
  onOpen(): void;
}) {
  const snapshot = useNativePortForwarding(connectionId);
  if (snapshot.profiles.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ports: ${snapshot.profiles.length}`}
      onPress={onOpen}
      style={styles.composerContextChip}
    >
      <InlineIcon
        name="git-network-outline"
        role="label"
        color={
          snapshot.profiles.some(({ status }) => status === "live")
            ? colors.green
            : colors.textMuted
        }
      />
      <ComposerContextCount
        label="Ports"
        value={snapshot.profiles.length}
        testID="composer-ports-label"
      />
    </Pressable>
  );
}

function ComposerTerminalContextChip({
  connectionId,
  threadId,
  onOpen,
}: {
  connectionId: string | null;
  threadId: string | null;
  onOpen(): void;
}) {
  const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);
  if (workspace.tabs.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Terminals: ${workspace.tabs.length}`}
      onPress={onOpen}
      style={styles.composerContextChip}
    >
      <InlineIcon
        name="terminal-outline"
        role="label"
        color={
          workspace.tabs.some(({ status }) => status === "open") ? colors.green : colors.textMuted
        }
      />
      <ComposerContextCount
        label="Terminals"
        value={workspace.tabs.length}
        testID="composer-terminals-label"
      />
    </Pressable>
  );
}

function ComposerSubagentContextChip({
  database,
  connectionId,
  parentThreadId,
  onOpen,
}: {
  database: ThreadSummaryDatabase | null;
  connectionId: string | null;
  parentThreadId: string | null;
  onOpen(summaries: readonly StoredThreadSummary[]): void;
}) {
  if (database === null || connectionId === null || parentThreadId === null) return null;
  return (
    <Suspense fallback={null}>
      <ComposerSubagentContextChipLoaded
        database={database}
        connectionId={connectionId}
        parentThreadId={parentThreadId}
        onOpen={onOpen}
      />
    </Suspense>
  );
}

function ComposerSubagentContextChipLoaded({
  database,
  connectionId,
  parentThreadId,
  onOpen,
}: {
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Subagents: ${visible.length}`}
      onPress={() => onOpen(summaries)}
      style={styles.composerContextChip}
    >
      <InlineIcon
        name="people-outline"
        role="label"
        color={
          visible.some((summary) => summary.status.type === "active")
            ? colors.green
            : colors.textMuted
        }
      />
      <ComposerContextCount label="Subagents" value={visible.length} />
    </Pressable>
  );
}

function ConversationHistorySubtitle({
  model,
  resourceId,
  server,
  cwd,
}: {
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  server: ThreadListServer | undefined;
  cwd: string;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  const connecting = server?.status === "connecting";
  const text = connecting
    ? "connecting…"
    : activity.status === "background-retrying"
      ? "update delayed"
      : threadContextLabel(server?.name ?? "", cwd);
  const color = connecting
    ? connectionActivityColor("connecting")
    : activity.status === "background-retrying"
      ? colors.amber
      : colors.textMuted;
  return (
    <Text
      testID="conversation-subtitle"
      numberOfLines={1}
      ellipsizeMode="middle"
      style={[styles.conversationSubtitle, { color }]}
    >
      {text}
    </Text>
  );
}

function ConversationBackendRefreshIndicator({
  model,
  connectionId,
  threadId,
}: {
  model: ThreadChatModel | null;
  connectionId: string | null;
  threadId: string | null;
}) {
  const refreshing = useSelector(() => {
    if (model === null || connectionId === null || threadId === null) return false;
    return model.window$(connectionId, threadId).backendRefreshing.get();
  });
  if (!refreshing) return null;
  return (
    <ActivityIndicator
      testID="conversation-backend-refresh-indicator"
      accessibilityLabel="Updating conversation from server"
      size="small"
      color={colors.amber}
      style={styles.conversationBackendRefreshIndicator}
    />
  );
}

function ThreadHistoryLoadingIndicator({
  model,
  resourceId,
  hasTimeline,
}: {
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  hasTimeline: boolean;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  if (!hasTimeline || activity.status !== "loading-history") return null;
  return (
    <View
      pointerEvents="none"
      testID="history-loading-indicator"
      style={styles.historyLoadingIndicator}
    >
      <View style={styles.historyLoadingIndicatorPill}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    </View>
  );
}

function ThreadHistoryEmptyState({
  model,
  resourceId,
  threadSearchActive,
}: {
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  threadSearchActive: boolean;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  const initialLoading = !threadSearchActive && activity.status === "initial-loading";
  return (
    <>
      {initialLoading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      <Text style={styles.emptyText}>
        {threadSearchActive
          ? "No matches"
          : activity.status === "initial-error"
            ? (activity.error ?? "Could not load messages")
            : initialLoading
              ? "Loading messages…"
              : "Start by typing a message"}
      </Text>
    </>
  );
}

function ConversationPane({
  searchWindow = null,
  thread,
  server,
  newChat = false,
  compact = false,
  readOnly = false,
  onBack,
  remoteThread,
  currentUsage = null,
  currentOutcome = null,
  accountRateLimitsDatabase = null,
  onRefreshAccountRateLimits,
  remoteSealedTurns,
  remoteLiveTurns,
  timelineEntries,
  historyViewport = COMPLETE_STATIC_THREAD_HISTORY,
  historyActivityModel = null,
  historyActivityResourceId = null,
  threadChatModel = null,
  onLoadTurnItems,
  onLoadTurnChanges,
  queuedPrompts = [],
  composerState = null,
  historyRestoreReady = true,
  messageListState = { status: "ready" },
  liveTextRecovery = false,
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
  voiceController = null,
  fileTransferController = null,
  subagentSummaryDatabase = null,
  subagentThreadDetails = null,
  onRefreshSubagents,
  onOpenSubagentThread,
  onSend,
  onRetryFailedMessage,
  loadDraft,
  saveDraft,
  saveDraftAttachments,
  upsertDraftAttachment,
  removeDraftAttachment,
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
  onManageProjects,
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
  currentUsage?: TurnUsageProjection | null;
  currentOutcome?: ThreadCurrentOutcome | null;
  accountRateLimitsDatabase?: AccountRateLimitsDatabase | null;
  onRefreshAccountRateLimits?(): Promise<unknown>;
  remoteSealedTurns?: readonly Thread["turns"][number][];
  searchWindow?: SearchConversationWindow | null;
  onExitSearchHistory?(): void;
  remoteLiveTurns?: readonly Thread["turns"][number][];
  timelineEntries?: readonly ProjectedThreadChatTimelineEntry[];
  historyViewport?: ThreadHistoryViewport;
  historyActivityModel?: ThreadHistoryModel | null;
  historyActivityResourceId?: string | null;
  threadChatModel?: ThreadChatModel | null;
  onLoadTurnItems?(turnId: string): Promise<void>;
  onLoadTurnChanges?(target: TurnChangesTarget): Promise<readonly TurnChangedFile[]>;
  queuedPrompts?: QueuedPrompt[];
  composerState?: ThreadUiStateRow | null;
  historyRestoreReady?: boolean;
  messageListState?: MessageListState;
  liveTextRecovery?: boolean;
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
  voiceController?: VoiceInputController | null;
  fileTransferController?: FileTransferController | null;
  subagentSummaryDatabase?: ThreadSummaryDatabase | null;
  subagentThreadDetails?: ThreadDetailDatabase | null;
  onRefreshSubagents?(rootThreadId: string): Promise<void>;
  onOpenSubagentThread?(threadId: string): void;
  onSend?(text: string, mode: SendMode, options: TurnSendOptions): Promise<string>;
  onRetryFailedMessage?(commandId: string): Promise<void>;
  loadDraft?(connectionId: string, threadId: string): Promise<string>;
  saveDraft?(connectionId: string, threadId: string, text: string): Promise<void>;
  saveDraftAttachments?(
    connectionId: string,
    threadId: string,
    attachments: ComposerAttachment[],
  ): Promise<void>;
  upsertDraftAttachment?(
    connectionId: string,
    threadId: string,
    attachment: ComposerAttachment,
    isCurrent: () => boolean,
  ): Promise<void>;
  removeDraftAttachment?(
    connectionId: string,
    threadId: string,
    attachmentId: string,
  ): Promise<void>;
  loadScrollOffset?(connectionId: string, threadId: string): Promise<number | null>;
  saveScrollOffset?(
    connectionId: string,
    threadId: string,
    offset: number,
    historyAnchorTurnId: string | null,
    historyAnchorOffsetPx: number | null,
  ): Promise<void>;
  saveComposerPreferences?(
    connectionId: string,
    threadId: string,
    preferences: StoredComposerPreferences,
  ): Promise<void>;
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
  onManageProjects?(): void;
  onLoadControls?(cwd: string): Promise<TurnControls>;
  onUpdateSettings?(settings: ThreadSettings): Promise<void>;
  onInterrupt?(turnId: string): Promise<void>;
  onListQueue?(): Promise<QueuedPrompt[]>;
  onEditQueued?(commandId: string, text: string, attachments: ComposerAttachment[]): Promise<void>;
  onCancelQueued?(commandId: string): Promise<void>;
  onMoveQueued?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteerQueued?(commandId: string, expectedTurnId: string): Promise<void>;
  onListTerminals?(): Promise<BackgroundTerminal[]>;
  onLoadThreadResources?(
    scope?: ThreadChangeScope,
    kind?: "all" | "changes" | "attachments",
  ): Promise<ThreadResourcesValue>;
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
  onStartVoiceTranscription?(
    listener: (event: VoiceTranscriptionEvent) => void,
    options?: VoiceTranscriptionOptions,
  ): Promise<VoiceTranscriptionSession>;
}) {
  const windowLayout = useWindowLayout();
  const dialog = useAppDialog();
  const parentVoiceInputRuntime = useAppVoiceInputRuntime();
  const conversationInsets = useSafeAreaInsets();
  const openDocument = useDocumentPreview();
  const openVideo = useAttachmentVideoPreview();
  const downloadDocument = useDocumentDownload();
  const draftConnectionId = server?.id ?? null;
  const draftThreadId = thread?.id ?? null;
  // Recovery already materialized these revisions durably. Establish them as
  // the visual baseline; only post-live deltas belong to the reveal animation.
  const animateLiveUpdates = server?.status === "live" && !liveTextRecovery;
  const composerScope = `${draftConnectionId ?? "no-connection"}\u0000${draftThreadId ?? "no-thread"}`;
  const voiceResource = useScopedVoiceInputResource(
    workspaceResources,
    draftConnectionId === null || draftThreadId === null ? null : composerScope,
  );
  const appVoiceInputRuntime: AppVoiceInputRuntime = {
    controller: parentVoiceInputRuntime?.controller ?? voiceController,
    resources: parentVoiceInputRuntime?.resources ?? null,
    scopePrefix: composerScope,
    thread: remoteThread ?? null,
    ...(onStartVoiceTranscription === undefined ? {} : { startRemote: onStartVoiceTranscription }),
  };
  const conversationOwner = useConversationOwner(composerScope);
  const [changesPreferencesState, setChangesPreferencesState] = useConversationState(
    composerScope,
    () => ({
      key: composerScope,
      value: readChangesPreferences(composerScope),
    }),
  );
  const changesPreferences =
    changesPreferencesState.key === composerScope
      ? changesPreferencesState.value
      : readChangesPreferences(composerScope);
  const setChangesPreferences = (next: ChangesPreferences) => {
    changesPreferencesByThread.set(composerScope, next);
    setChangesPreferencesState({ key: composerScope, value: next });
  };
  const currentControlsResource = (): TurnControlsRow | null =>
    workspaceResources === null || controlsResourceId === null
      ? null
      : (workspaceResources.turnControls.get(controlsResourceId) ?? null);
  const controlsResource = currentControlsResource();
  const goalResource = useThreadGoalRow(workspaceResources, goalResourceId);
  useAsyncResource<ThreadGoal | null>(
    onGetGoal === undefined || goalResourceId === null ? null : "conversation-thread-goal",
    goalResourceId ?? "inactive",
    async () => (onGetGoal === undefined ? null : await onGetGoal()),
  );
  const [narrowConversationPane, setNarrowConversationPane] = useState(false);
  const [conversationPaneHeight, setConversationPaneHeight] = useState(0);
  const timelineCompact = compact || narrowConversationPane;
  const [composerTrayVisible, setComposerTrayVisible] = useConversationState(
    composerScope,
    () => false,
  );
  const [threadResourceSheet, setThreadResourceSheet] = useConversationState<
    "changes" | "attachments" | null
  >(composerScope, () => null);
  const [projectPickerVisible, setProjectPickerVisible] = useConversationState(
    composerScope,
    () => false,
  );
  const [projectChangeBusy, setProjectChangeBusy] = useConversationState(
    composerScope,
    () => false,
  );
  const [projectChangeError, setProjectChangeError] = useConversationState<string | null>(
    composerScope,
    () => null,
  );
  const [menuVisible, setMenuVisible] = useConversationState(composerScope, () => false);
  const [menuInitialPage, setMenuInitialPage] = useConversationState<ComposerMenuPage>(
    composerScope,
    () => "model",
  );
  const [inlineQueueExpanded, setInlineQueueExpanded] = useConversationState(
    composerScope,
    () => false,
  );
  const [pastedAttachmentPending, setPastedAttachmentPending] = useConversationState(
    composerScope,
    () => false,
  );
  const pastedAttachmentPendingRef = useConversationRef(composerScope, () => false);
  const largePasteOperationRef = useConversationRef<{
    scope: string;
    connectionId: string | null;
    threadId: string | null;
    capture: ClipboardLargePasteCapture;
  } | null>(composerScope, () => null);
  const voicePhase = voiceResource?.phase ?? "idle";
  const voiceBackend = voiceResource?.backend ?? "remote";
  const voiceError = voiceResource?.error ?? null;
  const voiceRetryAvailable = voiceResource?.retryAvailable ?? false;
  const pendingVoiceSelection = voiceResource?.pendingSelection ?? null;
  const controls = controlsResource?.value ?? EMPTY_TURN_CONTROLS;
  const [controlError, setControlError] = useConversationState<string | null>(
    composerScope,
    () => null,
  );

  const storedDraft = composerState?.draftText ?? "";
  const storedAttachments = composerState?.attachments ?? EMPTY_COMPOSER_ATTACHMENTS;
  const [queuedComposerEdit, setQueuedComposerEdit] =
    useConversationState<QueuedComposerEdit | null>(composerScope, () => null);
  const [queuedComposerEditBusy, setQueuedComposerEditBusy] = useConversationState(
    composerScope,
    () => false,
  );
  const [queuedComposerEditError, setQueuedComposerEditError] = useConversationState<string | null>(
    composerScope,
    () => null,
  );
  const composerUploadScope =
    queuedComposerEdit === null
      ? composerScope
      : `${composerScope}\u0000queue-edit:${queuedComposerEdit.commandId}`;
  const draft = queuedComposerEdit?.text ?? storedDraft;
  const attachments = queuedComposerEdit?.attachments ?? storedAttachments;
  const uploadsBlockSend = useSelector(() => composerUploads.blocksSend(composerUploadScope));
  const attachmentCount = useSelector(() =>
    composerUploads.count(composerUploadScope, attachments),
  );
  const composerPreferences = composerState?.preferences ?? EMPTY_COMPOSER_PREFERENCES;
  const latestComposerValues = useComposerLatestValues(
    composerUploadScope,
    draft,
    attachments,
    composerPreferences,
  );
  const latestDraftRef = latestComposerValues.draft;
  const latestAttachmentsRef = latestComposerValues.attachments;
  const latestComposerPreferencesRef = latestComposerValues.preferences;
  const [contentReviewAttachmentIds, setContentReviewAttachmentIds] = useState(
    () => new Map<string, string>(),
  );
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
  const currentThreadResources = (): ThreadResourcesRow | null =>
    threadResourcesModel === null || threadResourceId === null
      ? null
      : (threadResourcesModel.get(threadResourceId) ?? null);
  const currentChangePresentation = () => {
    const resource = currentThreadResources()?.value ?? null;
    const scopes = resource?.changeScopes ?? ["session" as const, "lastTurn" as const];
    const scope =
      changesPreferences.scope !== null && scopes.includes(changesPreferences.scope)
        ? changesPreferences.scope
        : (resource?.changeScope ?? scopes[0] ?? "session");
    return { resource, scopes, scope };
  };
  const composerStateMissing = composerState === null;
  const updateComposerPreferences = (
    apply: (current: StoredComposerPreferences) => StoredComposerPreferences,
  ) => {
    const next = apply(latestComposerPreferencesRef.current.latest);
    latestComposerPreferencesRef.current.latest = next;
    if (
      saveComposerPreferences !== undefined &&
      draftConnectionId !== null &&
      draftThreadId !== null
    ) {
      void saveComposerPreferences(draftConnectionId, draftThreadId, next).catch(() => undefined);
    }
  };
  // Existing threads are configured via thread/settings/update. Re-sending a
  // persisted local choice would undo model changes made on another device.
  const selectedModel = newChat ? composerPreferences.model : null;
  const selectedEffort = newChat ? composerPreferences.effort : null;
  const selectedPersonality = composerPreferences.personality;
  const selectedPermissions = composerPreferences.permissions;
  const setSelectedModel = (value: string | null | ((current: string | null) => string | null)) =>
    updateComposerPreferences((current) => ({
      ...current,
      model: typeof value === "function" ? value(current.model) : value,
    }));
  const setSelectedEffort = (value: string | null | ((current: string | null) => string | null)) =>
    updateComposerPreferences((current) => ({
      ...current,
      effort: typeof value === "function" ? value(current.effort) : value,
    }));
  const setSelectedPersonality = (value: Personality | null) =>
    updateComposerPreferences((current) => ({ ...current, personality: value }));
  const setSelectedPermissions = (
    value: string | null | ((current: string | null) => string | null),
  ) =>
    updateComposerPreferences((current) => ({
      ...current,
      permissions: typeof value === "function" ? value(current.permissions) : value,
    }));
  const [threadRenameVisible, setThreadRenameVisible] = useConversationState(
    composerScope,
    () => false,
  );
  const [threadSearchVisible, setThreadSearchVisible] = useConversationState(
    composerScope,
    () => false,
  );
  const [threadSearch, setThreadSearch] = useConversationState(composerScope, () => "");
  const [threadSearchMatch, setThreadSearchMatch] = useConversationState(composerScope, () => 0);
  const draftSelectionRef = useConversationRef<DraftSelection>(composerUploadScope, () => ({
    start: 0,
    end: 0,
  }));
  const composerInputRef = useConversationRef<ComposerMarkdownInputHandle | null>(
    composerScope,
    () => null,
  );
  const composerMarkdownRef = useConversationRef(composerUploadScope, () => draft);
  const scrollOffsetRef = useConversationRef(composerScope, () => 0);
  const timelineViewportHeightRef = useConversationRef(composerScope, () => 0);
  const timelineContentHeightRef = useConversationRef(composerScope, () => 0);
  const timelineViewportRef = useRef<View | null>(null);
  const microphoneButtonRef = useRef<View | null>(null);
  const latestUnreadAgentRef = useConversationRef<View | null>(composerScope, () => null);
  const unreadVisibilityFrameRef = useConversationRef<number | null>(composerScope, () => null);
  const unreadVisibilityScheduledKeyRef = useConversationRef<string | null>(
    composerScope,
    () => null,
  );
  const latestUnreadReceiptKeyRef = useConversationRef<string | null>(composerScope, () => null);
  const acknowledgedUnreadReceiptKeyRef = useConversationRef<string | null>(
    composerScope,
    () => null,
  );
  const settingsMutationRef = useConversationRef(composerScope, () => ({
    model: 0,
    effort: 0,
    permissions: 0,
  }));
  const scrollSaveTimerRef = useConversationRef<ReturnType<typeof setTimeout> | null>(
    composerScope,
    () => null,
  );
  const timelineIndexRetryTimerRef = useConversationRef<ReturnType<typeof setTimeout> | null>(
    composerScope,
    () => null,
  );
  const searchOriginOffsetRef = useConversationRef<number | null>(composerScope, () => null);
  const firstVisibleHistoryAnchorRef = useConversationRef<string | null>(composerScope, () => null);
  const firstVisibleHistoryAnchorKeyRef = useConversationRef<string | null>(
    composerScope,
    () => null,
  );
  const firstVisibleHistoryAnchorStatusRef = useConversationRef<
    Thread["turns"][number]["status"] | null
  >(composerScope, () => null);
  const lastTimelineOffsetYRef = useConversationRef<number | null>(composerScope, () => null);
  const scrollGestureStartedAtRef = useConversationRef<number | null>(composerScope, () => null);
  // A bounded range replacement can make LegendList briefly report the
  // opposite edge while MVCP restores the retained item. Keep the first edge
  // reached by a gesture authoritative until the next drag; the list still
  // decides when to load, but one gesture cannot page forward and immediately
  // page backward to the range it just evicted.
  const paginationEdgeLockRef = useConversationRef<"older" | "newer" | null>(
    composerScope,
    () => null,
  );
  const paginationTrimTimerRef = useConversationRef<ReturnType<typeof setTimeout> | null>(
    composerScope,
    () => null,
  );
  const [fullscreenCovered, setFullscreenCovered] = useState(false);
  const [fullscreenScrollOwnership] = useState(() =>
    createFullscreenScrollOwnership((covered) => {
      // Covering the timeline suspends pagination and tail following, not keyboard
      // geometry: dismissing the IME must still remove its inset behind the overlay.
      setFullscreenCovered(covered);
    }),
  );
  const onTimelineFirstVisibleItemChanged = ({
    index,
    item,
  }: {
    index: number;
    item: TimelineItem;
    key: string;
  }) => {
    if (fullscreenScrollOwnership.isCovered()) return;
    const anchor =
      item.kind === "turn"
        ? item
        : (timeline
            .slice(index + 1)
            .find(
              (candidate): candidate is Extract<TimelineItem, { kind: "turn" }> =>
                candidate.kind === "turn",
            ) ?? null);
    firstVisibleHistoryAnchorRef.current = anchor?.id ?? null;
    firstVisibleHistoryAnchorKeyRef.current = anchor === null ? null : timelineItemKey(anchor);
    firstVisibleHistoryAnchorStatusRef.current = anchor?.turn.status ?? null;
    reportHistoryViewport();
  };
  const loadOlderAtTimelineStart = () => {
    if (fullscreenScrollOwnership.isCovered()) return;
    const oppositeEdge = paginationEdgeLockRef.current === "newer";
    if (!oppositeEdge) paginationEdgeLockRef.current = "older";
    if (draftConnectionId !== null && draftThreadId !== null) {
      recordThreadHistoryTelemetry(draftConnectionId, draftThreadId, "chat.scroll.edge_reached", {
        ...(firstVisibleHistoryAnchorRef.current === null
          ? {}
          : { turnId: firstVisibleHistoryAnchorRef.current }),
        values: {
          itemCount: displayedTimeline.length,
          offsetY: lastTimelineOffsetYRef.current ?? 0,
          distanceFromEndPx: scrollOffsetRef.current,
        },
        tags: {
          direction: "older",
          outcome: threadSearchActive
            ? "ignored_search"
            : oppositeEdge
              ? "ignored_opposite_edge"
              : "requested",
          status: historyViewport.readStatus(),
        },
      });
    }
    if (threadSearchActive || oppositeEdge) return;
    void historyViewport.loadOlder().catch(() => undefined);
  };
  const loadNewerAtTimelineEnd = () => {
    if (fullscreenScrollOwnership.isCovered()) return;
    const oppositeEdge = paginationEdgeLockRef.current === "older";
    if (!oppositeEdge) paginationEdgeLockRef.current = "newer";
    if (draftConnectionId !== null && draftThreadId !== null) {
      recordThreadHistoryTelemetry(draftConnectionId, draftThreadId, "chat.scroll.edge_reached", {
        ...(firstVisibleHistoryAnchorRef.current === null
          ? {}
          : { turnId: firstVisibleHistoryAnchorRef.current }),
        values: {
          itemCount: displayedTimeline.length,
          offsetY: lastTimelineOffsetYRef.current ?? 0,
          distanceFromEndPx: scrollOffsetRef.current,
        },
        tags: {
          direction: "newer",
          outcome: threadSearchActive
            ? "ignored_search"
            : oppositeEdge
              ? "ignored_opposite_edge"
              : "requested",
          status: historyViewport.readStatus(),
        },
      });
    }
    if (threadSearchActive || oppositeEdge) return;
    void historyViewport.loadNewer().catch(() => undefined);
  };
  const cancelScheduledPaginationTrim = useEvent(() => {
    if (paginationTrimTimerRef.current === null) return;
    clearTimeout(paginationTrimTimerRef.current);
    paginationTrimTimerRef.current = null;
  });
  const trimPaginationWindow = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) return;
    cancelScheduledPaginationTrim();
    const direction = paginationEdgeLockRef.current;
    paginationEdgeLockRef.current = null;
    if (direction !== null) void historyViewport.trimAfterGesture(direction);
  });
  const schedulePaginationWindowTrim = useEvent(() => {
    cancelScheduledPaginationTrim();
    // Momentum begins immediately after drag end. Give that callback one frame
    // to cancel the trim; otherwise a slow drag settles without waiting for a
    // momentum event that will never arrive.
    paginationTrimTimerRef.current = setTimeout(trimPaginationWindow, 32);
  });
  const timelineRef = useRef<ThreadTimelineListRef>(null);
  const fullscreenOverlayLifecycle: AppFullscreenOverlayLifecycle = {
    willOpen: (id) => {
      fullscreenScrollOwnership.willOpen(id);
      cancelScheduledPaginationTrim();
      dismissComposerKeyboardForOverlay();
    },
    didClose: fullscreenScrollOwnership.didClose,
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
  const awayFromLatestRef = useConversationRef(composerScope, () => false);
  // A saved anchor is only a bootstrap input for this mounted conversation.
  // Reading the mutable session/SQLite value on every render lets later
  // pagination change initialScrollIndex while LegendList is preserving its
  // own visible item, so two independent owners can move the viewport.
  const [initialHistoryRestore] = useConversationState(composerScope, () => {
    const sessionAnchor = sessionConversationHistoryAnchors.get(composerScope);
    return {
      turnId: sessionAnchor?.turnId ?? composerState?.historyAnchorTurnId ?? null,
      viewportOffsetPx:
        sessionAnchor?.viewportOffsetPx ?? composerState?.historyAnchorOffsetPx ?? 0,
    };
  });
  const initialRestoreAnchorTurnId =
    searchWindow?.target.hit.turnId ?? initialHistoryRestore.turnId;
  const searchTimelineScope = `${composerScope}:search:${searchWindow?.target.hit.messageId ?? "live"}`;
  const focusedSearchMessage = useRef<SearchConversationWindow | null>(null);
  const positionedSearchWindow = useRef<SearchConversationWindow | null>(null);
  const isCurrentSearchWindow = useEvent(
    (window: SearchConversationWindow) => window === searchWindow,
  );
  const focusSearchMessage = useEvent((node: View) => {
    const window = searchWindow;
    if (window === null || focusedSearchMessage.current === window) return;
    requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current;
      if (
        viewport === null ||
        !isCurrentSearchWindow(window) ||
        focusedSearchMessage.current === window
      )
        return;
      viewport.measureInWindow((_x, viewportY) =>
        node.measureInWindow((_nodeX, nodeY) => {
          if (!isCurrentSearchWindow(window) || focusedSearchMessage.current === window) return;
          focusedSearchMessage.current = window;
          void timelineRef.current?.scrollToOffset({
            offset: Math.max(
              0,
              (lastTimelineOffsetYRef.current ?? 0) + nodeY - viewportY - spacing.md,
            ),
            animated: false,
          });
        }),
      );
    });
  });
  const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
  const [timelineDidLoad, setTimelineDidLoad] = useConversationState(composerScope, () => false);
  const [awayFromLatest, setAwayFromLatest] = useConversationState(composerScope, () => false);
  const [timelineGestureActive, setTimelineGestureActive] = useConversationState(
    composerScope,
    () => false,
  );
  const mountedConversationScopeRef = useConversationRef(composerScope, () => ({
    scope: composerScope,
    connectionId: draftConnectionId,
    threadId: draftThreadId,
    saveScrollOffset,
  }));
  const newItemCount = awayFromLatest ? unread : 0;
  const serverExecution =
    remoteThread === null || remoteThread === undefined
      ? null
      : projectedThreadExecutionSettings(remoteThread);
  const { model: effectiveModel } = composerModelSettings(
    newChat,
    serverExecution,
    { model: selectedModel, effort: selectedEffort },
    controls,
  );

  const requestControls = () => {
    const current = currentControlsResource();
    if (onLoadControls === undefined || (current?.status === "loading" && current.value === null))
      return;
    setControlError(null);
    void onLoadControls(cwd)
      .then((next) => {
        if (!conversationOwner.isCurrent()) return;
        setSelectedModel((current) =>
          current !== null && !next.models.some((candidate) => candidate.id === current)
            ? null
            : current,
        );
        setSelectedEffort((current) =>
          current !== null && !next.models.some((candidate) => candidate.efforts.includes(current))
            ? null
            : current,
        );
      })
      .catch((cause) => {
        if (!conversationOwner.isCurrent()) return;
        setControlError(cause instanceof Error ? cause.message : "Could not load turn controls");
      });
  };

  const timelineRemoteThreadId = remoteThread?.id;
  const sealedTimeline =
    remoteSealedTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_sealed_timeline",
          () =>
            projectTimelineTurns(
              remoteSealedTurns,
              composerScope,
              server?.id ?? "remote",
              timelineRemoteThreadId,
            ),
          { values: { turnCount: remoteSealedTurns.length } },
        );
  const liveTimeline =
    remoteLiveTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_live_timeline",
          () =>
            projectTimelineTurns(
              remoteLiveTurns,
              composerScope,
              server?.id ?? "remote",
              timelineRemoteThreadId,
            ),
          { values: { turnCount: remoteLiveTurns.length } },
        );
  const fullTimeline =
    remoteThread === null || remoteThread === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_full_timeline",
          () =>
            projectTimelineTurns(
              remoteThread.turns,
              composerScope,
              server?.id ?? "remote",
              remoteThread.id,
            ),
          { values: { turnCount: remoteThread.turns.length } },
        );
  const modelTimeline =
    timelineEntries === undefined || timelineRemoteThreadId === undefined
      ? null
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_model_timeline",
          () =>
            timelineEntries.map((entry) =>
              entry.kind === "turn"
                ? projectTimelineTurns(
                    [entry.turn],
                    composerScope,
                    server?.id ?? "remote",
                    timelineRemoteThreadId,
                  )[0]!
                : projectOptimisticTimelineItem(entry.delivery, composerScope),
            ),
          { values: { itemCount: timelineEntries.length } },
        );
  const completeTurnHeadersResident =
    remoteThread !== null && remoteThread !== undefined && historyViewport.completeTurnHeaders;
  const sessionCompactionCount =
    completeTurnHeadersResident &&
    remoteThread.turns.every((candidate) => candidate.itemsView === "full")
      ? remoteThread.turns.reduce(
          (count, candidate) =>
            count + candidate.items.filter((item) => item.type === "contextCompaction").length,
          0,
        )
      : null;
  const timeline: TimelineItem[] = measureThreadNavigationWork(
    draftConnectionId ?? "",
    draftThreadId,
    "assemble_timeline",
    () => {
      if (modelTimeline !== null) return modelTimeline;
      const partitioned = remoteSealedTurns !== undefined && remoteLiveTurns !== undefined;
      return remoteThread === null || remoteThread === undefined
        ? []
        : partitioned
          ? mergeProjectedThreadPartitions(remoteThread.turns, sealedTimeline, liveTimeline)
          : fullTimeline;
    },
    {
      values: {
        sealedItemCount: sealedTimeline.length,
        liveItemCount: liveTimeline.length,
        fullItemCount: fullTimeline.length,
      },
    },
  );
  const pendingDeliveryOwnsTurn = timeline.some(
    (item) => item.kind === "optimistic" && pendingDeliveryMayOwnTurn(item.status),
  );
  const threadLifecycleActive = isThreadLifecycleActive(thread?.state) || pendingDeliveryOwnsTurn;
  const failureNotice = threadFailureNotice(currentOutcome, remoteThread);
  const currentTurnId = threadLifecycleActive ? activeTurnId(remoteThread) : null;
  const liveTurnPlan = selectLiveTurnPlan(remoteThread, currentTurnId);
  const latestTimelineTurnId = (() => {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item?.kind === "turn") return item.id;
    }
    return null;
  })();
  const latestUnreadAgentTurnId = measureThreadNavigationWork(
    draftConnectionId ?? "",
    draftThreadId,
    "scan_unread_agent_turn",
    () => {
      if (unread <= 0) return null;
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        const item = timeline[index];
        if (item?.kind !== "turn" || item.turn.status === "inProgress") continue;
        if (selectTurnRenderWindow(item.turn).latestAgentIndex >= 0) return item.id;
      }
      return null;
    },
    { values: { itemCount: timeline.length } },
  );
  const latestUnreadReceiptKey =
    latestUnreadAgentTurnId === null ? null : `${composerScope}\u0000${latestUnreadAgentTurnId}`;
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
      if (unreadVisibilityFrameRef.current !== null)
        cancelAnimationFrame(unreadVisibilityFrameRef.current);
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
      if (unreadVisibilityFrameRef.current !== null)
        cancelAnimationFrame(unreadVisibilityFrameRef.current);
      unreadVisibilityFrameRef.current = null;
      unreadVisibilityScheduledKeyRef.current = null;
    };
  };
  const setLatestUnreadAgentNode = (node: View | null) => {
    latestUnreadAgentRef.current = node;
    if (node !== null) scheduleUnreadAgentVisibilityCheck();
  };
  // Loading only owns the transcript area, never the surrounding controls.
  const timelineModelReady = messageListState.status === "ready";
  const timelinePositioned = timelineModelReady && (timeline.length === 0 || timelineDidLoad);
  const conversationBackdropVisible = timelinePositioned && timeline.length > 0;

  const visibleQueuedPrompts = queuedPrompts;
  const inlineQueueOverlayItems: InlineQueueOverlayItem[] = visibleQueuedPrompts.map((entry) => ({
    id: entry.commandId,
    text: entry.text || entry.attachments.map(({ name }) => name).join(", ") || "Attachment",
    attachmentCount: entry.attachments.length,
    createdAt: entry.createdAt,
    state: entry.state,
    lastError: entry.lastError,
  }));

  const deferredThreadSearch = useDeferredValue(threadSearch);
  const threadSearchMatches = (() => {
    const query = deferredThreadSearch.trim().toLocaleLowerCase();
    if (query === "") return [];
    return timeline.flatMap((item, index) =>
      timelineSearchText(item).toLocaleLowerCase().includes(query) ? [index] : [],
    );
  })();
  const threadSearchActive = threadSearch.trim() !== "";
  const reportHistoryViewport = useEvent(() => {
    if (threadSearchActive || fullscreenScrollOwnership.isCovered()) return;
    void historyViewport
      .reportViewport(timelineViewportHeightRef.current, timelineContentHeightRef.current)
      .catch(() => undefined);
  });
  const liveTurnPlanVisible = liveTurnPlan !== null && timelinePositioned && !threadSearchActive;
  const currentGoal = goalResource?.goal ?? null;
  const threadGoalVisible = currentGoal !== null && timelinePositioned && !threadSearchActive;
  const liveStatusVisible = liveTurnPlanVisible || threadGoalVisible;
  const inlineQueueMaxHeight = Math.max(
    controlSize.touch * 3,
    conversationPaneHeight -
      conversationHeaderChromeHeight(threadSearchVisible) -
      conversationBottomContentInset(bottomChromeHeight, liveStatusVisible),
  );
  const displayedTimeline = threadSearchActive
    ? threadSearchMatches.flatMap((index) =>
        timeline[index] === undefined ? [] : [timeline[index]],
      )
    : timeline;
  const positionSearchTurn = useEvent(() => {
    if (
      searchWindow === null ||
      !timelineModelReady ||
      timelineRef.current === null ||
      positionedSearchWindow.current === searchWindow ||
      focusedSearchMessage.current === searchWindow
    )
      return;
    const index = displayedTimeline.findIndex(
      (item) => item.kind === "turn" && item.id === searchWindow.target.hit.turnId,
    );
    if (index < 0) return;
    positionedSearchWindow.current = searchWindow;
    void timelineRef.current.scrollToIndex({ index, animated: false, viewPosition: 0 });
  });
  const timelineDateLabels = projectTimelineDateLabels(timeline, historyViewport.containsBeginning);
  // LegendList may consult its initial target again while a bootstrap layout
  // is still settling. Freeze both the target and its index for this chat activation
  // inside the persistent ConversationPane; window prepend/append must be governed
  // exclusively by maintainVisibleContentPosition after that.
  const [storedTimelineInitialPosition, setTimelineInitialPosition] =
    useConversationState<TimelineInitialPosition | null>(searchTimelineScope, () => null);
  if (timelineModelReady && storedTimelineInitialPosition === null) {
    const anchorIndex =
      initialRestoreAnchorTurnId === null
        ? -1
        : timeline.findIndex(
            (item) => item.kind === "turn" && item.id === initialRestoreAnchorTurnId,
          );
    setTimelineInitialPosition(
      anchorIndex < 0
        ? { kind: "tail" }
        : {
            kind: "item",
            index: anchorIndex,
            viewOffset: searchWindow === null ? initialHistoryRestore.viewportOffsetPx : 0,
            viewPosition: 0,
          },
    );
  }
  const timelineInitialPosition: TimelineInitialPosition = storedTimelineInitialPosition ?? {
    kind: "tail",
  };
  const emptyRemoteThread =
    newChat ||
    (remoteThread !== null &&
      remoteThread !== undefined &&
      historyRestoreReady &&
      historyViewport.readStatus() === "ready" &&
      remoteThread.turns.length === 0 &&
      !timeline.some((item) => item.kind === "optimistic"));
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
    dismissComposerKeyboardForOverlay();
    setThreadResourceSheet("attachments");
    void onLoadThreadResources?.(undefined, "attachments").catch(() => undefined);
  };
  const closeThreadResources = () => {
    setThreadResourceSheet(null);
  };
  const openDocumentLinkFromCwd = (href: string, sourceCwd: string) => {
    const loopback = parseLoopbackLink(href);
    if (loopback !== null && onOpenLoopbackLink !== undefined) {
      void onOpenLoopbackLink(loopback).catch((cause: unknown) => {
        dialog.alert(
          "Could not open localhost",
          cause instanceof Error ? cause.message : "The forwarded URL could not be opened.",
        );
      });
      return true;
    }
    if (getTransferAccess === undefined) return false;
    const target = resolvePreviewableDocumentLink(href, sourceCwd);
    if (target === null) return false;
    const request = { ...target, getTransferAccess: getStableTransferAccess };
    if (isAttachmentVideo(target.name))
      openVideo({
        name: target.name,
        source: { kind: "path", path: target.path },
        getAccess: getStableTransferAccess,
      });
    else if (target.kind === "text") openCodeDocument(request);
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
    const boundaryKey =
      item.kind === "turn" || item.kind === "meta" ? item.key : `${item.scope}\u0000${item.id}`;
    const boundaryContext =
      item.kind === "turn"
        ? `Thread: ${item.threadId}\nTurn: ${item.id}`
        : `Timeline item: ${boundaryKey}`;
    const usage = item.kind === "turn" ? (projectedTurnMetadata(item.turn)?.usage ?? null) : null;
    const dateLabels = timelineDateLabels.get(item);
    const dateLabel = dateLabels?.before ?? null;
    const row = (
      // The virtualized row owns one stable document identity. Recycling is off,
      // so leaving the render window unmounts this subtree instead of rebinding
      // its markdown/activity state to a different turn.
      <SearchMessageFocus.Provider
        key={boundaryKey}
        value={
          searchWindow !== null &&
          item.kind === "turn" &&
          item.id === searchWindow.target.hit.turnId
            ? {
                itemId: searchWindow.messageItemId,
                query: searchWindow.query,
                onLayout: focusSearchMessage,
              }
            : null
        }
      >
        <View style={styles.timelineRow}>
          {dateLabel === null ? null : <TimelineDateSeparator label={dateLabel} />}
          <RecoverableRenderBoundary
            key={boundaryKey}
            scope="bubble"
            label="Conversation item"
            context={boundaryContext}
            resetKey={boundaryKey}
          >
            <MarkdownLocalLinkProvider onOpen={openThreadDocumentLink}>
              <PrivateImageAccessProvider
                scope={composerScope}
                {...(getTransferAccess === undefined ? {} : { getAccess: getStableTransferAccess })}
              >
                <View style={[styles.timelineItem, !timelineCompact && styles.timelineItemWide]}>
                  {item.kind === "turn" && (
                    <TurnTimelineItem
                      turn={item}
                      agentDateLabel={dateLabels?.agent ?? null}
                      compact={timelineCompact}
                      animateLiveUpdates={animateLiveUpdates}
                      usage={usage}
                      forceExpanded={threadSearchActive}
                      pendingRequest={item.turn.status === "inProgress" ? pendingRequest : null}
                      pendingRequestCount={pendingRequestCount}
                      {...(onRespondToRequest === undefined
                        ? {}
                        : { onRespondToRequest: respondToRequest })}
                      {...(getTransferAccess === undefined
                        ? {}
                        : { getTransferAccess: getStableTransferAccess })}
                      {...(onFixUnsupportedBlock === undefined
                        ? {}
                        : { onFixUnsupportedBlock: fixUnsupportedBlock })}
                      {...(onFork === undefined ? {} : { onForkThroughTurn: forkThroughTurn })}
                      {...(onLoadTurnItems === undefined
                        ? {}
                        : { onLoadItems: loadStableTurnItems })}
                      {...(item.id === latestUnreadAgentTurnId
                        ? {
                            latestAgentRef: setLatestUnreadAgentNode,
                            onLatestAgentLayout: scheduleUnreadAgentVisibilityCheck,
                          }
                        : {})}
                    />
                  )}
                  {item.kind === "optimistic" && (
                    <OptimisticTurn
                      item={item}
                      {...(onRetryFailedMessage === undefined
                        ? {}
                        : { onRetry: onRetryFailedMessage })}
                      {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                    />
                  )}
                  {item.kind === "meta" && (
                    <View style={styles.turnMeta}>
                      <Ionicons
                        name={
                          item.status === "failed"
                            ? "close"
                            : item.status === "interrupted"
                              ? "stop"
                              : item.status === "inProgress"
                                ? "ellipsis-horizontal"
                                : "checkmark"
                        }
                        size={iconSize.inline}
                        color={
                          item.status === "failed"
                            ? colors.red
                            : item.status === "inProgress"
                              ? colors.amber
                              : colors.green
                        }
                      />
                      <Text style={styles.turnMetaText}>
                        {formatTurnMeta(item.status, item.durationMs, item.completedAt)}
                      </Text>
                    </View>
                  )}
                </View>
              </PrivateImageAccessProvider>
            </MarkdownLocalLinkProvider>
          </RecoverableRenderBoundary>
        </View>
      </SearchMessageFocus.Provider>
    );
    return item.kind === "turn" ? (
      <ThreadNavigationRowCommitBoundary
        connectionId={item.connectionId}
        threadId={item.threadId}
        rowKey={item.key}
      >
        {row}
      </ThreadNavigationRowCommitBoundary>
    ) : (
      row
    );
  };

  const scrollToThreadSearchIndex = (index: number) => {
    void timelineRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
  };

  const restoreThreadSearchOrigin = () => {
    const offset = searchOriginOffsetRef.current;
    if (offset === null) return;
    searchOriginOffsetRef.current = null;
    if (timelineIndexRetryTimerRef.current !== null)
      clearTimeout(timelineIndexRetryTimerRef.current);
    timelineIndexRetryTimerRef.current = setTimeout(() => {
      timelineIndexRetryTimerRef.current = null;
      timelineRef.current?.scrollToOffset({
        offset: Math.max(
          0,
          timelineContentHeightRef.current - timelineViewportHeightRef.current - offset,
        ),
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
    const next =
      (threadSearchMatch + delta + threadSearchMatches.length) % threadSearchMatches.length;
    setThreadSearchMatch(next);
    scrollToThreadSearchIndex(next);
  };

  const commitInitialTimelineLoad = () => {
    const restoredToAnchor = timelineInitialPosition.kind === "item";
    awayFromLatestRef.current = restoredToAnchor;
    setAwayFromLatest(restoredToAnchor);
    if (draftConnectionId !== null && draftThreadId !== null) {
      const values = {
        itemCount: timeline.length,
        contentHeightPx: timelineContentHeightRef.current,
        viewportHeightPx: timelineViewportHeightRef.current,
      };
      markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_positioned", {
        values,
        tags: { position: restoredToAnchor ? "anchor" : "end" },
      });
      recordThreadNavigationVisualEvent(
        draftConnectionId,
        draftThreadId,
        "timeline_position_applied",
        {
          values,
          tags: { position: restoredToAnchor ? "anchor" : "end" },
        },
      );
    }
    setTimelineDidLoad(true);
  };
  const currentHistoryAnchor = (): { turnId: string | null; viewportOffsetPx: number | null } => {
    const turnId = firstVisibleHistoryAnchorRef.current;
    if (
      !isPersistableHistoryAnchor({
        atEnd: !awayFromLatestRef.current,
        anchorTurnId: turnId,
        anchorTurnStatus: firstVisibleHistoryAnchorStatusRef.current,
        activeTurnId: currentTurnId,
      })
    )
      return { turnId: null, viewportOffsetPx: null };
    const itemKey = turnId === null ? null : firstVisibleHistoryAnchorKeyRef.current;
    return {
      turnId,
      viewportOffsetPx:
        itemKey === null ? null : (timelineRef.current?.getItemViewportOffset(itemKey) ?? null),
    };
  };

  const persistTimelineOffset = (offset: number) => {
    scrollOffsetRef.current = offset;
    const historyAnchor = currentHistoryAnchor();
    if (historyAnchor.turnId === null) sessionConversationHistoryAnchors.delete(composerScope);
    else
      sessionConversationHistoryAnchors.set(composerScope, {
        turnId: historyAnchor.turnId,
        viewportOffsetPx: historyAnchor.viewportOffsetPx,
      });
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (saveScrollOffset === undefined || draftConnectionId === null || draftThreadId === null)
      return;
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null;
      void saveScrollOffset(
        draftConnectionId,
        draftThreadId,
        offset,
        historyAnchor.turnId,
        historyAnchor.viewportOffsetPx,
      ).catch(() => undefined);
    }, 250);
  };

  const persistTimelineAtEnd = () => {
    scrollOffsetRef.current = 0;
    sessionConversationHistoryAnchors.delete(composerScope);
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (saveScrollOffset !== undefined && draftConnectionId !== null && draftThreadId !== null) {
      scrollSaveTimerRef.current = setTimeout(() => {
        scrollSaveTimerRef.current = null;
        void saveScrollOffset(draftConnectionId, draftThreadId, 0, null, null).catch(
          () => undefined,
        );
      }, 250);
    }
    awayFromLatestRef.current = false;
    setAwayFromLatest(false);
    if (latestUnreadReceiptKey !== null) acknowledgeUnreadReceipt(latestUnreadReceiptKey);
  };

  const [pendingLatestJump, setPendingLatestJump] = useConversationState<{
    sourceSearchWindow: SearchConversationWindow | null;
  } | null>(composerScope, () => null);
  const mayFinishLatestJump = useEvent(
    (source: SearchConversationWindow | null) => searchWindow === null || searchWindow === source,
  );
  const completeLatestJump = () => {
    if (pendingLatestJump === null) return;
    if (!mayFinishLatestJump(pendingLatestJump.sourceSearchWindow)) {
      setPendingLatestJump(null);
      return;
    }
    if (searchWindow !== null || !timelineModelReady || !historyViewport.containsLatest) return;
    setPendingLatestJump(null);
    requestAnimationFrame(() => {
      if (
        !conversationOwner.isCurrent() ||
        fullscreenScrollOwnership.isCovered() ||
        !mayFinishLatestJump(pendingLatestJump.sourceSearchWindow)
      )
        return;
      void timelineRef.current?.scrollToEnd({ animated: false });
    });
  };
  const jumpTimelineToLatest = () => {
    const sourceSearchWindow = searchWindow;
    void historyViewport.loadLatest().then(() => {
      if (!conversationOwner.isCurrent() || !mayFinishLatestJump(sourceSearchWindow)) return;
      setPendingLatestJump({ sourceSearchWindow });
    }).catch(() => undefined);
  };

  const clearTimelineRuntime = () => {
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (timelineIndexRetryTimerRef.current !== null)
      clearTimeout(timelineIndexRetryTimerRef.current);
    if (unreadVisibilityFrameRef.current !== null)
      cancelAnimationFrame(unreadVisibilityFrameRef.current);
    scrollSaveTimerRef.current = null;
    timelineIndexRetryTimerRef.current = null;
    unreadVisibilityFrameRef.current = null;
    latestUnreadAgentRef.current = null;
  };
  const cleanUpTimeline = () => {
    clearTimelineRuntime();
    const current = mountedConversationScopeRef.current;
    if (
      current.saveScrollOffset !== undefined &&
      current.connectionId !== null &&
      current.threadId !== null
    ) {
      const savedAnchor = sessionConversationHistoryAnchors.get(current.scope);
      const historyAnchor = {
        turnId: savedAnchor?.turnId ?? null,
        viewportOffsetPx: savedAnchor?.viewportOffsetPx ?? null,
      };
      void current
        .saveScrollOffset(
          current.connectionId,
          current.threadId,
          scrollOffsetRef.current,
          historyAnchor.turnId,
          historyAnchor.viewportOffsetPx,
        )
        .catch(() => undefined);
    }
    fullscreenOverlay.dismissScope(current.scope);
  };
  const closeInlineQueueOverlay = () => setInlineQueueExpanded(false);
  const toggleInlineQueueOverlay = () => {
    if (inlineQueueExpanded) {
      closeInlineQueueOverlay();
      return;
    }
    if (visibleQueuedPrompts.length === 0) return;
    setMenuVisible(false);
    setInlineQueueExpanded(true);
  };
  const handleAndroidBack = useEvent(() => {
    if (inlineQueueExpanded) {
      closeInlineQueueOverlay();
      return;
    }
    onBack?.();
  });
  const androidBackEnabled =
    Platform.OS === "android" && (inlineQueueExpanded || (compact && onBack !== undefined));
  useAndroidBackHandler(androidBackEnabled, handleAndroidBack);

  const composerSeedTaskKey =
    !composerStateMissing ||
    loadDraft === undefined ||
    draftConnectionId === null ||
    draftThreadId === null
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
    composerMarkdownRef.current = text;
    if (queuedComposerEdit !== null) {
      setQueuedComposerEdit((current) => (current === null ? null : { ...current, text }));
      return;
    }
    if (saveDraft === undefined || draftConnectionId === null || draftThreadId === null) return;
    void saveDraft(draftConnectionId, draftThreadId, text).catch(() => undefined);
  };

  const persistAttachments = async (next: ComposerAttachment[]): Promise<void> => {
    latestAttachmentsRef.current.latest = next;
    if (saveDraftAttachments === undefined || draftConnectionId === null || draftThreadId === null)
      return;
    await saveDraftAttachments(draftConnectionId, draftThreadId, next);
  };
  const updateAttachments = (next: ComposerAttachment[]) => {
    if (queuedComposerEdit !== null) {
      latestAttachmentsRef.current.latest = next;
      setQueuedComposerEdit((current) =>
        current === null ? null : { ...current, attachments: next },
      );
      return;
    }
    void persistAttachments(next).catch(() => undefined);
  };
  const clearQueuedComposerUploads = (scope: string) => {
    for (const upload of composerUploads.entries(scope))
      composerUploads.remove(scope, upload.attachment.id);
  };
  const cancelQueuedComposerEdit = () => {
    if (queuedComposerEdit === null) return;
    clearQueuedComposerUploads(composerUploadScope);
    setQueuedComposerEdit(null);
    setQueuedComposerEditBusy(false);
    setQueuedComposerEditError(null);
    draftSelectionRef.current = { start: 0, end: 0 };
  };
  const beginQueuedComposerEdit = (item: QueuedPrompt) => {
    if (queuedComposerEditBusy || voicePhase !== "idle" || item.state !== "queued") return;
    if (queuedComposerEdit !== null) clearQueuedComposerUploads(composerUploadScope);
    closeInlineQueueOverlay();
    setQueuedComposerEdit({
      commandId: item.commandId,
      text: item.text,
      attachments: item.attachments,
    });
    setQueuedComposerEditError(null);
    setMenuVisible(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };
  const saveQueuedComposerEdit = () => {
    const edit = queuedComposerEdit;
    if (edit === null || onEditQueued === undefined || queuedComposerEditBusy || uploadsBlockSend)
      return;
    const text = markdownForComposerSubmission(composerMarkdownRef.current).trim();
    const editedAttachments = composerUploads.readyAttachments(
      composerUploadScope,
      latestAttachmentsRef.current.latest,
    );
    if (text === "" && editedAttachments.length === 0) return;
    const editScope = composerUploadScope;
    setQueuedComposerEditBusy(true);
    setQueuedComposerEditError(null);
    void onEditQueued(edit.commandId, text, editedAttachments).then(
      () => {
        if (conversationOwner.isCurrent()) {
          clearQueuedComposerUploads(editScope);
          setQueuedComposerEdit(null);
          setQueuedComposerEditBusy(false);
          draftSelectionRef.current = { start: 0, end: 0 };
          if (onListQueue !== undefined) void onListQueue().catch(() => undefined);
        }
      },
      (cause: unknown) => {
        if (!conversationOwner.isCurrent()) return;
        setQueuedComposerEditError(
          cause instanceof Error ? cause.message : "Could not update queued message",
        );
        setQueuedComposerEditBusy(false);
      },
    );
  };

  const insertSkillInvocation = (skill: { name: string; path: string }) => {
    const selected = latestComposerPreferencesRef.current.latest.skillPaths;
    if (!selected.includes(skill.path)) {
      updateComposerPreferences((current) => ({
        ...current,
        skillPaths: [...current.skillPaths, skill.path],
      }));
    }
    const editor = composerInputRef.current;
    if (editor !== null) {
      editor.focus();
      editor.insertLinkedText(`$${skill.name}`, composerSkillUrl(skill.path));
      editor.insertText(" ");
      setMenuVisible(false);
      return;
    }
    const selection = draftSelectionRef.current;
    const invocation = `$${skill.name} `;
    const current = draft;
    const next = `${current.slice(0, selection.start)}${invocation}${current.slice(selection.end)}`;
    const cursor = selection.start + invocation.length;
    updateDraft(next);
    draftSelectionRef.current = { start: cursor, end: cursor };
    voiceController?.setPendingSelection(composerScope, { start: cursor, end: cursor });
    setMenuVisible(false);
  };

  const send = (textOverride?: string, preference: ComposerSendPreference = "start") => {
    if (
      queuedComposerEdit !== null ||
      pastedAttachmentPendingRef.current ||
      composerUploads.blocksSend(composerUploadScope)
    )
      return;
    // Voice completion passes its final draft explicitly. Reading `draft`
    // here would use the render captured when recording started and can send
    // the pre-transcription text instead of the latest transcript.
    const text = (
      textOverride ?? markdownForComposerSubmission(composerMarkdownRef.current)
    ).trim();
    const sentAttachments = composerUploads.readyAttachments(
      composerUploadScope,
      latestAttachmentsRef.current.latest,
    );
    if ((!text && sentAttachments.length === 0) || onSend === undefined) return;
    const scope = composerScope;
    const sentContentReviewAttachmentId = contentReviewAttachmentId;
    // Delivery mode is a one-shot command for this draft. Normal Send uses the
    // durable queue while a turn is active and starts immediately when idle;
    // opening the long-press menu must never mutate a persisted default.
    const mode: SendMode = resolveComposerSendMode(
      preference,
      threadLifecycleActive,
      currentTurnId,
    );
    const currentControls = currentControlsResource()?.value ?? EMPTY_TURN_CONTROLS;
    const selectedSkillPaths = latestComposerPreferencesRef.current.latest.skillPaths;
    const plainDraft = latestDraftRef.current.latest;
    const skills = currentControls.skills
      .filter(
        (skill) =>
          selectedSkillPaths.includes(skill.path) &&
          containsSkillInvocation(plainDraft, skill.name),
      )
      .map(({ name, path }) => ({ name, path }));
    const restoreSentSkillPaths = () => {
      if (selectedSkillPaths.length === 0) return;
      updateComposerPreferences((current) => {
        const missing = selectedSkillPaths.filter((path) => !current.skillPaths.includes(path));
        return missing.length === 0
          ? current
          : { ...current, skillPaths: [...current.skillPaths, ...missing] };
      });
    };
    const operation = onSend(text, mode, {
      ...(selectedModel === null ? {} : { model: selectedModel }),
      ...(selectedEffort === null ? {} : { effort: selectedEffort }),
      ...(selectedPersonality === null ? {} : { personality: selectedPersonality }),
      ...(selectedPermissions === null ? {} : { permissions: selectedPermissions }),
      ...(skills.length === 0 ? {} : { skills }),
      ...(sentAttachments.length === 0
        ? {}
        : { attachments: sentAttachments.map(remoteAttachment) }),
    });
    updateDraft("");
    updateAttachments([]);
    if (selectedSkillPaths.length > 0)
      updateComposerPreferences((current) => ({ ...current, skillPaths: [] }));
    for (const attachment of sentAttachments)
      composerUploads.remove(composerUploadScope, attachment.id);
    // Do not move or replace the resident history window here. The delivery is
    // already a row in the model-owned timeline. LegendList MVCP remains the
    // only position owner; calling loadLatest or scrollToEnd from Send can
    // replace the range underneath an already measured list.
    void operation
      .then(() => {
        if (sentContentReviewAttachmentId !== null)
          clearContentReviewAttachmentId(scope, sentContentReviewAttachmentId);
        if (mode.type === "queue" && onListQueue !== undefined) {
          void onListQueue().catch(() => undefined);
        }
      })
      .catch(() => {
        // Native persistence failed before Kotlin accepted ownership. Restore
        // the composer; successful submissions are rendered exclusively from
        // the Legend delivery/queue projection.
        if (conversationOwner.isCurrent()) {
          restoreSentSkillPaths();
          const recoveredDraft = mergeFailedComposerText(latestDraftRef.current.latest, text);
          if (recoveredDraft !== latestDraftRef.current.latest) updateDraft(recoveredDraft);
          const recoveredAttachments = mergeFailedComposerAttachments(
            latestAttachmentsRef.current.latest,
            sentAttachments,
          );
          if (recoveredAttachments !== latestAttachmentsRef.current.latest)
            updateAttachments(recoveredAttachments);
          return;
        }
        if (conversationOwner.hasReplacement()) return;
        // The user already navigated away. Restore the failed submission in its
        // owning thread without mutating the newly selected composer's local UI.
        const recoveredDraft = mergeFailedComposerText(latestDraftRef.current.latest, text);
        latestDraftRef.current.latest = recoveredDraft;
        restoreSentSkillPaths();
        if (saveDraft !== undefined && draftConnectionId !== null && draftThreadId !== null) {
          void saveDraft(draftConnectionId, draftThreadId, recoveredDraft).catch(() => undefined);
        }
        const recoveredAttachments = mergeFailedComposerAttachments(
          latestAttachmentsRef.current.latest,
          sentAttachments,
        );
        latestAttachmentsRef.current.latest = recoveredAttachments;
        if (
          saveDraftAttachments !== undefined &&
          draftConnectionId !== null &&
          draftThreadId !== null
        ) {
          void saveDraftAttachments(draftConnectionId, draftThreadId, recoveredAttachments).catch(
            () => undefined,
          );
        }
      });
  };

  const openControls = (initialPage: ComposerMenuPage) => {
    closeInlineQueueOverlay();
    setComposerTrayVisible(false);
    dismissComposerKeyboardForOverlay();
    setMenuInitialPage(initialPage);
    setMenuVisible(true);
    // A failed/background prefetch may be retried, but an already loaded sheet
    // never refetches its model, skill and permission lists.
    const current = currentControlsResource();
    if (initialPage !== "ports" && (current === null || current.status === "error"))
      requestControls();
  };
  const closeControls = () => {
    setMenuVisible(false);
  };
  const openQuickControlMenu = (scope: "model-menu" | "permissions-menu") => {
    setComposerTrayVisible(false);
    dismissComposerKeyboardForOverlay();
    const current = currentControlsResource();
    if (current === null || current.status === "error") requestControls();
  };
  const closeQuickControlMenu = (_scope: "model-menu" | "permissions-menu") => undefined;
  const openProjectPicker = () => {
    if (onChangeProject === undefined) return;
    dismissComposerKeyboardForOverlay();
    setProjectChangeError(null);
    setProjectPickerVisible(true);
  };
  const closeProjectPicker = () => {
    setProjectPickerVisible(false);
  };
  const selectProject = async (nextCwd: string | null) => {
    if (onChangeProject === undefined || projectChangeBusy) return;
    setProjectChangeBusy(true);
    setProjectChangeError(null);
    const cause = await onChangeProject(nextCwd).then(
      () => null,
      (error: unknown) => error,
    );
    if (!conversationOwner.isCurrent()) return;
    setProjectChangeBusy(false);
    if (cause === null) {
      closeProjectPicker();
    } else {
      setProjectChangeError(cause instanceof Error ? cause.message : "Could not change project");
    }
  };
  const openThreadRename = () => {
    setThreadRenameVisible(true);
  };
  const closeThreadRename = () => {
    setThreadRenameVisible(false);
  };
  const [subagentEventProjection] = useConversationState(
    composerScope,
    () => new SubagentListProjection(),
  );
  const currentSubagentSummaries = (): readonly StoredThreadSummary[] => {
    if (subagentSummaryDatabase === null || draftConnectionId === null || draftThreadId === null)
      return [];
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
  const openSubagents = useEvent(
    (summaries: readonly StoredThreadSummary[], initialThreadId: string | null = null) => {
      if (draftConnectionId === null || draftThreadId === null || subagentThreadDetails === null)
        return;
      // Opening the sheet is the user event that starts the background catalog
      // refresh. The sheet itself only reads Legend-owned resources.
      void onRefreshSubagents?.(draftThreadId).catch(() => {
        // Retain the complete local subagent list when the server is unavailable.
      });
      fullscreenOverlay.present(
        ({ close }) => (
          <SubagentSheet
            connectionId={draftConnectionId}
            parentThreadId={draftThreadId}
            parentThread={remoteThread ?? null}
            summaries={summaries}
            threadDetails={subagentThreadDetails}
            initialThreadId={initialThreadId}
            renderThread={({
              summary,
              thread: subagentThread,
              compact: subagentCompact,
              onBack: onBackToSubagents,
              onOpenSubagent,
            }) => (
              <ConversationPane
                key={`${draftConnectionId}:${subagentThread.id}`}
                thread={subagentThreadListItem(summary, subagentThread, draftConnectionId)}
                server={server}
                compact={subagentCompact}
                readOnly
                {...(onBackToSubagents === undefined ? {} : { onBack: onBackToSubagents })}
                remoteThread={subagentThread}
                remoteSealedTurns={subagentThread.turns.filter(
                  (turn) => turn.status !== "inProgress",
                )}
                remoteLiveTurns={subagentThread.turns.filter(
                  (turn) => turn.status === "inProgress",
                )}
                cwd={subagentThread.cwd}
                subagentSummaryDatabase={subagentSummaryDatabase}
                subagentThreadDetails={subagentThreadDetails}
                onOpenSubagentThread={onOpenSubagent}
                {...(onRefreshSubagents === undefined ? {} : { onRefreshSubagents })}
                {...(onLoadTurnChanges === undefined ? {} : { onLoadTurnChanges })}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined
                  ? {}
                  : { onFixUnsupportedBlock: fixUnsupportedBlock })}
              />
            )}
            onClose={close}
          />
        ),
        { dismissOnScopeUnmount: false },
      );
    },
  );
  const presentTerminal = () => {
    if (draftConnectionId === null || draftThreadId === null) return;
    fullscreenOverlay.present(
      ({ close }) => (
        <TerminalWorkspace
          connectionId={draftConnectionId}
          threadId={draftThreadId}
          cwd={cwd ?? null}
          onMinimize={close}
        />
      ),
      { dismissOnScopeUnmount: false },
    );
  };
  const openTerminal = () => {
    if (draftConnectionId === null || draftThreadId === null) return;
    if (
      Platform.OS === "android" &&
      readInteractiveTerminalWorkspace(draftConnectionId, draftThreadId).tabs.length === 0
    ) {
      createInteractiveTerminalTab({
        connectionId: draftConnectionId,
        threadId: draftThreadId,
        cwd: cwd ?? null,
      });
    }
    presentTerminal();
  };
  const createAndOpenTerminal = () => {
    if (draftConnectionId === null || draftThreadId === null) return;
    if (Platform.OS === "android") {
      createInteractiveTerminalTab({
        connectionId: draftConnectionId,
        threadId: draftThreadId,
        cwd: cwd ?? null,
      });
    }
    presentTerminal();
  };
  const deleteThread =
    onDelete === undefined
      ? undefined
      : async () => {
          await onDelete();
          if (draftConnectionId !== null && draftThreadId !== null) {
            closeInteractiveTerminalWorkspace(draftConnectionId, draftThreadId);
          }
        };
  const fileAttachmentEnabled =
    fileTransferController !== null &&
    getTransferAccess !== undefined &&
    draftThreadId !== null &&
    attachmentCount < MAX_TURN_ATTACHMENTS;
  const stageAttachment = (
    selected: SelectedUpload,
    existing: ComposerAttachment | null = null,
    editor?: ComposerAttachment["editor"],
  ): boolean => {
    if (
      draftConnectionId === null ||
      draftThreadId === null ||
      getTransferAccess === undefined ||
      (queuedComposerEdit === null && upsertDraftAttachment === undefined)
    )
      return false;
    if (
      existing === null &&
      composerUploads.count(composerUploadScope, latestAttachmentsRef.current.latest) >=
        MAX_TURN_ATTACHMENTS
    ) {
      dialog.alert(
        "Too many attachments",
        `A message can contain at most ${MAX_TURN_ATTACHMENTS} attachments.`,
      );
      return false;
    }
    const path = existing?.path ?? attachmentUploadPath(draftThreadId, selected.name);
    const attachment: ComposerAttachment = {
      id: existing?.id ?? randomUUID(),
      rootId: existing?.rootId ?? ATTACHMENT_ROOT_ID,
      path,
      name: selected.name,
      kind: fileMediaKind(selected.name, selected.mimeType) ?? "file",
      ...(editor === undefined ? {} : { editor }),
    };
    composerUploads.stage({
      scope: composerUploadScope,
      attachment,
      preview: {
        uri: selectedUploadUri(selected),
        text: null,
        bytes: selected.size,
        mimeType: selected.mimeType,
      },
      start: (progress) =>
        startUpload(
          getTransferAccess,
          selected,
          attachment.rootId,
          path,
          existing !== null,
          progress,
        ),
      readText: () => selectedUploadText(selected),
      commit: async (ready, isCurrent) => {
        if (queuedComposerEdit !== null) {
          if (isCurrent())
            updateAttachments([
              ...latestAttachmentsRef.current.latest.filter(
                (candidate) => candidate.id !== ready.id,
              ),
              ready,
            ]);
          return;
        }
        await upsertDraftAttachment?.(draftConnectionId, draftThreadId, ready, isCurrent);
      },
    });
    return true;
  };
  const uploadSelectedAttachment = async (
    selected: SelectedUpload,
    onUploaded?: (attachment: ComposerAttachment) => void,
    offerRetry = true,
  ): Promise<ComposerAttachment | null> => {
    if (
      fileTransferController === null ||
      getTransferAccess === undefined ||
      draftThreadId === null
    )
      return null;
    let uploaded: ComposerAttachment | null = null;
    const commitUploaded =
      onUploaded ??
      ((attachment: ComposerAttachment) => {
        updateAttachments([
          ...latestAttachmentsRef.current.latest.filter(
            (candidate) => candidate.id !== attachment.id,
          ),
          attachment,
        ]);
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
    return (await uploadSelectedAttachment(selected)) !== null;
  };
  const commitDrawing = async (
    existing: ComposerAttachment | null,
    mode: "drawing" | "image-annotation",
    name: string | null,
    value: DrawingCommit,
  ): Promise<boolean> => {
    if (
      fileTransferController === null ||
      getTransferAccess === undefined ||
      draftThreadId === null
    )
      return false;
    const selected = createBinaryUpload(
      name ?? existing?.name ?? quickdrawAttachmentName(),
      "image/png",
      quickdrawPngBytes(value.pngDataUrl),
    );
    // PNG annotation of a JPEG gets a PNG destination, but keeps the draft card identity.
    const replacement =
      existing !== null && existing.name !== selected.name
        ? {
            ...existing,
            name: selected.name,
            rootId: ATTACHMENT_ROOT_ID,
            path: attachmentUploadPath(draftThreadId, selected.name),
          }
        : existing;
    return stageAttachment(selected, replacement, {
      kind: "quickdraw",
      mode,
      snapshot: value.snapshot,
      revision: Date.now(),
    });
  };
  const presentDrawing = ({
    attachment,
    initialSnapshot,
    mode,
    name = null,
    onAttached,
  }: {
    attachment: ComposerAttachment | null;
    initialSnapshot: Record<string, unknown> | null;
    mode: "drawing" | "image-annotation";
    name?: string | null;
    onAttached?(): void;
  }) => {
    fullscreenOverlay.present(({ close }) => (
      <DrawingWorkspace
        editing={attachment !== null}
        initialSnapshot={initialSnapshot}
        mode={mode}
        onCommit={async (value) => {
          const committed = await commitDrawing(attachment, mode, name, value);
          if (committed) onAttached?.();
          return committed;
        }}
        onClose={close}
      />
    ));
  };
  const openDrawing = () => {
    if (!fileAttachmentEnabled) return;
    setComposerTrayVisible(false);
    presentDrawing({ attachment: null, initialSnapshot: null, mode: "drawing" });
  };
  const annotateImage = async (item: ImagePreviewItem, onAttached: () => void): Promise<void> => {
    const uploading = composerUploads
      .entries(composerUploadScope)
      .find((entry) => entry.attachment.id === item.draft?.attachmentId);
    const attachment =
      item.draft === undefined
        ? null
        : imageAnnotationAttachment(
            item.draft,
            composerScope,
            uploading === undefined ? latestAttachmentsRef.current.latest : [uploading.attachment],
          );
    if (
      fileTransferController === null ||
      getTransferAccess === undefined ||
      draftThreadId === null ||
      (attachment === null && !fileAttachmentEnabled)
    )
      throw new Error("File attachments are unavailable");
    const editor =
      attachment !== null && isQuickdrawDraftAttachment(attachment) ? attachment.editor : null;
    const snapshot = editor?.snapshot ?? (await loadQuickdrawImageSnapshot(item.source));
    presentDrawing({
      attachment,
      initialSnapshot: snapshot,
      mode: editor?.mode ?? "image-annotation",
      name: editor === null ? annotatedImageName(item.label) : (attachment?.name ?? null),
      onAttached,
    });
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
        ...current.filter(
          (candidate) => candidate.id !== previousAttachmentId && candidate.id !== attachment.id,
        ),
        attachment,
      ]);
      setContentReviewAttachmentId(scope, attachment.id);
    }).then((attachment) => attachment?.id ?? null);
  };
  useImagePreviewAnnotationHandler(annotateImage);
  useContentReviewRuntime({
    attach: attachContentReview,
    attachmentId: contentReviewAttachmentId,
    thread: remoteThread ?? null,
    voiceScope: `${composerScope}\u0000review`,
    resources: appVoiceInputRuntime.resources,
    voiceController,
    ...(onStartVoiceTranscription === undefined ? {} : { startVoice: onStartVoiceTranscription }),
  });
  const presentTurnChanges = useEvent(
    (target: TurnChangesTarget, knownFiles: readonly TurnChangedFile[]) => {
      dismissComposerKeyboardForOverlay();
      let filesPromise: Promise<readonly TurnChangedFile[]>;
      if (knownFiles.length > 0) filesPromise = Promise.resolve(knownFiles);
      else {
        if (onLoadTurnChanges === undefined) {
          dialog.alert("Changes unavailable", "This turn has no recorded file patches.");
          return;
        }
        filesPromise = onLoadTurnChanges(target);
      }
      const loadFiles = async () => {
        const files = await filesPromise;
        if (files.length === 0) throw new Error("This turn has no recorded file patches.");
        return files;
      };
      fullscreenOverlay.present(({ close }) => (
        <CodeReviewWorkspace
          changes={recordedTurnChangeResources(target, knownFiles)}
          changeScope="lastTurn"
          changeScopes={[]}
          scopeLabel="This turn"
          initialMode="unified"
          initialWrapLines={changesPreferences.wrapLines}
          cwd={cwd}
          thread={remoteThread ?? null}
          voiceRuntime={appVoiceInputRuntime}
          getTransferAccess={getStableTransferAccess}
          onLoadDiff={async (path) => recordedTurnChangeDiff(target, await loadFiles(), path)}
          onAttach={attachCodeReview}
          onClose={close}
          {...(knownFiles.length > 0
            ? {}
            : {
                onInitialLoad: async () => recordedTurnResourcesValue(target, await loadFiles()),
              })}
        />
      ));
    },
  );
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
        {...(!refreshOnOpen || onLoadThreadResources === undefined
          ? {}
          : {
              onInitialLoad: () =>
                onLoadThreadResources(changesPreferences.scope ?? undefined, "changes"),
            })}
        {...(onLoadThreadResources === undefined
          ? {}
          : { onLoadScope: (scope: ThreadChangeScope) => onLoadThreadResources(scope, "changes") })}
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
        {...(request.source === undefined
          ? {}
          : { sourceAssets: { [request.path]: request.source } })}
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
        {...(onLoadThreadChangeDiff === undefined
          ? {}
          : { onLoadDiff: (path: string) => onLoadThreadChangeDiff(path, resource?.changeScope) })}
      />
    ));
  });
  const pickComposerAttachment = async () => {
    setComposerTrayVisible(false);
    if (!fileAttachmentEnabled) return;
    dismissComposerKeyboardForOverlay();
    const selected = await pickUploadFile().catch((cause): null => {
      dialog.alert(
        "Could not choose file",
        cause instanceof Error ? cause.message : "System file picker failed",
      );
      return null;
    });
    if (selected !== null) stageAttachment(selected);
  };
  const clearLargePasteOperation = (
    operation: NonNullable<typeof largePasteOperationRef.current>,
  ) => {
    if (largePasteOperationRef.current !== operation) return;
    largePasteOperationRef.current = null;
    pastedAttachmentPendingRef.current = false;
    setPastedAttachmentPending(false);
  };
  const flushLargePasteCapture = async (
    operation: NonNullable<typeof largePasteOperationRef.current>,
  ) => {
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
      dialog.alert(
        "Could not attach pasted text",
        cause instanceof Error ? cause.message : "Could not create the text attachment",
      );
      return;
    }

    if (stageAttachment(selected)) {
      updateDraft(projection.draftText);
      draftSelectionRef.current = {
        start: projection.insertionOffset,
        end: projection.insertionOffset,
      };
      voiceController?.setPendingSelection(composerScope, draftSelectionRef.current);
    } else {
      updateDraft(projection.pastedDraftText);
    }
    clearLargePasteOperation(operation);
  };
  const handleComposerTextChange = (nextText: string) => {
    updateDraft(nextText);
    const currentSkills = currentControlsResource()?.value?.skills;
    const selected = latestComposerPreferencesRef.current.latest.skillPaths;
    if (currentSkills === undefined || selected.length === 0) return;
    const next = selected.filter((path) => {
      const skill = currentSkills.find((candidate) => candidate.path === path);
      return skill !== undefined && containsSkillInvocation(nextText, skill.name);
    });
    if (next.length !== selected.length)
      updateComposerPreferences((current) => ({ ...current, skillPaths: next }));
  };
  const handleComposerMarkdownChange = (markdown: string) => {
    composerMarkdownRef.current = markdown;
  };
  const searchComposerSuggestions = useEvent(
    async (query: { readonly indicator: "/" | "@"; readonly text: string }) => {
      if (query.indicator !== "/") return [];
      const current = currentControlsResource();
      const value =
        current?.value ?? (onLoadControls === undefined ? null : await onLoadControls(cwd));
      return value === null ? [] : composerSkillSuggestions(value.skills, query.text);
    },
  );
  const selectComposerMention = useEvent((mention: ComposerMention) => {
    if (mention.kind !== "skill") return;
    const selected = latestComposerPreferencesRef.current.latest.skillPaths;
    if (!selected.includes(mention.path)) {
      updateComposerPreferences((current) => ({
        ...current,
        skillPaths: [...current.skillPaths, mention.path],
      }));
    }
  });
  const handleComposerLargePaste = (event: LargePasteEvent) => {
    if (largePasteOperationRef.current?.scope === composerScope) return;
    const capture = captureClipboardLargePaste(latestDraftRef.current.latest, event.text, {
      start: event.start,
      end: event.end,
    });
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
  useConversationCleanup(composerScope, () => {
    if (paginationTrimTimerRef.current !== null) clearTimeout(paginationTrimTimerRef.current);
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
    if (action === "drawing") {
      openDrawing();
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
  const openGoalDetails = useEvent(() => openAccessoryAction("goal"));
  const useAnchoredComposerMenu = Platform.OS === "android";
  const anchoredComposerActions: ActionMenuItem[] = [
    { id: "files", label: "Attach file", icon: "attach-outline", disabled: !fileAttachmentEnabled },
    { id: "drawing", label: "Drawing", icon: "brush-outline", disabled: !fileAttachmentEnabled },
    {
      id: "terminal",
      label: "Terminal",
      icon: "terminal-outline",
      disabled:
        newChat ||
        Platform.OS !== "android" ||
        draftConnectionId === null ||
        draftThreadId === null,
    },
    {
      id: "ports",
      label: "Port forward",
      icon: "git-network-outline",
      disabled: portForwardingConnectionId === null,
    },
    { id: "skills", label: "Skills", icon: "sparkles-outline" },
    { id: "goal", label: "Goal", icon: "flag-outline" },
  ];
  const handleAnchoredComposerAction = (id: string) => {
    if (
      id === "files" ||
      id === "drawing" ||
      id === "terminal" ||
      id === "ports" ||
      id === "skills" ||
      id === "goal"
    ) {
      openAccessoryAction(id);
    }
  };
  const deliveryActions: ActionMenuItem[] = [
    { id: "start", label: "Send now", icon: "send-outline", disabled: threadLifecycleActive },
    {
      id: "queue",
      label: "Queue after current turn",
      icon: "time-outline",
      disabled: !threadLifecycleActive,
    },
    {
      id: "steer",
      label: "Steer active turn",
      icon: "navigate-outline",
      disabled: currentTurnId === null,
    },
  ];
  const handleDeliveryAction = (id: string) => {
    if (queuedComposerEdit !== null || (id !== "start" && id !== "queue" && id !== "steer")) return;
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
      if (
        (ownsModel || ownsEffort) &&
        (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())
      ) {
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
        setSelectedEffort((current) => (current === effort ? previous : current));
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(
          cause instanceof Error ? cause.message : "Could not update thinking effort",
        );
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
        setSelectedPermissions((current) => (current === permissions ? previous : current));
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

  const microphoneAccess = useMicrophoneAccess();
  const finishVoice = async (sendAfter: boolean, preference: ComposerSendPreference = "start") => {
    await voiceController?.finish(composerScope, sendAfter, (text) => send(text, preference));
  };
  const retryVoice = async () => {
    bindVoiceController();
    await voiceController?.retry(composerScope);
  };
  const toggleVoice = async () => {
    if (!microphoneAccess.allowCapture()) return;
    bindVoiceController();
    await voiceController?.toggle(composerScope);
  };
  const discardVoice = async () => {
    await voiceController?.discard(composerScope);
  };
  const clearComposerText = () => {
    draftSelectionRef.current = { start: 0, end: 0 };
    voiceController?.clearPendingSelection(composerScope);
    updateDraft("");
  };

  if (thread === null) {
    return (
      <View style={styles.emptyConversation}>
        <Ionicons name="chatbubbles-outline" size={iconSize.illustration} color={colors.textDim} />
        <Text style={styles.emptyText}>Select a thread</Text>
      </View>
    );
  }

  const editingQueuedMessage = queuedComposerEdit !== null;
  const stoppingResponse =
    !editingQueuedMessage &&
    currentTurnId !== null &&
    voicePhase === "idle" &&
    draft.trim() === "" &&
    attachments.length === 0;
  const sendDisabled =
    voicePhase === "finishing" ||
    queuedComposerEditBusy ||
    (editingQueuedMessage && onEditQueued === undefined) ||
    pastedAttachmentPending ||
    uploadsBlockSend ||
    (voicePhase === "idle" && !stoppingResponse && draft.trim() === "" && attachments.length === 0);
  const composerDiscardEnabled =
    editingQueuedMessage ||
    voicePhase !== "idle" ||
    voiceRetryAvailable ||
    voiceError !== null ||
    draft !== "";
  const discardComposer = () => {
    if (editingQueuedMessage) cancelQueuedComposerEdit();
    else if (voicePhase !== "idle" || voiceRetryAvailable || voiceError !== null)
      void discardVoice();
    else clearComposerText();
  };
  const activatePrimaryAction = () => {
    if (editingQueuedMessage) void saveQueuedComposerEdit();
    else if (voicePhase !== "idle") void finishVoice(true);
    else if (
      currentTurnId !== null &&
      onInterrupt !== undefined &&
      draft.trim() === "" &&
      attachments.length === 0
    )
      void onInterrupt(currentTurnId);
    else send();
  };
  const steerComposer = () => {
    if (editingQueuedMessage || sendDisabled || currentTurnId === null || !threadLifecycleActive)
      return;
    handleDeliveryAction("steer");
  };
  return (
    <AppVoiceInputProvider runtime={appVoiceInputRuntime}>
      <AppFullscreenOverlayBoundary scope={composerScope} lifecycle={fullscreenOverlayLifecycle}>
        <SubagentNavigationContext.Provider
          value={
            onOpenSubagentThread ??
            (draftConnectionId !== null && draftThreadId !== null && subagentThreadDetails !== null
              ? (threadId) => openSubagents(currentSubagentSummaries(), threadId)
              : null)
          }
        >
          <LargeContentViewerHost>
            <View
              testID="thread-detail-pane-shell"
              style={[styles.conversation, compact ? undefined : styles.conversationRaised]}
              onLayout={({ nativeEvent }) => {
                const paneWidth = Math.max(0, Math.floor(nativeEvent.layout.width));
                const paneHeight = Math.max(0, Math.floor(nativeEvent.layout.height));
                setConversationPaneHeight((current) =>
                  current === paneHeight ? current : paneHeight,
                );
                const next = paneWidth < 520;
                setNarrowConversationPane((current) => (current === next ? current : next));
              }}
            >
              <View testID="thread-detail-pane" style={styles.conversationKeyboard}>
                <View pointerEvents="box-none" style={styles.conversationHeaderChrome}>
                  <View testID="conversation-header" style={styles.conversationHeader}>
                    {compact && (
                      <Pressable
                        onPress={onBack}
                        style={styles.headerIcon}
                        accessibilityLabel="Back to threads"
                      >
                        <Ionicons
                          name="arrow-back"
                          size={iconSize.navigation}
                          color={colors.text}
                        />
                      </Pressable>
                    )}
                    <View
                      style={[
                        styles.conversationIdentity,
                        !compact && styles.conversationIdentityRaised,
                      ]}
                    >
                      <View style={styles.conversationTitleRow}>
                        {leadingEmoji(thread.title) !== null && (
                          <InlineEmoji value={leadingEmoji(thread.title) ?? ""} role="title" />
                        )}
                        <Text
                          testID="conversation-title"
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={[styles.conversationTitle, styles.conversationHeaderTitle]}
                        >
                          {thread.title.slice(leadingEmoji(thread.title)?.length ?? 0).trimStart()}
                        </Text>
                        <ConversationBackendRefreshIndicator
                          model={threadChatModel}
                          connectionId={draftConnectionId}
                          threadId={draftThreadId}
                        />
                      </View>
                      <ConversationHistorySubtitle
                        model={historyActivityModel}
                        resourceId={historyActivityResourceId}
                        server={server}
                        cwd={cwd}
                      />
                    </View>
                    {!newChat && (
                      <Pressable
                        onPress={() => {
                          if (threadSearchVisible) closeThreadSearch();
                          else setThreadSearchVisible(true);
                        }}
                        style={styles.headerIcon}
                        accessibilityLabel="Search in thread"
                      >
                        <Ionicons name="search" size={iconSize.action} color={colors.text} />
                      </Pressable>
                    )}
                    {!newChat && (
                      <WorkspaceAccountUsagePopover
                        thread={remoteThread ?? null}
                        currentUsage={currentUsage}
                        compactionCount={sessionCompactionCount}
                        database={accountRateLimitsDatabase}
                        servers={[
                          {
                            id: server?.id ?? "active-server",
                            name: server?.name ?? "Server",
                          },
                        ]}
                        placement="bottom"
                        align="end"
                        {...(onRefreshAccountRateLimits === undefined
                          ? {}
                          : { onRefresh: onRefreshAccountRateLimits })}
                      >
                        <Pressable
                          accessibilityLabel="Context usage and account limits"
                          style={styles.headerIcon}
                        >
                          <ContextRing
                            percent={contextUsageFromProjection(currentUsage)?.usedPercent ?? 0}
                            size={iconSize.action}
                          />
                        </Pressable>
                      </WorkspaceAccountUsagePopover>
                    )}
                    {!readOnly && !newChat && (
                      <ThreadHeaderMenu
                        key={thread.id}
                        threadId={thread.id}
                        archived={archived}
                        pinned={pinned}
                        onOpenMenu={dismissComposerKeyboardForOverlay}
                        onRenameRequest={openThreadRename}
                        {...(onTogglePin === undefined ? {} : { onTogglePin })}
                        {...(archived
                          ? onUnarchive === undefined
                            ? {}
                            : { onUnarchive }
                          : onArchive === undefined
                            ? {}
                            : { onArchive })}
                        {...(onCompact === undefined ? {} : { onCompact })}
                        {...(onFork === undefined ? {} : { onFork })}
                        {...(deleteThread === undefined ? {} : { onDelete: deleteThread })}
                      />
                    )}
                  </View>

                  {threadSearchVisible && (
                    <View style={styles.threadSearchBar}>
                      <InlineIcon name="search" role="body" color={colors.textMuted} />
                      <TextInput
                        autoFocus
                        compact
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
                      <Text style={styles.threadSearchCount}>
                        {threadSearchMatches.length === 0
                          ? "0"
                          : `${threadSearchMatch + 1}/${threadSearchMatches.length}`}
                      </Text>
                      {!compact && (
                        <Pressable
                          accessibilityLabel="Previous match"
                          hitSlop={controlHitSlop.regular}
                          onPress={() => moveThreadSearch(-1)}
                          style={styles.searchAction}
                        >
                          <Ionicons name="chevron-up" size={iconSize.action} color={colors.text} />
                        </Pressable>
                      )}
                      <Pressable
                        accessibilityLabel="Next match"
                        hitSlop={controlHitSlop.regular}
                        onPress={() => moveThreadSearch(1)}
                        style={styles.searchAction}
                      >
                        <Ionicons name="chevron-down" size={iconSize.action} color={colors.text} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Close thread search"
                        hitSlop={controlHitSlop.regular}
                        onPress={closeThreadSearch}
                        style={styles.searchAction}
                      >
                        <Ionicons name="close" size={iconSize.action} color={colors.text} />
                      </Pressable>
                    </View>
                  )}
                </View>

                <View style={styles.conversationContentSurface}>
                  <KeyboardGestureArea
                    enableSwipeToDismiss
                    interpolator="ios"
                    offset={conversationInsets.bottom}
                    style={styles.conversationKeyboardBody}
                    onTouchStart={() => setComposerTrayVisible(false)}
                  >
                    <ThreadCwdContext.Provider value={cwd}>
                      <ThreadCodeDocumentContext.Provider value={openCodeDocument}>
                        <TurnChangesContext.Provider value={presentTurnChanges}>
                          <MessageActionMenuProvider>
                            <View ref={timelineViewportRef} style={styles.timelineShell}>
                              {draftConnectionId !== null && draftThreadId !== null && (
                                <CommitOnChangeProbe
                                  scope={`timeline-surface:${composerScope}`}
                                  revision={composerScope}
                                  onCommit={() => {
                                    const navigationId = recordThreadNavigationVisualEvent(
                                      draftConnectionId,
                                      draftThreadId,
                                      "timeline_surface_visible",
                                      {
                                        values: { itemCount: timeline.length },
                                        tags: {
                                          readOnly: readOnly ? "true" : "false",
                                          status: historyViewport.readStatus(),
                                        },
                                      },
                                    );
                                    return navigationId === null
                                      ? undefined
                                      : () =>
                                          recordThreadNavigationVisualEvent(
                                            draftConnectionId,
                                            draftThreadId,
                                            "timeline_surface_hidden_or_unmounted",
                                            {},
                                            navigationId,
                                          );
                                  }}
                                />
                              )}
                              <CommitOnChangeProbe
                                scope={composerScope}
                                revision={latestUnreadReceiptKey}
                                onCommit={commitUnreadReceipt}
                              />
                              <MessageListBoundary state={messageListState}>
                                <EveryCommitProbe onCommit={positionSearchTurn} />
                                <EveryCommitProbe onCommit={completeLatestJump} />
                                <ThreadTimelineNavigationCommit
                                  connectionId={draftConnectionId}
                                  threadId={draftThreadId}
                                  modelReady={timelineModelReady}
                                  visible={timelinePositioned}
                                  itemCount={timeline.length}
                                  turnCount={remoteThread?.turns.length ?? 0}
                                  loadStatus={historyViewport.readStatus()}
                                  restoreAnchorTurnId={initialRestoreAnchorTurnId}
                                >
                                  <TimelineMotionContext.Provider
                                    value={
                                      timelineDidLoad &&
                                      !timelineGestureActive &&
                                      !fullscreenCovered &&
                                      historyViewport.containsLatest &&
                                      !awayFromLatest &&
                                      !threadSearchActive
                                    }
                                  >
                                    <ThreadTimelineList
                                      key={composerScope}
                                      ref={timelineRef}
                                      testID="conversation-timeline"
                                      data={displayedTimeline}
                                      initialPosition={timelineInitialPosition}
                                      extraData={`${threadSearch}:${threadSearchMatch}:${windowLayout.measurementRevision}`}
                                      renderRevision={composerScope}
                                      measurementRevision={windowLayout.measurementRevision}
                                      style={styles.conversationScroll}
                                      contentContainerStyle={[
                                        styles.conversationContent,
                                        timelineCompact
                                          ? styles.conversationContentCompact
                                          : styles.conversationContentWide,
                                        {
                                          paddingBottom: conversationBottomContentInset(
                                            bottomChromeHeight,
                                            liveStatusVisible,
                                          ),
                                          paddingTop:
                                            conversationTopContentInset(threadSearchVisible),
                                        },
                                      ]}
                                      keyboardLiftBehavior="always"
                                      scrollsChildToFocus={false}
                                      keyboardOffset={conversationInsets.bottom}
                                      followTail={
                                        !fullscreenCovered &&
                                        historyViewport.containsLatest &&
                                        !awayFromLatest &&
                                        !threadSearchActive
                                      }
                                      automaticallyAdjustContentInsets={false}
                                      contentInsetAdjustmentBehavior="never"
                                      keyboardDismissMode="interactive"
                                      keyboardShouldPersistTaps="handled"
                                      nestedScrollEnabled
                                      scrollEnabled={!inlineQueueExpanded}
                                      getItemType={(item) => item.kind}
                                      scrollEventThrottle={16}
                                      onLoad={({ elapsedTimeInMs }) => {
                                        recordTiming("timeline_first_draw_ms", elapsedTimeInMs);
                                        if (draftConnectionId !== null && draftThreadId !== null) {
                                          recordThreadNavigationVisualEvent(
                                            draftConnectionId,
                                            draftThreadId,
                                            "timeline_first_draw",
                                            {
                                              values: {
                                                nativeListDrawMs: elapsedTimeInMs,
                                                itemCount: displayedTimeline.length,
                                              },
                                              tags: { status: historyViewport.readStatus() },
                                            },
                                          );
                                        }
                                        if (draftConnectionId !== null && draftThreadId !== null) {
                                          markThreadNavigationStage(
                                            draftConnectionId,
                                            draftThreadId,
                                            "timeline_first_draw",
                                            {
                                              values: {
                                                nativeListDrawMs: elapsedTimeInMs,
                                                itemCount: displayedTimeline.length,
                                              },
                                            },
                                          );
                                        }
                                        commitInitialTimelineLoad();
                                      }}
                                      onLayout={({ nativeEvent }) => {
                                        timelineViewportHeightRef.current =
                                          nativeEvent.layout.height;
                                        reportHistoryViewport();
                                        scheduleUnreadAgentVisibilityCheck();
                                      }}
                                      onScrollBeginDrag={({ nativeEvent }) => {
                                        setTimelineGestureActive(true);
                                        if (fullscreenScrollOwnership.isCovered()) return;
                                        if (threadSearchActive) return;
                                        cancelScheduledPaginationTrim();
                                        paginationEdgeLockRef.current = null;
                                        scrollGestureStartedAtRef.current = performance.now();
                                        lastTimelineOffsetYRef.current =
                                          nativeEvent.contentOffset.y;
                                        if (draftConnectionId !== null && draftThreadId !== null) {
                                          recordThreadHistoryTelemetry(
                                            draftConnectionId,
                                            draftThreadId,
                                            "chat.scroll.gesture_started",
                                            {
                                              ...(firstVisibleHistoryAnchorRef.current === null
                                                ? {}
                                                : { turnId: firstVisibleHistoryAnchorRef.current }),
                                              values: {
                                                offsetY: nativeEvent.contentOffset.y,
                                                contentHeightPx: nativeEvent.contentSize.height,
                                                viewportHeightPx:
                                                  nativeEvent.layoutMeasurement.height,
                                                distanceFromEndPx: Math.max(
                                                  0,
                                                  nativeEvent.contentSize.height -
                                                    nativeEvent.layoutMeasurement.height -
                                                    nativeEvent.contentOffset.y,
                                                ),
                                                itemCount: displayedTimeline.length,
                                              },
                                              tags: { status: historyViewport.readStatus() },
                                            },
                                          );
                                        }
                                      }}
                                      onScroll={({ nativeEvent }) => {
                                        if (fullscreenScrollOwnership.isCovered()) return;
                                        timelineViewportHeightRef.current =
                                          nativeEvent.layoutMeasurement.height;
                                        timelineContentHeightRef.current =
                                          nativeEvent.contentSize.height;
                                        scheduleUnreadAgentVisibilityCheck();
                                        if (threadSearchActive) return;
                                        lastTimelineOffsetYRef.current =
                                          nativeEvent.contentOffset.y;
                                        const distance = Math.max(
                                          0,
                                          nativeEvent.contentSize.height -
                                            nativeEvent.layoutMeasurement.height -
                                            nativeEvent.contentOffset.y,
                                        );
                                        scrollOffsetRef.current = distance;
                                        const away =
                                          !historyViewport.containsLatest ||
                                          distance > LATEST_TIMELINE_THRESHOLD_PX;
                                        const wasAway = awayFromLatestRef.current;
                                        if (awayFromLatestRef.current !== away) {
                                          awayFromLatestRef.current = away;
                                          setAwayFromLatest(away);
                                        }
                                        if (!away && wasAway) persistTimelineAtEnd();
                                      }}
                                      onScrollEndDrag={({ nativeEvent }) => {
                                        setTimelineGestureActive(false);
                                        if (fullscreenScrollOwnership.isCovered()) return;
                                        if (threadSearchActive) return;
                                        schedulePaginationWindowTrim();
                                        persistTimelineOffset(
                                          Math.max(
                                            0,
                                            nativeEvent.contentSize.height -
                                              nativeEvent.layoutMeasurement.height -
                                              nativeEvent.contentOffset.y,
                                          ),
                                        );
                                        if (draftConnectionId !== null && draftThreadId !== null) {
                                          recordThreadHistoryTelemetry(
                                            draftConnectionId,
                                            draftThreadId,
                                            "chat.scroll.drag_ended",
                                            {
                                              ...(firstVisibleHistoryAnchorRef.current === null
                                                ? {}
                                                : { turnId: firstVisibleHistoryAnchorRef.current }),
                                              values: {
                                                durationMs:
                                                  scrollGestureStartedAtRef.current === null
                                                    ? 0
                                                    : performance.now() -
                                                      scrollGestureStartedAtRef.current,
                                                offsetY: nativeEvent.contentOffset.y,
                                                contentHeightPx: nativeEvent.contentSize.height,
                                                viewportHeightPx:
                                                  nativeEvent.layoutMeasurement.height,
                                                distanceFromEndPx: Math.max(
                                                  0,
                                                  nativeEvent.contentSize.height -
                                                    nativeEvent.layoutMeasurement.height -
                                                    nativeEvent.contentOffset.y,
                                                ),
                                                itemCount: displayedTimeline.length,
                                              },
                                              tags: { status: historyViewport.readStatus() },
                                            },
                                          );
                                        }
                                      }}
                                      onMomentumScrollBegin={() => {
                                        setTimelineGestureActive(true);
                                        cancelScheduledPaginationTrim();
                                      }}
                                      onMomentumScrollEnd={({ nativeEvent }) => {
                                        setTimelineGestureActive(false);
                                        if (fullscreenScrollOwnership.isCovered()) return;
                                        if (threadSearchActive) return;
                                        trimPaginationWindow();
                                        persistTimelineOffset(
                                          Math.max(
                                            0,
                                            nativeEvent.contentSize.height -
                                              nativeEvent.layoutMeasurement.height -
                                              nativeEvent.contentOffset.y,
                                          ),
                                        );
                                        if (draftConnectionId !== null && draftThreadId !== null) {
                                          recordThreadHistoryTelemetry(
                                            draftConnectionId,
                                            draftThreadId,
                                            "chat.scroll.momentum_ended",
                                            {
                                              ...(firstVisibleHistoryAnchorRef.current === null
                                                ? {}
                                                : { turnId: firstVisibleHistoryAnchorRef.current }),
                                              values: {
                                                durationMs:
                                                  scrollGestureStartedAtRef.current === null
                                                    ? 0
                                                    : performance.now() -
                                                      scrollGestureStartedAtRef.current,
                                                offsetY: nativeEvent.contentOffset.y,
                                                contentHeightPx: nativeEvent.contentSize.height,
                                                viewportHeightPx:
                                                  nativeEvent.layoutMeasurement.height,
                                                distanceFromEndPx: Math.max(
                                                  0,
                                                  nativeEvent.contentSize.height -
                                                    nativeEvent.layoutMeasurement.height -
                                                    nativeEvent.contentOffset.y,
                                                ),
                                                itemCount: displayedTimeline.length,
                                              },
                                              tags: { status: historyViewport.readStatus() },
                                            },
                                          );
                                        }
                                        scrollGestureStartedAtRef.current = null;
                                      }}
                                      onContentSizeChange={(_width, height) => {
                                        timelineContentHeightRef.current = height;
                                        reportHistoryViewport();
                                        if (draftConnectionId !== null && draftThreadId !== null) {
                                          recordThreadNavigationVisualEvent(
                                            draftConnectionId,
                                            draftThreadId,
                                            "timeline_content_size_changed",
                                            {
                                              values: {
                                                heightPx: height,
                                                viewportHeightPx: timelineViewportHeightRef.current,
                                                itemCount: displayedTimeline.length,
                                              },
                                              tags: {
                                                positioned: timelinePositioned ? "true" : "false",
                                                status: historyViewport.readStatus(),
                                              },
                                            },
                                          );
                                        }
                                        scheduleUnreadAgentVisibilityCheck();
                                      }}
                                      showsVerticalScrollIndicator={false}
                                      onStartReached={loadOlderAtTimelineStart}
                                      onStartReachedThreshold={0.5}
                                      onEndReached={loadNewerAtTimelineEnd}
                                      onEndReachedThreshold={0.5}
                                      onFirstVisibleItemChanged={onTimelineFirstVisibleItemChanged}
                                      keyExtractor={timelineItemKey}
                                      ListHeaderComponent={
                                        historyViewport.containsBeginning &&
                                        !threadSearchActive &&
                                        displayedTimeline.length > 0 ? (
                                          <Text
                                            testID="history-beginning"
                                            style={styles.historyBeginning}
                                          >
                                            You’re at the beginning of this conversation
                                          </Text>
                                        ) : null
                                      }
                                      ListEmptyComponent={
                                        <View style={styles.emptyConversation}>
                                          {emptyRemoteThread && !threadSearchActive ? (
                                            <View
                                              testID="new-chat-empty-state"
                                              style={styles.newChatEmptyState}
                                            >
                                              <Text style={styles.newChatPrompt}>
                                                What would you like to work on?
                                              </Text>
                                              <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={`Change project, currently ${projectLabel(cwd) || "server default"}`}
                                                onPress={openProjectPicker}
                                                style={({ pressed }) => [
                                                  styles.newChatProjectButton,
                                                  pressed && styles.pressed,
                                                ]}
                                              >
                                                <Text
                                                  numberOfLines={1}
                                                  style={styles.newChatProjectText}
                                                >
                                                  in {projectLabel(cwd) || "server default"}
                                                </Text>
                                                <InlineIcon
                                                  name="chevron-down"
                                                  role="label"
                                                  color={colors.accent}
                                                />
                                              </Pressable>
                                              {workspaceSupport !== null &&
                                              onChangeWorkspaceMode !== undefined ? (
                                                <ActionMenu
                                                  accessibilityLabel="Choose workspace mode"
                                                  actions={[
                                                    {
                                                      id: "current",
                                                      section: "Workspace",
                                                      label: "In this folder",
                                                      description:
                                                        "Use the selected project directly",
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
                                                    if (id === "current" || id === "isolated")
                                                      onChangeWorkspaceMode(id);
                                                  }}
                                                >
                                                  <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`Workspace mode, ${workspaceMode === "isolated" ? "new workspace" : "in this folder"}`}
                                                    style={({ pressed }) => [
                                                      styles.newChatWorkspaceButton,
                                                      pressed && styles.pressed,
                                                    ]}
                                                  >
                                                    <Ionicons
                                                      name={
                                                        workspaceMode === "isolated"
                                                          ? "git-branch-outline"
                                                          : "folder-outline"
                                                      }
                                                      size={iconSize.inline}
                                                      color={colors.textMuted}
                                                    />
                                                    <Text style={styles.newChatWorkspaceText}>
                                                      {workspaceMode === "isolated"
                                                        ? "New workspace"
                                                        : "In this folder"}
                                                    </Text>
                                                    <InlineIcon
                                                      name="chevron-down"
                                                      role="label"
                                                      color={colors.textMuted}
                                                    />
                                                  </Pressable>
                                                </ActionMenu>
                                              ) : null}
                                            </View>
                                          ) : (
                                            <ThreadHistoryEmptyState
                                              model={historyActivityModel}
                                              resourceId={historyActivityResourceId}
                                              threadSearchActive={threadSearchActive}
                                            />
                                          )}
                                        </View>
                                      }
                                      ListFooterComponent={
                                        queuedComposerEdit === null &&
                                        !threadSearchActive &&
                                        inlineQueueOverlayItems.length > 0 ? (
                                          <InlineQueueOverlay
                                            maxHeight={inlineQueueMaxHeight}
                                            expanded={inlineQueueExpanded}
                                            items={inlineQueueOverlayItems}
                                            activeTurnId={currentTurnId}
                                            onOpen={toggleInlineQueueOverlay}
                                            onClose={closeInlineQueueOverlay}
                                            {...(onEditQueued === undefined || voicePhase !== "idle"
                                              ? {}
                                              : {
                                                  onEdit: (itemId: string) => {
                                                    const item = visibleQueuedPrompts.find(
                                                      (candidate) => candidate.commandId === itemId,
                                                    );
                                                    if (item !== undefined)
                                                      beginQueuedComposerEdit(item);
                                                  },
                                                })}
                                            {...(onCancelQueued === undefined
                                              ? {}
                                              : { onCancel: onCancelQueued })}
                                            {...(onMoveQueued === undefined
                                              ? {}
                                              : { onMove: onMoveQueued })}
                                            {...(onRetryFailedMessage === undefined
                                              ? {}
                                              : { onRetry: onRetryFailedMessage })}
                                            {...(onSteerQueued === undefined
                                              ? {}
                                              : { onSteer: onSteerQueued })}
                                            {...(onListQueue === undefined
                                              ? {}
                                              : { onRefresh: onListQueue })}
                                          />
                                        ) : null
                                      }
                                      renderItem={renderTimelineItem}
                                    />
                                  </TimelineMotionContext.Provider>
                                </ThreadTimelineNavigationCommit>
                              </MessageListBoundary>
                              {timelineModelReady && (
                                <ThreadHistoryLoadingIndicator
                                  model={historyActivityModel}
                                  resourceId={historyActivityResourceId}
                                  hasTimeline={timeline.length > 0}
                                />
                              )}
                              {liveStatusVisible && (
                                <View
                                  pointerEvents="box-none"
                                  testID="live-plan-float"
                                  style={[
                                    styles.livePlanFloat,
                                    {
                                      bottom: bottomChromeHeight + spacing.sm,
                                    },
                                  ]}
                                >
                                  {liveTurnPlan === null ? null : (
                                    <LiveTurnPlanPopover plan={liveTurnPlan} />
                                  )}
                                  {currentGoal === null ? null : (
                                    <ThreadGoalChip goal={currentGoal} onPress={openGoalDetails} />
                                  )}
                                </View>
                              )}
                            </View>
                          </MessageActionMenuProvider>
                        </TurnChangesContext.Provider>
                      </ThreadCodeDocumentContext.Provider>
                    </ThreadCwdContext.Provider>
                  </KeyboardGestureArea>
                </View>

                {conversationBackdropVisible && (
                  <ConversationPanelUnderlay
                    style={[
                      styles.conversationHeaderUnderlay,
                      { height: conversationHeaderChromeHeight(threadSearchVisible) },
                    ]}
                  />
                )}

                <KeyboardStickyView
                  enabled
                  offset={{ closed: 0, opened: conversationInsets.bottom }}
                  style={styles.composerSticky}
                >
                  {conversationBackdropVisible && (
                    <ConversationPanelUnderlay style={StyleSheet.absoluteFill} />
                  )}
                  {awayFromLatest && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        newItemCount > 0
                          ? `Jump to latest, ${newItemCount} new turns`
                          : "Jump to latest"
                      }
                      testID="jump-to-latest"
                      style={({ pressed }) => [
                        styles.jumpToLatest,
                        { bottom: bottomChromeHeight + spacing.xs },
                        pressed && styles.pressed,
                      ]}
                      onPress={jumpTimelineToLatest}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={iconSize.navigation}
                        color={colors.onPrimaryContainer}
                      />
                      {newItemCount > 0 && (
                        <View style={styles.jumpToLatestBadge}>
                          <Text
                            accessibilityLiveRegion="polite"
                            style={styles.jumpToLatestBadgeText}
                          >
                            {newItemCount > 99 ? "99+" : newItemCount}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  )}

                  <View
                    testID="conversation-bottom-chrome"
                    onLayout={({ nativeEvent }) => {
                      const nextHeight = Math.ceil(nativeEvent.layout.height);
                      setBottomChromeHeight((current) =>
                        Math.abs(current - nextHeight) < 1 ? current : nextHeight,
                      );
                    }}
                  >
                    {!readOnly &&
                      pendingRequest !== null &&
                      !timeline.some(
                        (item) => item.kind === "turn" && item.turn.status === "inProgress",
                      ) && (
                        <ApprovalPrompt
                          key={pendingRequest.requestKey}
                          request={pendingRequest}
                          requestCount={pendingRequestCount}
                          {...(onRespondToRequest === undefined
                            ? {}
                            : { onRespond: onRespondToRequest })}
                        />
                      )}
                    {failureNotice !== null && (
                      <ThreadErrorBanner
                        key={`${remoteThread?.id ?? ""}:${currentOutcome?.turnId ?? "unknown"}`}
                        message={failureNotice.message}
                        acceptsInput={failureNotice.acceptsInput}
                      />
                    )}
                    <View testID="composer-dock" style={styles.composerDock}>
                      <ScrollView
                        testID="composer-context-strip"
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.composerContextStrip}
                        contentContainerStyle={styles.composerContextContent}
                      >
                        <ComposerControlChips
                          newChat={newChat}
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
                        {onLoadThreadResources !== undefined && (
                          <ThreadResourceContextChips
                            model={threadResourcesModel}
                            resourceId={threadResourceId}
                            revision={threadResourceRevision}
                            load={onLoadThreadResources}
                            preferences={changesPreferences}
                            onPreferencesChange={setChangesPreferences}
                            onOpen={openThreadResources}
                          />
                        )}
                        <ComposerPortContextChip
                          connectionId={portForwardingConnectionId}
                          onOpen={() => openControls("ports")}
                        />
                        <ComposerTerminalContextChip
                          connectionId={draftConnectionId}
                          threadId={draftThreadId}
                          onOpen={openTerminal}
                        />
                        {subagentThreadDetails !== null && (
                          <ComposerSubagentContextChip
                            database={subagentSummaryDatabase}
                            connectionId={draftConnectionId}
                            parentThreadId={draftThreadId}
                            onOpen={(summaries) => openSubagents(summaries)}
                          />
                        )}
                      </ScrollView>
                      {!readOnly && (
                        <>
                          {queuedComposerEdit !== null && (
                            <View
                              testID="queued-composer-edit-bar"
                              style={styles.queuedComposerEditBar}
                            >
                              <InlineIcon
                                name="create-outline"
                                role="label"
                                color={colors.accent}
                              />
                              <Text numberOfLines={1} style={styles.queuedComposerEditTitle}>
                                Editing queue
                              </Text>
                              <Text numberOfLines={1} style={styles.queuedComposerEditPreview}>
                                {queuedComposerEdit.text}
                              </Text>
                              <Pressable
                                accessibilityLabel="Cancel queued message edit"
                                accessibilityRole="button"
                                hitSlop={controlHitSlop.regular}
                                onPress={cancelQueuedComposerEdit}
                                style={styles.queuedComposerEditClose}
                              >
                                <InlineIcon name="close" role="label" color={colors.textMuted} />
                              </Pressable>
                            </View>
                          )}
                          {(voiceError !== null || queuedComposerEditError !== null) && (
                            <View style={styles.composerErrorRow}>
                              <Text style={styles.composerError}>
                                {queuedComposerEditError ?? voiceError}
                              </Text>
                            </View>
                          )}
                          {getTransferAccess !== undefined && (
                            <ComposerAttachmentTray
                              scope={composerUploadScope}
                              attachments={attachments}
                              getAccess={getStableTransferAccess}
                              onRemove={(attachmentId) => {
                                composerUploads.remove(composerUploadScope, attachmentId);
                                if (queuedComposerEdit !== null) {
                                  updateAttachments(
                                    latestAttachmentsRef.current.latest.filter(
                                      (candidate) => candidate.id !== attachmentId,
                                    ),
                                  );
                                  return;
                                }
                                if (
                                  draftConnectionId !== null &&
                                  draftThreadId !== null &&
                                  removeDraftAttachment !== undefined
                                ) {
                                  void removeDraftAttachment(
                                    draftConnectionId,
                                    draftThreadId,
                                    attachmentId,
                                  ).catch(() =>
                                    dialog.alert(
                                      "Could not remove attachment",
                                      "Please try again.",
                                    ),
                                  );
                                }
                                if (contentReviewAttachmentId === attachmentId)
                                  setContentReviewAttachmentId(composerScope, null);
                              }}
                            />
                          )}
                          {composerTrayVisible && !useAnchoredComposerMenu && (
                            <ComposerAccessoryTray
                              fileEnabled={fileAttachmentEnabled}
                              terminalEnabled={
                                Platform.OS === "android" &&
                                draftConnectionId !== null &&
                                draftThreadId !== null
                              }
                              portForwardEnabled={portForwardingConnectionId !== null}
                              onSelect={openAccessoryAction}
                            />
                          )}
                          <View testID="composer-row" style={styles.composer}>
                            <View testID="composer-input-shell" style={styles.composerInputShell}>
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
                                  <Pressable
                                    accessibilityLabel="Composer menu"
                                    style={styles.composerMenu}
                                  >
                                    <Ionicons
                                      name="add"
                                      size={iconSize.navigation}
                                      color={colors.text}
                                    />
                                  </Pressable>
                                </ActionMenu>
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={
                                    composerTrayVisible ? "Close composer menu" : "Composer menu"
                                  }
                                  accessibilityState={{ expanded: composerTrayVisible }}
                                  onPress={() => setComposerTrayVisible((current) => !current)}
                                  style={({ pressed }) => [
                                    styles.composerMenu,
                                    composerTrayVisible && styles.composerMenuActive,
                                    pressed && styles.pressed,
                                  ]}
                                >
                                  <Ionicons
                                    name={composerTrayVisible ? "close" : "add"}
                                    size={iconSize.navigation}
                                    color={colors.text}
                                  />
                                </Pressable>
                              )}
                              {voicePhase === "idle" || voicePhase === "starting" ? (
                                <PrivateImageAccessProvider
                                  scope={`${composerScope}:skill-suggestions`}
                                  {...(getTransferAccess === undefined
                                    ? {}
                                    : { getAccess: getStableTransferAccess })}
                                >
                                  <ComposerMarkdownInput
                                    ref={composerInputRef}
                                    accessibilityLabel="Message Codex"
                                    {...(fileAttachmentEnabled &&
                                    !pastedAttachmentPending &&
                                    attachments.length < MAX_TURN_ATTACHMENTS
                                      ? {
                                          largePasteThreshold: AUTO_ATTACH_PASTE_MIN_CHARS,
                                          onLargePaste: handleComposerLargePaste,
                                        }
                                      : {})}
                                    value={draft}
                                    onChangeText={handleComposerTextChange}
                                    onChangeMarkdown={handleComposerMarkdownChange}
                                    onSelectionChange={(selection) => {
                                      draftSelectionRef.current = selection;
                                      if (
                                        pendingVoiceSelection !== null &&
                                        pendingVoiceSelection.start === selection.start &&
                                        pendingVoiceSelection.end === selection.end
                                      )
                                        voiceController?.clearPendingSelection(composerScope);
                                    }}
                                    {...(pendingVoiceSelection === null
                                      ? {}
                                      : { selection: pendingVoiceSelection })}
                                    mentionIndicators={["/"]}
                                    search={searchComposerSuggestions}
                                    {...(getTransferAccess === undefined
                                      ? {}
                                      : { getTransferAccess: getStableTransferAccess })}
                                    onSelectMention={selectComposerMention}
                                    placeholder={
                                      editingQueuedMessage
                                        ? "Edit queued message…"
                                        : "Message Codex…"
                                    }
                                    style={styles.composerInput}
                                  />
                                </PrivateImageAccessProvider>
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
                                ref={microphoneButtonRef}
                                accessibilityRole="button"
                                hitSlop={6}
                                disabled={
                                  editingQueuedMessage ||
                                  (voicePhase === "finishing" && !voiceRetryAvailable)
                                }
                                onPressIn={() => {
                                  if (voicePhase === "idle")
                                    setNativeVoiceAuraOrigin(
                                      findNodeHandle(microphoneButtonRef.current),
                                    );
                                }}
                                onPress={() =>
                                  void (voiceRetryAvailable
                                    ? retryVoice()
                                    : voicePhase === "idle"
                                      ? toggleVoice()
                                      : finishVoice(false))
                                }
                                style={[
                                  styles.composerIcon,
                                  (editingQueuedMessage ||
                                    (voicePhase === "idle" &&
                                      !microphoneAccess.granted &&
                                      !voiceRetryAvailable) ||
                                    (voicePhase === "finishing" && !voiceRetryAvailable)) &&
                                    styles.disabled,
                                ]}
                                accessibilityLabel={
                                  voiceRetryAvailable
                                    ? "Retry voice transcription"
                                    : voicePhase === "idle"
                                      ? microphoneAccess.granted
                                        ? "Voice input"
                                        : "Allow microphone access"
                                      : "Stop voice input and insert transcript"
                                }
                              >
                                {voicePhase === "starting" ? (
                                  <ActivityIndicator size="small" color={colors.textMuted} />
                                ) : (
                                  <Ionicons
                                    name={
                                      voiceRetryAvailable
                                        ? "refresh"
                                        : voicePhase === "idle"
                                          ? "mic-outline"
                                          : "stop-circle"
                                    }
                                    size={iconSize.action}
                                    color={
                                      voiceRetryAvailable || voicePhase === "idle"
                                        ? colors.text
                                        : colors.red
                                    }
                                  />
                                )}
                              </Pressable>
                              {editingQueuedMessage ? (
                                <SwipeDiscardAction
                                  accessibilityLabel="Save queued message"
                                  disabled={sendDisabled}
                                  discardEnabled={composerDiscardEnabled}
                                  steerEnabled={false}
                                  icon={queuedComposerEditBusy ? "hourglass-outline" : "checkmark"}
                                  iconColor={colors.onPrimary}
                                  style={styles.sendButton}
                                  pressedStyle={styles.sendButtonPressed}
                                  disabledStyle={styles.disabled}
                                  onDiscard={discardComposer}
                                  onSteer={steerComposer}
                                  onPress={activatePrimaryAction}
                                />
                              ) : (
                                <ComposerDeliveryMenu
                                  actions={deliveryActions}
                                  onOpen={dismissComposerKeyboardForOverlay}
                                  onSelect={handleDeliveryAction}
                                >
                                  <SwipeDiscardAction
                                    accessibilityLabel={
                                      voicePhase !== "idle"
                                        ? "Finish voice input and send transcript"
                                        : stoppingResponse
                                          ? "Stop response"
                                          : "Send message"
                                    }
                                    disabled={sendDisabled}
                                    discardEnabled={composerDiscardEnabled}
                                    steerEnabled={
                                      !sendDisabled &&
                                      threadLifecycleActive &&
                                      currentTurnId !== null
                                    }
                                    icon={
                                      voicePhase === "finishing"
                                        ? "hourglass-outline"
                                        : stoppingResponse
                                          ? "stop"
                                          : "arrow-up"
                                    }
                                    iconColor={stoppingResponse ? "#ffffff" : colors.onPrimary}
                                    style={[
                                      styles.sendButton,
                                      stoppingResponse && styles.stopButton,
                                    ]}
                                    pressedStyle={
                                      stoppingResponse ? undefined : styles.sendButtonPressed
                                    }
                                    disabledStyle={styles.disabled}
                                    onDiscard={discardComposer}
                                    onSteer={steerComposer}
                                    onPress={activatePrimaryAction}
                                  />
                                </ComposerDeliveryMenu>
                              )}
                            </View>
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                </KeyboardStickyView>

                <ContentReviewComposer targetPrefix="agent-response:" />

                {menuVisible && (
                  <ResourceComposerMenu
                    newChat={newChat}
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
                    selectedModel={selectedModel}
                    selectedEffort={selectedEffort}
                    selectedPersonality={selectedPersonality}
                    selectedPermissions={selectedPermissions}
                    onSelectModel={selectModel}
                    onSelectEffort={selectEffort}
                    onSelectPersonality={setSelectedPersonality}
                    onSelectPermissions={selectPermissions}
                    onInvokeSkill={insertSkillInvocation}
                    {...(onEditQueued === undefined || voicePhase !== "idle"
                      ? {}
                      : { onBeginQueuedEdit: beginQueuedComposerEdit })}
                    {...(onCancelQueued === undefined ? {} : { onCancelQueued })}
                    {...(onMoveQueued === undefined ? {} : { onMoveQueued })}
                    {...(onSteerQueued === undefined ? {} : { onSteerQueued })}
                    {...(getTransferAccess === undefined
                      ? {}
                      : { getTransferAccess: getStableTransferAccess })}
                    {...(onListTerminals === undefined ? {} : { onListTerminals })}
                    {...(onTerminateTerminal === undefined ? {} : { onTerminateTerminal })}
                    {...(onSetGoal === undefined ? {} : { onSetGoal })}
                    {...(onClearGoal === undefined ? {} : { onClearGoal })}
                    {...(onStartReview === undefined ? {} : { onStartReview })}
                    {...(onCreateTunnel === undefined ? {} : { onCreateTunnel })}
                    {...(onRevokeTunnel === undefined ? {} : { onRevokeTunnel })}
                  />
                )}
                {projectPickerVisible && (
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
                    {...(onManageProjects === undefined
                      ? {}
                      : {
                          onManageProjects: () => {
                            closeProjectPicker();
                            onManageProjects();
                          },
                        })}
                  />
                )}
                {threadRenameVisible && (
                  <ThreadRenameDialog
                    visible={threadRenameVisible}
                    title={thread.title}
                    onClose={closeThreadRename}
                    {...(onRename === undefined ? {} : { onRename })}
                  />
                )}
                {threadResourceSheet !== null && (
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
                    {...(onLoadThreadResources === undefined
                      ? {}
                      : { onReload: () => onLoadThreadResources(undefined, "attachments") })}
                    onClose={closeThreadResources}
                  />
                )}
              </View>
            </View>
          </LargeContentViewerHost>
        </SubagentNavigationContext.Provider>
      </AppFullscreenOverlayBoundary>
    </AppVoiceInputProvider>
  );
}

function recordedTurnChangeResources(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
): ThreadChangeResource[] {
  const resources: ThreadChangeResource[] = [];
  const indexesByPath = new Map<string, number>();
  for (const file of files) {
    const existingIndex = indexesByPath.get(file.path);
    if (existingIndex === undefined) {
      indexesByPath.set(file.path, resources.length);
      resources.push({
        path: file.path,
        kind: file.kind,
        availability: file.kind === "delete" ? "deleted" : "unavailable",
        additions: file.additions,
        deletions: file.deletions,
        turnId: target.turnId,
        itemId: file.itemId,
      });
      continue;
    }
    const existing = resources[existingIndex];
    if (existing === undefined) continue;
    existing.kind = file.kind;
    existing.availability = file.kind === "delete" ? "deleted" : "unavailable";
    existing.additions += file.additions;
    existing.deletions += file.deletions;
    existing.itemId = file.itemId;
  }
  return resources;
}

function recordedTurnChangeDiff(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
  path: string,
): ThreadChangeDiffValue {
  const patches: ThreadChangeDiffValue["patches"] = [];
  for (const file of files) {
    if (file.path !== path) continue;
    patches.push({
      turnId: target.turnId,
      itemId: file.itemId,
      kind: file.kind,
      diff: file.patch,
    });
  }
  return {
    threadId: target.threadId,
    path,
    changeScope: "lastTurn",
    patches,
    source: "",
    truncated: false,
  };
}

function recordedTurnResourcesValue(
  target: TurnChangesTarget,
  files: readonly TurnChangedFile[],
): ThreadResourcesValue {
  return {
    threadId: target.threadId,
    revision: target.turnId,
    changeScope: "lastTurn",
    changeScopes: [],
    changes: recordedTurnChangeResources(target, files),
    attachments: [],
  };
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
  const openVideo = useAttachmentVideoPreview();
  const downloadDocument = useDocumentDownload();
  const fullscreenOverlay = useAppFullscreenOverlay();
  const previewResourceOwnerId = useId();
  const previewRevisionRef = useRef(0);
  const [documentStack, setDocumentStack] = useState<ThreadResourceDocumentRoute[]>([]);
  const [documentViewportWidth, setDocumentViewportWidth] = useState(0);
  const changes = resource?.value?.changes ?? [];
  const attachments = resource?.value?.attachments ?? [];
  const attachmentsPending =
    resource === null ||
    (resource.pendingKinds === undefined
      ? resource.status === "loading"
      : resource.pendingKinds.includes("attachments"));
  const attachmentsReady =
    resource?.readyKinds === undefined
      ? resource?.value != null
      : resource.readyKinds.includes("attachments");
  const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;
  const attachmentsError =
    resource?.resourceErrors?.attachments ??
    (resource?.readyKinds === undefined && resource?.status === "error" ? resource.error : null);
  const title = `Attachments · ${attachments.length}`;
  const document = documentStack.at(-1) ?? null;
  const documentSource =
    document?.request.source ??
    (document === null ? null : { kind: "path" as const, path: document.request.path });
  const documentPreviewResource = useEphemeralAsyncResource<
    Extract<DocumentPreviewResult, { phase: "ready" }>
  >(
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
        segments:
          document.request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
        truncated: loaded.truncated,
      };
    },
    (value) => value.source.length * 2,
  );
  const documentResult: DocumentPreviewResult =
    documentPreviewResource.status === "ready" && documentPreviewResource.value !== null
      ? documentPreviewResource.value
      : documentPreviewResource.status === "error"
        ? { phase: "error", message: documentPreviewResource.error ?? "Document preview failed" }
        : { phase: "loading" };
  const loadPreview = (request: DocumentPreviewRequest, replace: boolean) => {
    previewRevisionRef.current += 1;
    const revision = previewRevisionRef.current;
    const route: ThreadResourceDocumentRoute = { request, revision };
    setDocumentStack((current) =>
      replace ? [...current.slice(0, -1), route] : [...current, route],
    );
  };
  const openPreview = (request: DocumentPreviewRequest) => {
    if (isAttachmentVideo(request.name)) {
      openVideo({
        name: request.name,
        source: request.source ?? { kind: "path", path: request.path },
        getAccess: request.getTransferAccess,
      });
      return;
    }
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
          {...(request.source === undefined
            ? {}
            : { sourceAssets: { [request.path]: request.source } })}
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
    openPreview({
      kind: remoteFileKind(name, resolvedPath),
      name,
      path: resolvedPath,
      getTransferAccess,
    });
  };
  const openAttachment = (attachment: ThreadAttachmentResource) => {
    if (attachment.path !== null) {
      openPath(attachment.name, attachment.path);
      return;
    }
    if (attachment.url !== null && isSafeHttpUrl(attachment.url)) {
      const kind = remoteFileKind(attachment.name, attachment.url);
      if (kind === "download" && !isAttachmentVideo(attachment.name)) {
        void Linking.openURL(attachment.url);
        return;
      }
      openPreview({
        kind,
        name: attachment.name,
        path: attachment.name,
        source: { kind: "remote", url: attachment.url },
        getTransferAccess,
      });
    } else dialog.alert("Attachment unavailable", "This attachment has no openable source.");
  };
  const openNestedDocument = (href: string) => {
    if (document === null) return false;
    const target = resolvePreviewableDocumentLink(
      href,
      remoteDocumentDirectory(document.request.path),
    );
    if (target === null) return false;
    const request = {
      ...target,
      getTransferAccess,
    };
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
      onOpenChange={(open) => {
        if (!open) (document === null ? closeSheet : navigateBack)();
      }}
      contentProps={{
        dismissLabel: document === null ? "Close attachments" : "Back to attachments",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <View
        pointerEvents={document === null ? "auto" : "none"}
        style={[styles.threadResourceRoute, document !== null && styles.threadResourceRouteHidden]}
      >
        <View style={styles.menuTitleRow}>
          <View style={styles.sheetHeaderIconSlot}>
            <Ionicons name="attach-outline" size={iconSize.action} color={colors.textMuted} />
          </View>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sheetTitle}>
            {title}
          </Text>
          <View style={styles.flex} />
          {attachmentsInitialLoading && <ActivityIndicator size="small" color={colors.accent} />}
        </View>
        <LegendList
          style={styles.menuScroll}
          contentContainerStyle={styles.threadResourcesContent}
          renderScrollComponent={AppSheetScrollView}
          keyboardShouldPersistTaps="handled"
          data={attachments}
          keyExtractor={(attachment) => attachment.key}
          getFixedItemSize={() => listRowHeight.double}
          renderItem={({ item, index }) => (
            <View style={styles.threadAttachmentCell}>
              <ThreadAttachmentResourceRow
                attachment={item}
                position={listRowPosition(index, attachments.length)}
                onPress={() => openAttachment(item)}
              />
            </View>
          )}
          ListHeaderComponent={
            attachmentsError !== null ? (
              <Text selectable style={styles.errorText}>
                {attachmentsError}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            attachmentsReady ? (
              <View style={styles.threadResourcesEmpty}>
                <Ionicons
                  name="attach-outline"
                  size={iconSize.illustration}
                  color={colors.textDim}
                />
                <Text style={styles.menuNotice}>No attachments in this thread.</Text>
              </View>
            ) : null
          }
        />
      </View>

      {document !== null && (
        <View style={styles.threadResourceRoute}>
          <View style={styles.menuTitleRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to attachments"
              onPress={navigateBack}
              style={styles.headerIcon}
            >
              <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
            </Pressable>
            <View style={styles.sheetHeaderIconSlot}>
              <Ionicons
                name={document.request.kind === "html" ? "globe-outline" : "document-text-outline"}
                size={iconSize.action}
                color={colors.textMuted}
              />
            </View>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.sheetTitle}>
              {document.request.name}
            </Text>
            <View style={styles.flex} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Download ${document.request.name}`}
              onPress={() => void downloadDocument(document.request)}
              style={styles.headerIcon}
            >
              <Ionicons name="download-outline" size={iconSize.action} color={colors.text} />
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
              <Text selectable style={styles.errorText}>
                {documentResult.message}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={retryPreview}
                style={styles.primaryAction}
              >
                <Ionicons name="refresh" size={iconSize.action} color={colors.onPrimary} />
                <Text style={styles.primaryActionText}>Retry</Text>
              </Pressable>
            </View>
          )}
          {documentResult.phase === "ready" && document.request.kind === "html" && (
            <HtmlDocumentPreview
              testID="thread-resource-html-preview"
              source={documentResult.source}
            />
          )}
          {documentResult.phase === "ready" && document.request.kind !== "html" && (
            <AppSheetScrollView
              style={styles.menuScroll}
              contentContainerStyle={styles.threadResourceDocumentContent}
              keyboardShouldPersistTaps="handled"
              onLayout={({ nativeEvent }) => {
                const nextWidth = Math.max(
                  0,
                  Math.floor(nativeEvent.layout.width - spacing.md * 2),
                );
                setDocumentViewportWidth((current) =>
                  current === nextWidth ? current : nextWidth,
                );
              }}
            >
              {document.request.kind === "text" ? (
                <NativeCodeBlock
                  value={documentResult.source}
                  language={nativeCodeLanguageForPath(document.request.path)}
                  maxHeight={TOOL_RESULT_MAX_HEIGHT}
                  fillAvailableWidth
                />
              ) : (
                <RichContentWidthProvider
                  width={documentViewportWidth > 0 ? documentViewportWidth : null}
                >
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
              {documentResult.truncated && (
                <Text style={styles.menuNotice}>
                  Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download
                  the file to read the rest.
                </Text>
              )}
              {document.request.kind === "markdown" && (
                <ContentReviewComments targetId={`markdown-document:${document.request.path}`} />
              )}
            </AppSheetScrollView>
          )}
          {documentResult.phase === "ready" && document.request.kind === "markdown" && (
            <ContentReviewComposer
              targetId={`markdown-document:${document.request.path}`}
              anchorKind="text"
            />
          )}
        </View>
      )}
    </AppSheet>
  );
}

function ThreadChangeResourceRow({
  change,
  cwd,
  onPress,
}: {
  change: ThreadChangeResource;
  cwd: string;
  onPress(): void;
}) {
  const missing = change.availability === "deleted";
  const unavailable = change.availability === "unavailable";
  const icon = missing
    ? "trash-outline"
    : change.kind === "add"
      ? "add-circle-outline"
      : change.kind === "delete"
        ? "remove-circle-outline"
        : "document-text-outline";
  const color =
    missing || change.kind === "delete"
      ? colors.red
      : change.kind === "add"
        ? colors.green
        : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open changed file ${change.path}`}
      onPress={onPress}
      style={({ pressed }) => [styles.threadResourceRow, pressed && styles.pressed]}
    >
      <View style={styles.threadResourceIcon}>
        <Ionicons name={icon} size={iconSize.action} color={color} />
      </View>
      <View style={styles.threadResourceText}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.threadResourceTitle}>
          {changedFileDisplayPath(change.path, cwd, 64)}
        </Text>
        <View style={styles.threadResourceMeta}>
          {change.binary ? (
            <Text style={styles.threadResourceStat}>Binary</Text>
          ) : (
            <>
              <Text style={[styles.threadResourceStat, styles.diffStatAdd]}>
                +{change.additions}
              </Text>
              <Text style={[styles.threadResourceStat, styles.diffStatDelete]}>
                −{change.deletions}
              </Text>
            </>
          )}
          {missing && <Text style={styles.threadResourceDeleted}>File was deleted</Text>}
          {unavailable && <Text style={styles.threadResourceUnavailable}>File unavailable</Text>}
        </View>
      </View>
      <InlineIcon
        name={missing ? "trash-outline" : unavailable ? "alert-circle-outline" : "chevron-forward"}
        role="label"
        color={missing ? colors.red : colors.textDim}
      />
    </Pressable>
  );
}

function ThreadAttachmentResourceRow({
  attachment,
  position,
  onPress,
}: {
  attachment: ThreadAttachmentResource;
  position: "only" | "first" | "middle" | "last";
  onPress(): void;
}) {
  const icon =
    attachment.kind === "image"
      ? "image"
      : attachment.kind === "audio"
        ? "audio"
        : "file";
  return (
    <AttachmentListRow
      title={attachment.name}
      description={`${attachment.origin === "user" ? "You" : "Codex"} · ${attachment.kind}`}
      accessibilityLabel={`Open attachment ${attachment.name}`}
      onPress={onPress}
      position={position}
      leading={icon}
      trailing={
        attachment.path === null ? "open"
          : remoteFileKind(attachment.name, attachment.path) === "download" ? "download"
          : undefined
      }
    />
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
    {
      id: "pin",
      label: pinned ? "Unpin thread" : "Pin thread",
      icon: "pin-outline",
      selected: pinned,
      disabled: onTogglePin === undefined,
    },
    {
      id: "fork",
      label: "Fork thread",
      icon: "git-branch-outline",
      disabled: onFork === undefined,
    },
    {
      id: "compact",
      label: "Compact context",
      icon: "contract-outline",
      disabled: onCompact === undefined,
    },
    {
      id: "archive",
      label: archived ? "Unarchive thread" : "Archive thread",
      icon: archived ? "archive" : "archive-outline",
      disabled: archived ? onUnarchive === undefined : onArchive === undefined,
    },
    {
      id: "delete",
      label: "Delete thread",
      icon: "trash-outline",
      destructive: true,
      disabled: onDelete === undefined,
    },
  ];
  const run = (action: (() => Promise<void>) | undefined, label: string) => {
    if (action === undefined) return;
    void action().catch((cause) =>
      dialog.alert(
        `${label} failed`,
        cause instanceof Error ? cause.message : "Thread action failed",
      ),
    );
  };
  const handleAction = (id: string) => {
    if (id === "copy-session-id")
      void copySessionId(threadId).catch((cause) =>
        dialog.alert(
          "Copy failed",
          cause instanceof Error ? cause.message : "Could not copy session ID",
        ),
      );
    else if (id === "rename") onRenameRequest();
    else if (id === "pin") run(onTogglePin, pinned ? "Unpin" : "Pin");
    else if (id === "fork" && onFork !== undefined)
      run(() => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
    else if (id === "compact") run(onCompact, "Compact");
    else if (id === "archive")
      run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
    else if (id === "delete" && onDelete !== undefined) {
      dialog.alert(
        "Delete thread?",
        "This permanently deletes the thread on the selected server.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => run(onDelete, "Delete") },
        ],
      );
    }
  };
  if (Platform.OS === "web") {
    return (
      <>
        <Pressable
          accessibilityLabel="Thread menu"
          onPress={() => setWebMenuVisible(true)}
          style={styles.headerIcon}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.text} />
        </Pressable>
        {webMenuVisible && (
          <AppSheet
            isOpen
            onOpenChange={setWebMenuVisible}
            contentProps={{ index: 0, enableDynamicSizing: true }}
          >
            <Text style={styles.sheetTitle}>Thread</Text>
            <MenuAction
              icon="copy-outline"
              title="Copy session ID"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                handleAction("copy-session-id");
              }}
            />
            <MenuAction
              icon="pencil-outline"
              title="Rename"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                onRenameRequest();
              }}
            />
            <MenuAction
              icon="push-pin"
              title={pinned ? "Unpin thread" : "Pin thread"}
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                run(onTogglePin, pinned ? "Unpin" : "Pin");
              }}
            />
            <MenuAction
              icon="git-branch-outline"
              title="Fork thread"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                if (onFork !== undefined)
                  run(() => onFork({ boundary: { kind: "all" }, ephemeral: false }), "Fork");
              }}
            />
            <MenuAction
              icon="contract-outline"
              title="Compact context"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                run(onCompact, "Compact");
              }}
            />
            <MenuAction
              icon={archived ? "archive" : "archive-outline"}
              title={archived ? "Unarchive thread" : "Archive thread"}
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                run(archived ? onUnarchive : onArchive, archived ? "Unarchive" : "Archive");
              }}
            />
            <MenuAction
              danger
              icon="trash-outline"
              title="Delete thread"
              subtitle=""
              onPress={() => {
                setWebMenuVisible(false);
                handleAction("delete");
              }}
            />
          </AppSheet>
        )}
      </>
    );
  }
  return (
    <ActionMenu
      accessibilityLabel="Thread menu"
      actions={actions}
      {...(onOpenMenu === undefined
        ? {}
        : {
            onOpenChange: (open: boolean) => {
              if (open) onOpenMenu();
            },
          })}
      onSelect={handleAction}
      style={styles.headerMenuAnchor}
    >
      <Pressable style={styles.headerIcon} accessibilityLabel="Thread menu">
        <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.text} />
      </Pressable>
    </ActionMenu>
  );
}

const QUEUE_DRAG_ROW_STEP = 76;

function QueueDragHandle({
  disabled,
  onDrop,
}: {
  disabled: boolean;
  onDrop(offset: number): void;
}) {
  const translation = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translation.get() }] }));
  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(120)
    .onUpdate((event) => {
      translation.set(event.translationY);
    })
    .onEnd((event) => {
      const offset = Math.round(event.translationY / QUEUE_DRAG_ROW_STEP);
      translation.set(withTiming(0, { duration: 140 }));
      if (offset !== 0) runOnJS(onDrop)(offset);
    })
    .onFinalize(() => {
      translation.set(withTiming(0, { duration: 140 }));
    });
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        accessibilityLabel="Drag queued prompt"
        style={[styles.queueDragHandle, dragStyle]}
      >
        <Ionicons
          name="reorder-three"
          size={iconSize.navigation}
          color={disabled ? colors.textDim : colors.textMuted}
        />
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
}: {
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
  items: QueuedPrompt[];
  activeTurnId: string | null;
  onEdit?(item: QueuedPrompt): void;
  onCancel?(commandId: string): Promise<void>;
  onMove?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteer?(commandId: string, expectedTurnId: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
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
  const content = (
    <>
      {!embedded && (
        <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Queued prompts</Text>
          <View style={styles.flex} />
        </View>
      )}
      {items.length === 0 && (
        <Text style={styles.menuNotice}>Nothing is waiting for this thread.</Text>
      )}
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((item, index) => (
          <View key={item.commandId} style={styles.queueRow}>
            <View style={styles.queueCompactRow}>
              <QueueDragHandle
                disabled={busy || item.state !== "queued" || onMove === undefined}
                onDrop={(offset) => void run(() => moveBy(item, index, offset))}
              />
              <View style={styles.queueBody}>
                <Text numberOfLines={2} ellipsizeMode="tail" style={styles.queueText}>
                  {item.text || item.attachments.map(({ name }) => name).join(", ")}
                </Text>
                <View style={styles.queueMetaRow}>
                  <Text numberOfLines={1} style={styles.queueTime}>
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {item.state}
                  </Text>
                  {item.attachments.length > 0 && (
                    <Text numberOfLines={1} style={styles.queueTime}>
                      {" "}
                      · {item.attachments.length} attachment
                      {item.attachments.length === 1 ? "" : "s"}
                    </Text>
                  )}
                </View>
              </View>
              {activeTurnId !== null && (
                <Pressable
                  accessibilityLabel="Steer queued prompt"
                  disabled={busy || item.state !== "queued" || onSteer === undefined}
                  onPress={() =>
                    void run(() => onSteer?.(item.commandId, activeTurnId) ?? Promise.resolve())
                  }
                  style={styles.queueSteerButton}
                >
                  <InlineIcon name="navigate-outline" role="label" color={colors.onPrimary} />
                  <Text style={styles.queueSteerLabel}>Steer</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityLabel="Edit queued prompt"
                disabled={busy || item.state !== "queued" || onEdit === undefined}
                onPress={() => onEdit?.(item)}
                style={styles.headerIcon}
              >
                <Ionicons name="create-outline" size={iconSize.action} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityLabel="Delete queued prompt"
                disabled={busy || item.state === "uncertain" || onCancel === undefined}
                onPress={() => void run(() => onCancel?.(item.commandId) ?? Promise.resolve())}
                style={styles.headerIcon}
              >
                <Ionicons name="trash-outline" size={iconSize.action} color={colors.red} />
              </Pressable>
            </View>
            {item.lastError !== null && <Text style={styles.errorText}>{item.lastError}</Text>}
          </View>
        ))}
      </AppSheetScrollView>
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </>
  );
  return embedded ? (
    content
  ) : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close queue",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
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
  const reload = async () => {
    if (onList !== undefined) await onList();
  };
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
      {!embedded && (
        <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Background terminals</Text>
          <View style={styles.flex} />
          <Pressable
            accessibilityLabel="Refresh terminals"
            onPress={() => void reload()}
            style={styles.headerIcon}
          >
            <Ionicons name="refresh" size={iconSize.action} color={colors.text} />
          </Pressable>
        </View>
      )}
      {items.length === 0 && (
        <Text style={styles.menuNotice}>No background processes in this thread.</Text>
      )}
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
      >
        {items.map((item) => (
          <View key={item.processId}>
            {/* Native ListItem text is not selectable; retain copying commands and paths. */}
            <View style={[listRowStyles.surface, listRowStyles.first, listRowStyles.row]}>
              <Ionicons name="terminal-outline" size={iconSize.action} color={colors.textMuted} />
              <View style={listRowStyles.text}>
                <Text selectable numberOfLines={3} style={listRowStyles.title}>
                  {item.command}
                </Text>
                <Text selectable style={listRowStyles.description}>
                  {item.cwd} · PID {item.osPid ?? item.processId}
                </Text>
              </View>
              <View style={listRowStyles.separator} />
            </View>
            <AppListRow
              title={`${item.cpuPercent === null ? "CPU —" : `CPU ${item.cpuPercent.toFixed(1)}%`} · ${item.rssKb === null ? "RAM —" : `RAM ${item.rssKb} KiB`}`}
              fixedHeight={listRowHeight.single}
              position="last"
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Terminate ${item.processId}`}
                  disabled={busyId !== null || onTerminate === undefined}
                  onPress={() => void terminate(item.processId)}
                  style={styles.headerIcon}
                >
                  {busyId === item.processId ? (
                    <ActivityIndicator color={colors.red} size="small" />
                  ) : (
                    <Ionicons
                      name="stop-circle-outline"
                      size={iconSize.action}
                      color={colors.red}
                    />
                  )}
                </Pressable>
              }
            />
          </View>
        ))}
      </AppSheetScrollView>
      {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
    </>
  );
  return embedded ? (
    content
  ) : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close terminals",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
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
  voiceScope: parentVoiceScope,
}: {
  visible: boolean;
  onClose(): void;
  goal: ThreadGoal | null;
  resourceError: string | null;
  onSet(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClear(): Promise<boolean>;
  voiceScope: string;
}) {
  const inputId = useId();
  const voiceScope = `${parentVoiceScope}\u0000goal\u0000${inputId}`;
  const voiceRuntime = useAppVoiceInputRuntime();
  const voiceController = voiceRuntime?.controller ?? null;
  const voiceResource = useVoiceInputResource(voiceRuntime, voiceScope);
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(
    goal?.tokenBudget === null || goal?.tokenBudget === undefined ? "" : String(goal.tokenBudget),
  );
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voicePhase = voiceResource?.phase ?? "idle";
  const effectiveError = error ?? voiceResource?.error ?? resourceError;
  const applyGoal = (next: ThreadGoal | null) => {
    setObjective(next?.objective ?? "");
    setTokenBudget(
      next?.tokenBudget === null || next?.tokenBudget === undefined ? "" : String(next.tokenBudget),
    );
  };
  const close = () => {
    if (voicePhase === "idle" || voiceController === null) {
      onClose();
      return;
    }
    void voiceController.finish(voiceScope, false).then(onClose);
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
    void operation
      .then(
        (next) => {
          applyGoal(next);
          onClose();
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not save goal");
        },
      )
      .then(() => setBusy(false));
  };
  const clear = () => {
    setBusy(true);
    setError(null);
    const operation = onClear();
    void operation
      .then(
        (cleared) => {
          if (cleared) {
            applyGoal(null);
            setConfirmClear(false);
            onClose();
          } else setError("Goal was already cleared");
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not clear goal");
        },
      )
      .then(() => setBusy(false));
  };
  return (
    <Dialog
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress={!busy} />
        <KeyboardAvoidingView behavior="padding">
          <Dialog.Content style={styles.goalDialogContent}>
            <Dialog.Close accessibilityLabel="Close goal dialog" isDisabled={busy} />

            <View style={styles.goalDialogIntro}>
              <Dialog.Title>{goal === null ? "Create goal" : "Edit goal"}</Dialog.Title>
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

            {goal !== null && confirmClear && (
              <Text style={styles.goalClearPrompt}>Remove this goal from the thread?</Text>
            )}
            <View style={styles.goalDialogActions}>
              {goal !== null && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={busy}
                  onPress={() => (confirmClear ? clear() : setConfirmClear(true))}
                >
                  {confirmClear ? "Remove" : "Clear goal"}
                </Button>
              )}
              <View style={styles.flex} />
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                isDisabled={busy || objective.trim() === "" || voicePhase !== "idle"}
                onPress={save}
              >
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
    void operation
      .then(
        (reviewThreadId) => {
          setResult(
            delivery === "detached"
              ? `Review started in ${reviewThreadId}`
              : "Inline review started",
          );
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not start review");
        },
      )
      .then(() => setBusy(false));
  };
  const needsValue = targetType !== "uncommittedChanges";
  const content = (
    <>
      {!embedded && (
        <View style={styles.menuTitleRow}>
          <Text style={styles.sheetTitle}>Review</Text>
          <View style={styles.flex} />
        </View>
      )}
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.controlSectionLabel}>Review target</Text>
        <ControlOption
          title="Uncommitted changes"
          selected={targetType === "uncommittedChanges"}
          onPress={() => {
            setTargetType("uncommittedChanges");
            setTargetValue("");
          }}
        />
        <ControlOption
          title="Base branch"
          selected={targetType === "baseBranch"}
          onPress={() => setTargetType("baseBranch")}
        />
        <ControlOption
          title="Commit"
          selected={targetType === "commit"}
          onPress={() => setTargetType("commit")}
        />
        <ControlOption
          title="Custom instructions"
          selected={targetType === "custom"}
          onPress={() => setTargetType("custom")}
        />
        {needsValue && (
          <TextInput
            voiceInput={targetType === "custom"}
            accessibilityLabel="Review target value"
            multiline={targetType === "custom"}
            value={targetValue}
            onChangeText={setTargetValue}
            placeholder={
              targetType === "baseBranch"
                ? "main"
                : targetType === "commit"
                  ? "commit SHA"
                  : "What should the review focus on?"
            }
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start review"
          disabled={busy || (needsValue && targetValue.trim() === "")}
          onPress={() => void start()}
          style={[
            styles.primaryButton,
            (busy || (needsValue && targetValue.trim() === "")) && styles.disabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>{busy ? "Starting…" : "Start review"}</Text>
        </Pressable>
        {result !== null && <Text style={styles.successText}>{result}</Text>}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </AppSheetScrollView>
    </>
  );
  return embedded ? (
    content
  ) : (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close review controls",
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
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
  { id: "drawing", icon: "brush-outline", label: "Drawing" },
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
  const enabled = (action: ComposerAccessoryAction) =>
    action === "files" || action === "drawing"
      ? fileEnabled
      : action === "terminal"
        ? terminalEnabled
        : action !== "ports" || portForwardEnabled;
  return (
    <View
      testID="composer-accessory-tray"
      accessibilityLabel="Composer actions"
      style={styles.composerAccessoryTray}
    >
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
            style={({ pressed }) => [
              styles.composerAccessoryAction,
              pressed && styles.pressed,
              !actionEnabled && styles.disabled,
            ]}
          >
            <Ionicons name={action.icon} size={iconSize.action} color={colors.text} />
            <Text numberOfLines={1} style={styles.composerAccessoryLabel}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type ComposerMenuProps = Parameters<typeof ComposerMenu>[0];

function ResourceComposerMenu({
  newChat,
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
}: Omit<
  ComposerMenuProps,
  | "controls"
  | "terminalsResource"
  | "goalResource"
  | "tunnelResource"
  | "portForwarding"
  | "loading"
  | "error"
> & {
  newChat: boolean;
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
  const loading =
    props.initialPage === "skills"
      ? controls.skills.length === 0 &&
        (controlsResource === null ||
          controlsResource.status === "loading" ||
          controlsResource.status === "refreshing")
      : controlsResource?.status === "loading" && controlsResource.value === null;
  const serverExecution =
    props.thread === null ? null : projectedThreadExecutionSettings(props.thread);
  const { model: selectedModel, effort: selectedEffort } = composerModelSettings(
    newChat,
    serverExecution,
    { model: props.selectedModel, effort: props.selectedEffort },
    controls,
  );
  const selectedPermissions =
    props.selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  const portForwarding =
    portForwardingConnectionId === null || onOpenPortForward === undefined
      ? undefined
      : nativePortForwardingManagerProps(
          portForwardingConnectionId,
          portForwardingServerName,
          portSnapshot,
          onOpenPortForward,
        );
  return (
    <ComposerMenu
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
    />
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
  onBeginQueuedEdit,
  onCancelQueued,
  onMoveQueued,
  onSteerQueued,
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
  onBeginQueuedEdit?(item: QueuedPrompt): void;
  onCancelQueued?(commandId: string): Promise<void>;
  onMoveQueued?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteerQueued?(commandId: string, expectedTurnId: string): Promise<void>;
  getTransferAccess?: GetTransferAccess;
  onListTerminals?(): Promise<BackgroundTerminal[]>;
  onTerminateTerminal?(processId: string): Promise<boolean>;
  onSetGoal?(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClearGoal?(): Promise<boolean>;
  onStartVoiceTranscription?(
    listener: (event: VoiceTranscriptionEvent) => void,
    options?: VoiceTranscriptionOptions,
  ): Promise<VoiceTranscriptionSession>;
  onStartReview?(target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
  onCreateTunnel?(port: number, ttlSeconds: number): Promise<TunnelPreview>;
  onRevokeTunnel?(tunnelId: string): Promise<void>;
}) {
  const page = initialPage;
  const [runtimeSection, setRuntimeSection] = useState<"terminals" | "tunnel">(
    onListTerminals === undefined && onCreateTunnel !== undefined ? "tunnel" : "terminals",
  );
  const model = controls.models.find((candidate) => candidate.id === selectedModel);
  const reasoningEfforts =
    model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];
  if (page === "goal") {
    if (!visible) return null;
    if (onSetGoal === undefined || onClearGoal === undefined) {
      return (
        <AppSheet
          isOpen={visible}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          contentProps={{
            dismissLabel: "Close turn controls",
            index: 0,
            enableDynamicSizing: true,
          }}
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
        onSet={onSetGoal}
        onClear={onClearGoal}
      />
    );
  }
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
        performanceSurface: page === "ports" ? "ports" : page === "skills" ? "skills" : "sheet",
      }}
    >
      {(page !== "ports" || portForwarding === undefined) && (
        <View style={styles.menuTitleRow}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sheetTitle}>
            {pageTitle(page)}
          </Text>
        </View>
      )}
      <View style={[styles.sheetPage, styles.expandedSheetPage]}>
        {(page === "model" || page === "permissions") && loading && (
          <Text style={styles.menuNotice}>Loading from remote server…</Text>
        )}
        {(page === "model" || page === "permissions") && error !== null && (
          <Text style={styles.errorText}>{error}</Text>
        )}
        {page === "skills" ? (
          <PrivateImageAccessProvider
            scope={`${voiceScope}:skills`}
            {...(getTransferAccess === undefined ? {} : { getAccess: getTransferAccess })}
          >
            {visible && (
              <SkillsPicker
                skills={controls.skills}
                loading={loading}
                error={error}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                onSelect={(skill) => {
                  onInvokeSkill(skill);
                  onClose();
                }}
              />
            )}
          </PrivateImageAccessProvider>
        ) : page === "queue" ? (
          <QueueManagerSheet
            embedded
            visible
            onClose={onClose}
            items={queuedPrompts}
            activeTurnId={activeTurnId}
            {...(onBeginQueuedEdit === undefined ? {} : { onEdit: onBeginQueuedEdit })}
            {...(onCancelQueued === undefined ? {} : { onCancel: onCancelQueued })}
            {...(onMoveQueued === undefined ? {} : { onMove: onMoveQueued })}
            {...(onSteerQueued === undefined ? {} : { onSteer: onSteerQueued })}
          />
        ) : page === "review" ? (
          <ReviewSheet
            embedded
            visible
            onClose={onClose}
            {...(onStartReview === undefined ? {} : { onStartReview })}
          />
        ) : page === "ports" ? (
          portForwarding !== undefined ? (
            <PortForwardingManager {...portForwarding} renderScrollComponent={AppSheetScrollView} />
          ) : (
            <Text style={styles.menuNotice}>Port forwarding is unavailable for this server</Text>
          )
        ) : page === "runtime" ? (
          <>
            {onListTerminals !== undefined &&
              (portForwarding !== undefined || onCreateTunnel !== undefined) && (
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
              <PortForwardingManager
                {...portForwarding}
                renderScrollComponent={AppSheetScrollView}
              />
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
          <AppSheetScrollView
            key={page}
            style={styles.menuScroll}
            contentContainerStyle={styles.menuScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {page === "model" && (
              <>
                <Text style={styles.controlSectionLabel}>Model</Text>
                {controls.models.length === 0 ? (
                  <Text style={styles.menuNotice}>No models returned by the server</Text>
                ) : (
                  controls.models.map((candidate, index) => {
                    const currentEffort =
                      selectedEffort ?? model?.defaultEffort ?? candidate.defaultEffort;
                    const nextEffort = candidate.efforts.includes(currentEffort)
                      ? currentEffort
                      : candidate.defaultEffort;
                    return (
                      <ControlOption
                        key={candidate.id}
                        position={listRowPosition(index, controls.models.length)}
                        title={candidate.label}
                        subtitle={candidate.id}
                        selected={candidate.id === selectedModel}
                        onPress={() => onSelectModel(candidate.id, nextEffort)}
                      />
                    );
                  })
                )}
                {model !== undefined && (
                  <>
                    <Text style={styles.controlSectionLabel}>Thinking</Text>
                    {reasoningEfforts.map((effort, index) => (
                      <ControlOption
                        key={effort}
                        position={listRowPosition(index, reasoningEfforts.length)}
                        title={effort}
                        selected={effort === selectedEffort}
                        onPress={() => onSelectEffort(effort)}
                      />
                    ))}
                  </>
                )}
                {model?.supportsPersonality === true && (
                  <>
                    <Text style={styles.controlSectionLabel}>Personality</Text>
                    <ControlOption
                      position="first"
                      title="Server default"
                      selected={selectedPersonality === null}
                      onPress={() => onSelectPersonality(null)}
                    />
                    {(["friendly", "pragmatic", "none"] as const).map((personality, index) => (
                      <ControlOption
                        position={listRowPosition(index + 1, 4)}
                        key={personality}
                        title={personality}
                        selected={personality === selectedPersonality}
                        onPress={() => onSelectPersonality(personality)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
            {page === "permissions" && (
              <>
                <ControlOption
                  position={controls.permissions.length === 0 ? "only" : "first"}
                  title="Server default"
                  selected={selectedPermissions === null}
                  onPress={() => onSelectPermissions(null)}
                />
                {controls.permissions.map((permission, index) => (
                  <ControlOption
                    key={permission.id}
                    position={listRowPosition(index + 1, controls.permissions.length + 1)}
                    title={permissionProfileLabel(permission.id)}
                    subtitle={
                      permission.description === null
                        ? permission.id
                        : `${permission.description} · ${permission.id}`
                    }
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
    <AppListRow
      title={title}
      description={subtitle}
      danger={danger}
      fixedHeight={listRowHeight.double}
      disabled={onPress === undefined}
      {...(onPress === undefined ? {} : { onPress })}
      {...(isComposeIconName(icon)
        ? { leadingIcon: { name: icon, size: iconSize.action, color: danger ? colors.red : colors.textMuted } }
        : { leading: icon === "push-pin"
          ? <MaterialIcons name="push-pin" size={iconSize.action} color={danger ? colors.red : colors.textMuted} />
          : <Ionicons name={icon} size={iconSize.action} color={danger ? colors.red : colors.textMuted} /> })}
    />
  );
}

function ControlOption({
  accessibilityLabel,
  title,
  titleAccessory,
  subtitle,
  selected,
  attention = false,
  disabled = false,
  position = "only",
  onPress,
}: {
  accessibilityLabel?: string;
  title: string;
  titleAccessory?: ReactNode;
  subtitle?: string;
  selected: boolean;
  attention?: boolean;
  disabled?: boolean;
  position?: "only" | "first" | "middle" | "last";
  onPress(): void;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      accessibilityLabel={`${accessibilityLabel ?? title}${selected ? ", selected" : ""}`}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      position={position}
      fixedHeight={subtitle === undefined ? listRowHeight.single : listRowHeight.double}
      {...(titleAccessory === undefined
        ? attention ? { trailingIcon: { name: "alert-circle-outline", size: iconSize.inline, color: colors.amber } } : {}
        : { trailing: <>{titleAccessory}{attention && <Ionicons name="alert-circle-outline" size={iconSize.inline} color={colors.amber} />}</> })}
    />
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

function ApprovalPrompt({
  request,
  requestCount,
  embedded = false,
  onRespond,
}: {
  request: PendingServerRequest;
  requestCount: number;
  embedded?: boolean;
  onRespond?(request: PendingServerRequest, result: unknown): Promise<void>;
}) {
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
  const questions =
    method === "item/tool/requestUserInput" && Array.isArray(params.questions)
      ? params.questions.filter(
          (value): value is Record<string, unknown> =>
            value !== null && typeof value === "object" && !Array.isArray(value),
        )
      : [];
  const command = typeof params.command === "string" ? params.command : null;
  const cwd = typeof params.cwd === "string" ? params.cwd : null;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const elicitationMessage =
    method === "mcpServer/elicitation/request" && typeof params.message === "string"
      ? params.message
      : null;
  const elicitationFields =
    method === "mcpServer/elicitation/request" ? mcpElicitationFields(params) : [];
  const elicitationMode =
    method === "mcpServer/elicitation/request" && typeof params.mode === "string"
      ? params.mode
      : null;
  const elicitationUrl =
    elicitationMode === "url" && typeof params.url === "string" && isSafeHttpUrl(params.url)
      ? params.url
      : null;
  const submitElicitation = () => {
    try {
      const content = Object.fromEntries(
        elicitationFields.map((field) => {
          const raw = answers[field.id] ?? field.defaultValue;
          if (field.required && raw.trim() === "") throw new Error(`${field.label} is required`);
          return [field.id, parseElicitationValue(field.type, raw)];
        }),
      );
      void respond({ action: "accept", content, _meta: null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid form value");
    }
  };
  return (
    <View style={[styles.approvalCard, embedded && styles.approvalInline]}>
      <View style={styles.approvalTitleRow}>
        <Ionicons name="shield-checkmark-outline" size={iconSize.action} color={colors.amber} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.approvalTitle}>
          {approvalTitle(method)}
        </Text>
        {requestCount > 1 && <Text style={styles.approvalQueueCount}>1/{requestCount}</Text>}
        {waiting && <Text style={styles.approvalPending}>RESOLVING…</Text>}
      </View>
      {reason !== null && (
        <Text numberOfLines={1} style={styles.approvalReason}>
          {reason}
        </Text>
      )}
      {elicitationMessage !== null && (
        <Text numberOfLines={2} style={styles.approvalReason}>
          {elicitationMessage}
        </Text>
      )}
      {command !== null && (
        <Text selectable numberOfLines={2} style={styles.approvalCommand}>
          {command}
        </Text>
      )}
      {cwd !== null && (
        <Text selectable numberOfLines={1} style={styles.approvalCwd}>
          ⌁ {basename(cwd)}
        </Text>
      )}
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
                  const value =
                    option !== null &&
                    typeof option === "object" &&
                    "label" in option &&
                    typeof option.label === "string"
                      ? option.label
                      : `Option ${index + 1}`;
                  return (
                    <ControlOption
                      key={value}
                      title={value}
                      selected={answers[id] === value}
                      onPress={() => setAnswers((current) => ({ ...current, [id]: value }))}
                    />
                  );
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
          <Text style={styles.menuActionTitle}>
            {field.label}
            {field.required ? " *" : ""}
          </Text>
          {field.description !== null && (
            <Text style={styles.menuActionSubtitle}>{field.description}</Text>
          )}
          {field.options.length > 0 ? (
            <ScrollView horizontal contentContainerStyle={styles.answerOptions}>
              {field.options.map((option) => (
                <ControlOption
                  key={option.value}
                  title={option.label}
                  selected={(answers[field.id] ?? field.defaultValue) === option.value}
                  onPress={() =>
                    setAnswers((current) => ({ ...current, [field.id]: option.value }))
                  }
                />
              ))}
            </ScrollView>
          ) : (
            <TextInput
              accessibilityLabel={`Answer ${field.label}`}
              keyboardType={
                field.type === "number" || field.type === "integer" ? "numeric" : "default"
              }
              value={answers[field.id] ?? field.defaultValue}
              onChangeText={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
              style={styles.approvalInput}
            />
          )}
        </View>
      ))}
      {elicitationUrl !== null && (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(elicitationUrl)}>
          <Text numberOfLines={2} style={styles.rawLink}>
            Open secure form · {elicitationUrl}
          </Text>
        </Pressable>
      )}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.approvalActions}>
        {method === "item/tool/requestUserInput" ? (
          <Pressable
            accessibilityRole="button"
            disabled={waiting}
            hitSlop={4}
            onPress={() =>
              void respond({
                answers: Object.fromEntries(
                  questions.map((question) => {
                    const id = typeof question.id === "string" ? question.id : "question";
                    return [id, { answers: [answers[id] ?? ""] }];
                  }),
                ),
              })
            }
            style={[styles.primaryButton, styles.approvalButton]}
          >
            <Text style={styles.primaryButtonText}>Submit</Text>
          </Pressable>
        ) : method === "item/permissions/requestApproval" ? (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() => void respond({ permissions: {}, scope: "turn" })}
              style={[styles.approvalDeclineButton, styles.approvalButton]}
            >
              <Text style={styles.approvalDeclineText}>Decline</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() => void respond({ permissions: params.permissions ?? {}, scope: "turn" })}
              style={[styles.primaryButton, styles.approvalButton]}
            >
              <Text style={styles.primaryButtonText}>Allow turn</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() =>
                void respond({ permissions: params.permissions ?? {}, scope: "session" })
              }
              style={[styles.secondaryButton, styles.approvalButton]}
            >
              <Text style={styles.secondaryButtonText}>For session</Text>
            </Pressable>
          </>
        ) : method === "mcpServer/elicitation/request" ? (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() => void respond({ action: "decline", content: null, _meta: null })}
              style={[styles.approvalDeclineButton, styles.approvalButton]}
            >
              <Text style={styles.approvalDeclineText}>Decline</Text>
            </Pressable>
            {(elicitationFields.length > 0 || elicitationUrl !== null) && (
              <Pressable
                accessibilityRole="button"
                disabled={waiting}
                hitSlop={4}
                onPress={
                  elicitationMode === "url"
                    ? () => void respond({ action: "accept", content: null, _meta: null })
                    : submitElicitation
                }
                style={[styles.primaryButton, styles.approvalButton]}
              >
                <Text style={styles.primaryButtonText}>
                  {elicitationMode === "url" ? "Done" : "Submit"}
                </Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() => void respond({ decision: "decline" })}
              style={[styles.approvalDeclineButton, styles.approvalButton]}
            >
              <Text style={styles.approvalDeclineText}>Decline</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() => void respond({ decision: "accept" })}
              style={[styles.primaryButton, styles.approvalButton]}
            >
              <Text style={styles.primaryButtonText}>Accept once</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={waiting}
              hitSlop={4}
              onPress={() => void respond({ decision: "acceptForSession" })}
              style={[styles.secondaryButton, styles.approvalButton]}
            >
              <Text style={styles.secondaryButtonText}>For session</Text>
            </Pressable>
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
      {!embedded && tunnel === null && (
        <View style={styles.previewHeader}>
          <Pressable
            accessibilityLabel="Close localhost preview"
            onPress={close}
            style={styles.headerIcon}
          >
            <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
          </Pressable>
          <View style={styles.previewIdentity}>
            <Text numberOfLines={1} style={styles.conversationTitle}>
              Localhost preview
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.conversationSubtitle}>
              Explicit server-scoped tunnel
            </Text>
          </View>
          {tunnel !== null && (
            <View style={styles.livePill}>
              <Text style={styles.livePillText}>● LIVE</Text>
            </View>
          )}
        </View>
      )}
      {tunnel === null ? (
        <View style={styles.previewSetup}>
          <Ionicons name="globe-outline" size={iconSize.illustration} color={colors.accent} />
          <Text style={styles.sheetTitle}>Open a bounded localhost tunnel</Text>
          <Text style={styles.menuNotice}>
            Only 127.0.0.1 on the selected Codex server is reachable. The tunnel expires
            automatically.
          </Text>
          <Text style={styles.fieldLabel}>Local service</Text>
          <TextInput
            voiceInput={false}
            accessibilityLabel="Local service"
            autoCapitalize="none"
            autoCorrect={false}
            value={target}
            onChangeText={setTarget}
            placeholder="localhost:3000"
            placeholderTextColor={colors.textDim}
            style={styles.fieldInput}
          />
          <Text style={styles.fieldLabel}>Keep open</Text>
          <View style={styles.tunnelTtlChoices}>
            {[
              { label: "5 min", value: "300" },
              { label: "15 min", value: "900" },
              { label: "1 hour", value: "3600" },
            ].map((choice) => (
              <Pressable
                key={choice.value}
                onPress={() => setTtl(choice.value)}
                style={[styles.tunnelTtlChip, ttl === choice.value && styles.tunnelTtlChipSelected]}
              >
                <Text style={styles.composerContextText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Tunnel TTL"
            keyboardType="number-pad"
            value={ttl}
            onChangeText={setTtl}
            style={styles.fieldInput}
          />
          {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open localhost tunnel"
            disabled={loading}
            onPress={() => void create()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{loading ? "Opening…" : "Open preview"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.flex}>
          {error !== null && <Text style={styles.previewError}>{error}</Text>}
          <InternalBrowser
            url={tunnel.url}
            headers={{ Authorization: tunnel.authorization }}
            {...(!embedded
              ? {
                  header: {
                    title: "Localhost preview",
                    closeLabel: "Close localhost preview",
                    status: "LIVE",
                    onClose: close,
                  },
                }
              : {})}
            originWhitelist={[new URL(tunnel.url).origin]}
            onHttpError={(statusCode) =>
              setError(
                statusCode === 502
                  ? "Nothing is listening on that local service"
                  : `Preview returned HTTP ${statusCode}`,
              )
            }
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
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("Port must be between 1 and 65535");
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
  const insideBubbleSurface = useInsideBubbleSurface();
  const itemKey = useContext(ExpansionItemKeyContext);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:card`, initiallyExpanded);
  const forceExpanded = useContext(ForceExpandCardsContext);
  const activeToolCall = useContext(ActiveToolCallContext);
  const isRunning = status === "inProgress" || status === "running" || activeToolCall;
  const visiblyExpanded = forceExpanded || expanded;
  return (
    <View
      testID="protocol-card"
      collapsable={false}
      style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}
    >
      <View testID="protocol-card-header" collapsable={false} style={styles.cardHeader}>
        <Pressable
          accessibilityRole={collapsible ? "button" : undefined}
          accessibilityLabel={
            collapsible ? `${visiblyExpanded ? "Collapse" : "Expand"} ${title}` : undefined
          }
          disabled={!collapsible}
          hitSlop={collapsible ? 10 : undefined}
          onPress={() => setExpanded(!visiblyExpanded)}
          style={styles.cardHeaderToggle}
        >
          <View testID="protocol-card-icon" style={styles.cardIconSlot}>
            <InlineIcon name={icon} role="label" color={colors.textMuted} />
          </View>
          {isRunning ? (
            <WaveText
              key="running-title"
              text={title}
              style={styles.cardTitle}
              containerStyle={styles.cardTitleWave}
            />
          ) : (
            <Text key="settled-title" numberOfLines={1} style={styles.cardTitle}>
              {title}
            </Text>
          )}
          <View style={styles.flex} />
          {headerMeta}
          {status && !isRunning && (
            <View accessible accessibilityLabel={`Status ${status}`} style={styles.cardStatusIcon}>
              {status === "failed" || status === "error" ? (
                <InlineIcon name="alert-circle" role="label" color={colors.red} />
              ) : (
                <View style={styles.cardStatusDot} />
              )}
            </View>
          )}
          {collapsible && (
            <InlineIcon
              name={visiblyExpanded ? "chevron-up" : "chevron-down"}
              role="label"
              color={colors.textDim}
            />
          )}
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
  const [value, setValueState] = useState(
    () => persistentExpansionStates.get(localKey) ?? initialValue,
  );
  const setValue = (next: boolean | ((current: boolean) => boolean)) => {
    setValueState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writePersistentExpansionState(localKey, resolved);
      return resolved;
    });
  };
  return [value, setValue];
}

function CopyButton({
  text,
  getText,
  compact = false,
}: {
  text?: string;
  getText?: () => string;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel="Copy"
      hitSlop={controlHitSlop.compact}
      onPress={() => void Clipboard.setStringAsync(getText?.() ?? text ?? "")}
      style={compact ? styles.copyButtonCompact : styles.copyButton}
    >
      <InlineIcon name="copy-outline" role="label" color={colors.textMuted} />
    </Pressable>
  );
}

interface MessageActionRailProps {
  readonly request: MessageActionMenuRequest;
}

function MessageActionRail(props: MessageActionRailProps) {
  const openMessageActions = useMessageActionMenu();
  const actionButtonRef = useRef<View>(null);
  const openActions = () => {
    actionButtonRef.current?.measureInWindow((pageX, pageY, width, height) => {
      openMessageActions(props.request, { pageX, pageY, width, height });
    });
  };
  return (
    <View style={styles.messageActionRail}>
      <Pressable
        ref={actionButtonRef}
        accessibilityRole="button"
        accessibilityLabel="Message actions"
        collapsable={false}
        hitSlop={controlHitSlop.compact}
        onPress={openActions}
        style={({ pressed }) => [styles.messageActionButton, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

interface OptimisticTurnProps {
  item: Extract<TimelineItem, { kind: "optimistic" }>;
  onRetry?(commandId: string): Promise<void>;
  getTransferAccess?: GetTransferAccess;
}

function OptimisticTurn(props: OptimisticTurnProps) {
  const { getTransferAccess, item, onRetry } = props;
  const failed = item.status === "failed";
  const deliveryLabel = failed
    ? "Failed"
    : item.status === "uncertain"
      ? "Checking delivery"
      : item.status === "appServerAccepted"
        ? "Running"
        : item.status === "companionAccepted"
          ? item.workspaceRequestId !== null && item.workspaceRequestId !== undefined
            ? "Preparing workspace"
            : "Accepted by Companion"
          : item.status === "sending"
            ? "Sending to Companion"
            : "Queued";
  const [retrying, setRetrying] = useState(false);
  const dialog = useAppDialog();
  const retry = () => {
    if (onRetry === undefined || retrying) return;
    setRetrying(true);
    void onRetry(item.id).catch((cause: unknown) => {
      setRetrying(false);
      dialog.alert(
        "Retry failed",
        cause instanceof Error ? cause.message : "Could not retry message",
      );
    });
  };
  return (
    <View testID="turn-group" style={styles.turnGroup}>
      <View style={styles.userTurnCluster}>
        <RecoverableRenderBoundary
          scope="bubble"
          label="Pending user message"
          context={`Delivery: ${item.id}`}
          resetKey={`${item.scope}:${item.id}`}
        >
          <ImagePreviewGroup id={`${item.scope}:${item.id}:user`}>
            <View
              accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
              style={styles.userMessageRow}
            >
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
                    pendingText={!failed}
                    {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  />
                </BubbleContent>
              </Bubble>
              <Text testID="user-message-time" style={styles.messageTime}>
                {formatClockTime(item.createdAt / 1_000)}
              </Text>
            </View>
          </ImagePreviewGroup>
        </RecoverableRenderBoundary>
        {failed ? (
          <View
            accessibilityLabel={`Message ${deliveryLabel.toLowerCase()}`}
            testID="optimistic-turn-footer"
            style={[styles.turnFooter, styles.turnFooterEnd]}
          >
            <View style={[styles.turnStatusDot, styles.turnStatusFailed]} />
            <Text style={styles.turnMetaText}>{deliveryLabel}</Text>
            {onRetry !== undefined && (
              <Pressable
                accessibilityLabel="Retry message"
                disabled={retrying}
                hitSlop={7}
                onPress={retry}
                style={({ pressed }) => [
                  styles.retryMessageButton,
                  pressed && styles.pressed,
                  retrying && styles.disabled,
                ]}
              >
                {retrying ? (
                  <CalmSpinner size={9} color={colors.textMuted} durationMs={1_400} />
                ) : (
                  <InlineIcon name="refresh" role="label" color={colors.accent} />
                )}
                <Text style={styles.retryMessageText}>Retry</Text>
              </Pressable>
            )}
          </View>
        ) : null}
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
  preTurnBlocks: RenderBlock[];
  compactionBlocks: RenderBlock[];
  latestAgentBlock: RenderBlock | null;
  liveActivityBlocks: RenderBlock[];
};

function projectTurnProjection(
  turn: Extract<TimelineItem, { kind: "turn" }>,
): CachedTurnProjection {
  const rawTurn = turn.turn;
  const renderWindow = selectTurnRenderWindow(rawTurn);
  const userBlocks = renderWindow.userItemIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const preTurnBlocks = renderWindow.preTurnActivityIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const compactionBlocks = renderWindow.compactionIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const latestAgentItem =
    renderWindow.latestAgentIndex < 0 ? undefined : rawTurn.items[renderWindow.latestAgentIndex];
  const latestAgentBlock =
    latestAgentItem === undefined
      ? null
      : projectThreadItem(turn, latestAgentItem, renderWindow.latestAgentIndex);
  const liveActivityBlocks = renderWindow.liveActivityIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  return {
    renderWindow,
    userBlocks,
    preTurnBlocks,
    compactionBlocks,
    latestAgentBlock,
    liveActivityBlocks,
  };
}

function preTurnBlockUsesDisclosure(block: RenderBlock): boolean {
  return block.body !== null || isToolActivityKind(block.kind);
}

function activitySegmentUsesDisclosure(
  part: Extract<TurnSequencePart, { kind: "activity" }>,
): boolean {
  const thinkingOnly =
    part.blocks.length > 0 && part.blocks.every((block) => block.kind === "reasoning");
  const agentNavigationOnly =
    part.blocks.length > 0 &&
    part.blocks.every(
      (block) => block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity",
    );
  return !thinkingOnly && !agentNavigationOnly;
}

function TurnTimelineItem({
  turn,
  agentDateLabel = null,
  compact,
  animateLiveUpdates,
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
  agentDateLabel?: string | null;
  compact: boolean;
  animateLiveUpdates: boolean;
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
  const beginContentReview = useContentReview();
  const searchFocus = useContext(SearchMessageFocus);
  const artifacts = projectAgentArtifacts(rawTurn);
  const {
    renderWindow,
    userBlocks,
    preTurnBlocks,
    compactionBlocks,
    latestAgentBlock,
    liveActivityBlocks,
  } = projectTurnProjection(turn);
  const searchMessageIndex =
    searchFocus === null
      ? -1
      : rawTurn.items.findIndex(
          (item) => item.id === searchFocus.itemId && item.type === "agentMessage",
        );
  const searchedAgentItem =
    searchMessageIndex < 0 || searchMessageIndex === renderWindow.latestAgentIndex
      ? undefined
      : rawTurn.items[searchMessageIndex];
  const searchedAgentBlock =
    searchedAgentItem === undefined
      ? null
      : projectThreadItem(turn, searchedAgentItem, searchMessageIndex);
  const liveActivityEntries = renderWindow.liveActivityIndexes.flatMap(
    (itemIndex, projectionIndex) => {
      const block = liveActivityBlocks[projectionIndex];
      return block === undefined ? [] : [{ index: itemIndex, block }];
    },
  );
  const liveActivitySequence =
    rawTurn.status === "inProgress"
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
  const latestAgentProjection =
    rawTurn.status === "inProgress" && latestAgentBlock !== null
      ? (liveMarkdownProjections.get(latestAgentBlock.key) ??
        projectCachedLiveMarkdown(latestAgentBlock.key, latestAgentBlock.body ?? ""))
      : null;
  if (latestAgentProjection !== null && latestAgentBlock !== null) {
    liveMarkdownProjections.set(latestAgentBlock.key, latestAgentProjection);
  }
  const visibleLatestAgentBlock =
    latestAgentProjection === null || latestAgentBlock === null
      ? latestAgentBlock
      : { ...latestAgentBlock, body: latestAgentProjection.visibleSource };
  const latestAgentTextReference = latestAgentBlock?.content?.fields["/text"];
  const hasGeneratedAgentResponse =
    (latestAgentBlock?.body ?? "").trim().length > 0 ||
    (latestAgentTextReference?.byteLength ?? 0) > 0;
  const copyText = latestAgentBlock?.body ?? "";
  const canForkThrough = rawTurn.status !== "inProgress" && onForkThroughTurn !== undefined;
  const agentReviewTarget: ContentReviewTarget | null =
    latestAgentBlock === null || !hasGeneratedAgentResponse
      ? null
      : {
          id: `agent-response:${latestAgentBlock.key}`,
          label: "Completed agent response",
          reference: latestAgentBlock.key,
        };
  const canReviewResponse = rawTurn.status !== "inProgress" && agentReviewTarget !== null;
  const showMessageActions = copyText !== "" || canForkThrough || canReviewResponse;
  const showEmptyResponsePlaceholder =
    rawTurn.status !== "inProgress" && !hasGeneratedAgentResponse && artifacts.length === 0;
  const completedActivityCount =
    rawTurn.status === "inProgress" ? 0 : completedActivityItemCount(rawTurn);
  const hasDisclosedBubbleActivity =
    preTurnBlocks.some(preTurnBlockUsesDisclosure) ||
    completedActivityCount > 0 ||
    visibleLiveActivitySequence.some(
      (part) =>
        part.kind === "collapsedActivity" ||
        (part.kind === "activity" && activitySegmentUsesDisclosure(part)),
    );
  const agentBubbleFill =
    artifacts.length > 0 ||
    hasDisclosedBubbleActivity ||
    (latestAgentTextReference?.byteLength ?? 0) > 0 ||
    (hasGeneratedAgentResponse && richMarkdownLayout(latestAgentBlock?.body ?? "") === "fill");
  const hasAgentContent =
    (rawTurn.status !== "inProgress"
      ? rawTurn.itemsView !== "full" ||
        completedActivityCount > 0 ||
        preTurnBlocks.length > 0 ||
        hasGeneratedAgentResponse
      : visibleLiveActivitySequence.length > 0 ||
        preTurnBlocks.length > 0 ||
        latestAgentBlock !== null) ||
    pendingRequest !== null ||
    showEmptyResponsePlaceholder ||
    artifacts.length > 0;

  return (
    <TurnUsageContext.Provider value={usage}>
      <PrivateAssetRecoveryProvider
        {...(onLoadItems === undefined ? {} : { recover: () => onLoadItems(turn.id) })}
      >
        <View testID="turn-group" style={styles.turnGroup}>
          {userBlocks.length > 0 && (
            <View style={styles.userTurnCluster}>
              <RecoverableRenderBoundary
                scope="bubble"
                label="User message"
                context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
                resetKey={`${turn.key}:user`}
              >
                <ImagePreviewGroup id={`${turn.key}:user`}>
                  <View style={styles.userMessageRow}>
                    <Bubble
                      variant="user"
                      testID="user-bubble"
                      errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
                      errorResetKey={`${turn.key}:user`}
                    >
                      <BubbleContent>
                        <View style={styles.userMessageContent}>
                          {userBlocks.map((block, index) => (
                            <SearchMessage key={`${block.key}:${index}`} itemId={block.raw.id}>
                              <View style={styles.userMessageBlock}>
                                <UserMessageContent
                                  content={
                                    Array.isArray(block.raw.content) ? block.raw.content : []
                                  }
                                  projectedAttachments={block.raw.codewideAttachments}
                                  {...(getTransferAccess === undefined
                                    ? {}
                                    : { getTransferAccess })}
                                />
                                <LargeContentControls
                                  block={block}
                                  {...(getTransferAccess === undefined
                                    ? {}
                                    : { getTransferAccess })}
                                />
                              </View>
                            </SearchMessage>
                          ))}
                        </View>
                      </BubbleContent>
                    </Bubble>
                    {rawTurn.startedAt !== null && (
                      <Text testID="user-message-time" style={styles.messageTime}>
                        {formatClockTime(rawTurn.startedAt)}
                      </Text>
                    )}
                  </View>
                </ImagePreviewGroup>
              </RecoverableRenderBoundary>
            </View>
          )}
          {compactionBlocks.length > 0 && (
            <PreTurnLifecycleRows
              blocks={compactionBlocks}
              turnStatus={rawTurn.status}
              turnKey={turn.key}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          )}
          {agentDateLabel === null ? null : <TimelineDateSeparator label={agentDateLabel} />}
          <RecoverableRenderBoundary
            scope="bubble"
            label="Agent message"
            context={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
            resetKey={`${turn.key}:agent`}
          >
            <ImagePreviewGroup id={`${turn.key}:agent`}>
              <View style={styles.agentMessageRow}>
                <Bubble
                  variant="agent"
                  fill={agentBubbleFill}
                  animateLayout={rawTurn.status === "inProgress" && animateLiveUpdates}
                  testID="codex-bubble"
                  errorContext={`Thread: ${turn.threadId}\nTurn: ${turn.id}`}
                  errorResetKey={`${turn.key}:agent`}
                  footer={
                    <TurnFooter
                      status={rawTurn.status}
                      durationMs={rawTurn.durationMs}
                      completedAt={rawTurn.completedAt}
                      usage={usage}
                      diff={projectedTurnMetadata(rawTurn)?.diff ?? ""}
                      changesTarget={{
                        connectionId: turn.connectionId,
                        threadId: turn.threadId,
                        turnId: turn.id,
                      }}
                    />
                  }
                >
                  <ArtifactImageReferences.Provider value={artifactImageReferences(artifacts)}>
                    <BubbleContent>
                      {preTurnBlocks.length > 0 && (
                        <PreTurnLifecycleRows
                          blocks={preTurnBlocks}
                          turnStatus={rawTurn.status}
                          turnKey={turn.key}
                          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                          {...(onFixUnsupportedBlock === undefined
                            ? {}
                            : { onFixUnsupportedBlock })}
                        />
                      )}
                      {rawTurn.status !== "inProgress" && (
                        <CompletedTurnHistory
                          item={turn}
                          compact={compact}
                          forceExpanded={forceExpanded}
                          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                          {...(onFixUnsupportedBlock === undefined
                            ? {}
                            : { onFixUnsupportedBlock })}
                          {...(onLoadItems === undefined ? {} : { onLoadItems })}
                        />
                      )}
                      {searchedAgentBlock !== null && (
                        <AgentResponseMarkdown
                          block={searchedAgentBlock}
                          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                        />
                      )}
                      {rawTurn.status !== "inProgress" &&
                        latestAgentBlock !== null &&
                        hasGeneratedAgentResponse && (
                          <AgentResponseMarkdown
                            block={latestAgentBlock}
                            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                            {...(latestAgentRef === undefined
                              ? {}
                              : { visibilityRef: latestAgentRef })}
                            {...(onLatestAgentLayout === undefined
                              ? {}
                              : { onVisibilityLayout: onLatestAgentLayout })}
                          />
                        )}
                      {rawTurn.status === "inProgress" &&
                        visibleLiveActivitySequence.map((part, index) =>
                          part.kind === "collapsedActivity" ? (
                            <CollapsedTurnActivity
                              key={`${part.key}:${index}`}
                              item={turn}
                              indexes={part.indexes}
                              compact={compact}
                              forceExpanded={forceExpanded}
                              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                              {...(onFixUnsupportedBlock === undefined
                                ? {}
                                : { onFixUnsupportedBlock })}
                            />
                          ) : part.kind === "agent" ? (
                            <LiveAgentResponse
                              key={`${part.key}:${index}`}
                              cacheKey={part.block.key}
                              fill={richMarkdownLayout(part.block.body ?? "") === "fill"}
                              projection={liveMarkdownProjections.get(part.block.key)!}
                              animateNew={animateLiveUpdates}
                              streamMetricKey={
                                animateLiveUpdates
                                  ? liveStreamMetricKey(
                                      turn.connectionId,
                                      turn.threadId,
                                      rawTurn.id,
                                      part.block.raw.id,
                                    )
                                  : null
                              }
                            />
                          ) : (
                            <TurnActivitySegment
                              key={`${part.key}:${index}`}
                              turnKey={turn.key}
                              part={part}
                              turnStatus={rawTurn.status}
                              animateNew={animateLiveUpdates}
                              compact={compact}
                              forceExpanded={forceExpanded}
                              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                              {...(onFixUnsupportedBlock === undefined
                                ? {}
                                : { onFixUnsupportedBlock })}
                            />
                          ),
                        )}
                      {artifacts.length > 0 && (
                        <View testID="agent-artifacts" style={styles.userMessageContent}>
                          <UserImageGallery
                            attachments={artifacts.filter(
                              (attachment) => attachment.kind === "image",
                            )}
                            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                          />
                          {artifacts.some((attachment) => attachment.kind !== "image") && (
                            <MessageAttachmentGrid>
                              {artifacts
                                .filter((attachment) => attachment.kind !== "image")
                                .map((attachment) => (
                                  <MessageAttachmentCard
                                    key={userMessageAttachmentReference(attachment)}
                                    attachment={attachment}
                                    {...(getTransferAccess === undefined
                                      ? {}
                                      : { getAccess: getTransferAccess })}
                                  />
                                ))}
                            </MessageAttachmentGrid>
                          )}
                        </View>
                      )}
                      {pendingRequest !== null && (
                        <ApprovalPrompt
                          key={pendingRequest.requestKey}
                          embedded
                          request={pendingRequest}
                          requestCount={pendingRequestCount}
                          {...(onRespondToRequest === undefined
                            ? {}
                            : { onRespond: onRespondToRequest })}
                        />
                      )}
                      {showEmptyResponsePlaceholder && (
                        <Text style={styles.agentPlaceholder}>
                          {rawTurn.status === "interrupted"
                            ? "Stopped before response was generated"
                            : "No response was generated"}
                        </Text>
                      )}
                      {!hasAgentContent && rawTurn.status === "inProgress" && (
                        <WaveText
                          testID="turn-thinking-placeholder"
                          text="Thinking"
                          style={styles.agentPlaceholder}
                        />
                      )}
                    </BubbleContent>
                  </ArtifactImageReferences.Provider>
                </Bubble>
                {showMessageActions && (
                  <MessageActionRail
                    request={{
                      copyText,
                      ...(canForkThrough && onForkThroughTurn !== undefined
                        ? { onFork: () => onForkThroughTurn(turn.id) }
                        : {}),
                      ...(canReviewResponse && agentReviewTarget !== null
                        ? {
                            onReview: async () => {
                              await beginContentReview({
                                kind: "response",
                                target: agentReviewTarget,
                              });
                            },
                          }
                        : {}),
                    }}
                  />
                )}
              </View>
            </ImagePreviewGroup>
          </RecoverableRenderBoundary>
        </View>
      </PrivateAssetRecoveryProvider>
    </TurnUsageContext.Provider>
  );
}

type LiveContentMode = "markdown" | "code";

function StableLiveTextSegment({
  text,
  mode,
  streaming = false,
  animateStreaming = streaming,
}: {
  text: string;
  mode: LiveContentMode;
  streaming?: boolean;
  animateStreaming?: boolean;
}) {
  return mode === "markdown" ? (
    <RichMarkdown source={text} streaming={streaming} animateStreaming={animateStreaming} />
  ) : (
    <Text selectable style={styles.codeLine}>
      {text}
    </Text>
  );
}

function AppendOnlyLiveContent({
  cacheKey,
  source,
  mode,
  streamMetricKey = null,
  markdownProjection,
  fill = false,
  animateNew = true,
}: {
  cacheKey: string;
  source: string;
  mode: LiveContentMode;
  streamMetricKey?: string | null;
  markdownProjection?: LiveMarkdownProjection;
  fill?: boolean;
  animateNew?: boolean;
}) {
  const singleMarkdownTree = mode === "markdown";
  const projection = markdownProjection ?? projectCachedLiveText(cacheKey, source);
  const visibleRemainder = markdownProjection?.visibleRemainder ?? projection.remainder;
  const visibleMarkdownSource = singleMarkdownTree
    ? (markdownProjection?.visibleSource ?? [...projection.segments, visibleRemainder].join(""))
    : "";
  return (
    <>
      <View
        testID={mode === "markdown" ? "live-agent-response" : "live-tool-output"}
        style={[
          styles.liveAgentResponse,
          (mode === "code" || fill) && styles.liveAgentResponseFill,
          mode === "markdown" && styles.liveMarkdownResponse,
        ]}
      >
        {singleMarkdownTree ? (
          visibleMarkdownSource === "" ? null : (
            <StreamingRevealSurface streamKey={cacheKey} animateNew={animateNew}>
              <StableLiveTextSegment
                text={visibleMarkdownSource}
                mode={mode}
                streaming
                animateStreaming={animateNew}
              />
            </StreamingRevealSurface>
          )
        ) : (
          <>
            {projection.segments.map((segment, index) => (
              <StableLiveTextSegment key={`${cacheKey}:${index}`} text={segment} mode={mode} />
            ))}
            {visibleRemainder !== "" && (
              <StableLiveTextSegment text={visibleRemainder} mode={mode} />
            )}
          </>
        )}
      </View>
      {streamMetricKey === null ? null : (
        <CommitOnChangeProbe
          scope={streamMetricKey}
          revision={source}
          onCommit={() => {
            if (source !== "") recordLiveRenderCommit(streamMetricKey);
          }}
        />
      )}
    </>
  );
}

function LiveAgentResponse({
  cacheKey,
  fill,
  projection,
  streamMetricKey,
  animateNew,
}: {
  cacheKey: string;
  fill: boolean;
  projection: LiveMarkdownProjection;
  streamMetricKey: string | null;
  animateNew: boolean;
}) {
  return (
    <AppendOnlyLiveContent
      cacheKey={cacheKey}
      source={projection.source}
      mode="markdown"
      streamMetricKey={streamMetricKey}
      markdownProjection={projection}
      fill={fill}
      animateNew={animateNew}
    />
  );
}

function PreTurnLifecycleRows({
  blocks,
  turnStatus,
  turnKey,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  blocks: RenderBlock[];
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  turnKey: string;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  return (
    <View testID="pre-turn-lifecycle" style={styles.preTurnLifecycleList}>
      {blocks.map((block) => {
        const lifecyclePhase = block.raw.codewideLifecyclePhase;
        const running =
          lifecyclePhase === "started" ||
          block.status === "inProgress" ||
          block.status === "running";
        const simpleStatus = !preTurnBlockUsesDisclosure(block);
        if (!simpleStatus) {
          return (
            <ExpansionItemKeyContext.Provider
              key={block.key}
              value={`${turnKey}:pre-turn:${block.key}`}
            >
              <View style={styles.preTurnLifecycleDetail}>
                <ProtocolBlock
                  block={block}
                  {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
                />
              </View>
            </ExpansionItemKeyContext.Provider>
          );
        }
        return (
          <View
            key={block.key}
            accessible
            accessibilityLabel={`${block.title}, ${running ? "running" : "completed"}`}
            testID="pre-turn-lifecycle-row"
            style={styles.preTurnLifecycleRow}
          >
            <View style={styles.preTurnLifecycleIcon}>
              {running && turnStatus === "inProgress" ? (
                <CalmSpinner size={10} color={colors.textMuted} durationMs={3_000} />
              ) : (
                <Ionicons
                  name="checkmark-circle-outline"
                  size={iconSize.inline}
                  color={colors.textMuted}
                />
              )}
            </View>
            {running && turnStatus === "inProgress" ? (
              <WaveText
                text={block.title}
                style={styles.preTurnLifecycleText}
                containerStyle={styles.preTurnLifecycleWave}
              />
            ) : (
              <Text numberOfLines={1} style={styles.preTurnLifecycleText}>
                {block.title}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
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
  const [expanded, setExpanded] = usePersistentExpansion(
    `${item.key}:prior-activity:${indexes[0] ?? "empty"}`,
    false,
  );
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
  const outputFootprint = activityOutputFootprint(
    indexes.flatMap((index) => {
      const rawItem = rawTurn.items[index];
      if (rawItem === undefined || rawItem.type !== "commandExecution") return [];
      const raw = rawItem as unknown as Record<string, unknown>;
      return [
        {
          raw,
          visibleOutput: typeof raw.aggregatedOutput === "string" ? raw.aggregatedOutput : "",
        },
      ];
    }),
  );

  return (
    <TurnActivity
      expanded={isExpanded}
      forceExpandCards={forceExpanded}
      label={`${turnActivityLabel(activityKinds, compact)} · ${indexes.length}`}
      outputFootprint={outputFootprint}
      onToggle={() => setExpanded(!isExpanded)}
    >
      {blocks.map((block, index) =>
        block.kind === "agentMessage" ? (
          <RichMarkdown key={`${block.key}:${index}`} source={block.body ?? ""} />
        ) : (
          <ExpansionItemKeyContext.Provider
            key={`${block.key}:${index}`}
            value={`${item.key}:${block.key}`}
          >
            <ProtocolBlock
              block={block}
              {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
              {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
            />
          </ExpansionItemKeyContext.Provider>
        ),
      )}
      {visibleBlockCount < indexes.length && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleBlockCount((current) => Math.min(indexes.length, current + 16))}
          style={styles.activityMoreButton}
        >
          <Text style={styles.activityMoreText}>
            Show {Math.min(16, indexes.length - visibleBlockCount)} more
          </Text>
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
  const requestedTurnRef = useRef<string | null>(null);
  const isExpanded = forceExpanded || expanded;
  const activityItems = selectTurnRenderWindow(rawTurn).collapsedActivityIndexes.flatMap(
    (index) => {
      const rawItem = rawTurn.items[index];
      return rawItem === undefined ? [] : [{ rawItem, index }];
    },
  );
  const metadataKinds = turnMetadataKinds(rawTurn);
  const activitySummary = projectedTurnMetadata(rawTurn)?.activity;
  const hasFullItems = rawTurn.itemsView === "full";
  const activityKinds = [
    ...(hasFullItems
      ? activityItems.map(({ rawItem }) => rawItem.type)
      : (activitySummary?.kinds ?? [])),
    ...metadataKinds,
  ];
  const activityCount = hasFullItems
    ? activityItems.length + metadataKinds.length
    : (activitySummary?.count ?? 0) + metadataKinds.length;
  const outputFootprint = hasFullItems
    ? activityOutputFootprint(
        activityItems.flatMap(({ rawItem }) => {
          if (rawItem.type !== "commandExecution") return [];
          const raw = rawItem as unknown as Record<string, unknown>;
          return [
            {
              raw,
              visibleOutput: typeof raw.aggregatedOutput === "string" ? raw.aggregatedOutput : "",
            },
          ];
        }),
      )
    : (activitySummary?.outputFootprint ?? null);
  const historyBlocks =
    !isExpanded || rawTurn.itemsView !== "full"
      ? []
      : activityItems.map(({ rawItem, index }) => projectThreadItem(item, rawItem, index));
  if (isExpanded && rawTurn.itemsView === "full") {
    historyBlocks.push(...turnMetadataBlocks(item.key, rawTurn));
  }
  const sequence = chronologicalTurnSequence(historyBlocks);
  const load = () => {
    if (
      requestedTurnRef.current === rawTurn.id ||
      rawTurn.itemsView === "full" ||
      onLoadItems === undefined
    )
      return;
    requestedTurnRef.current = rawTurn.id;
    setLoading(true);
    setError(null);
    void onLoadItems(rawTurn.id)
      .catch((cause: unknown) => {
        requestedTurnRef.current = null;
        setError(cause instanceof Error ? cause.message : "Could not load activity");
      })
      .finally(() => setLoading(false));
  };
  if (rawTurn.itemsView === "full" && activityCount === 0) return null;
  return (
    <TurnActivity
      compactHeader
      expanded={isExpanded}
      forceExpandCards={forceExpanded}
      loading={loading}
      outputFootprint={outputFootprint}
      label={
        loading
          ? "Loading activity…"
          : error !== null
            ? "Activity unavailable"
            : rawTurn.itemsView === "full"
              ? `${turnActivityLabel(activityKinds, compact)} · ${activityCount}`
              : activityCount > 0
                ? `${turnActivityLabel(activityKinds, compact)} · ${activityCount}`
                : "Activity"
      }
      onToggle={() => {
        const next = !isExpanded;
        setExpanded(next);
        if (next) load();
      }}
    >
      {error !== null && <Text style={styles.agentPlaceholder}>{error}</Text>}
      {sequence.map((part, index) =>
        part.kind === "agent" ? (
          <RichMarkdown key={`${part.key}:${index}`} source={part.block.body ?? ""} />
        ) : (
          <TurnActivitySegment
            key={`${part.key}:${index}`}
            turnKey={`${item.key}:completed-history`}
            part={part}
            turnStatus={rawTurn.status}
            animateNew={false}
            compact={compact}
            forceExpanded={forceExpanded}
            {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
            {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
          />
        ),
      )}
    </TurnActivity>
  );
}

function projectThreadItem(
  row: Extract<TimelineItem, { kind: "turn" }>,
  rawItem: Thread["turns"][number]["items"][number],
  index: number,
): RenderBlock {
  return toRenderBlock(
    normalizeThreadItem(connectionId(row.connectionId), row.threadId, row.turn.id, rawItem, index),
  );
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
  animateNew,
  compact,
  forceExpanded,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  turnKey: string;
  part: Extract<TurnSequencePart, { kind: "activity" }>;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  animateNew: boolean;
  compact: boolean;
  forceExpanded: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const motionAllowed = useContext(TimelineMotionContext);
  const thinkingOnly =
    part.blocks.length > 0 && part.blocks.every((block) => block.kind === "reasoning");
  const agentNavigationOnly =
    part.blocks.length > 0 &&
    part.blocks.every(
      (block) => block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity",
    );
  const shouldAutoExpand = turnStatus === "inProgress" && !part.followedByAgent;
  const [expanded, setExpanded] = usePersistentExpansion(`${turnKey}:${part.key}`, false);
  const visiblyExpanded = forceExpanded || shouldAutoExpand || expanded;
  if (thinkingOnly) {
    return (
      <View testID="thinking-status-section" style={styles.thinkingStatusSection}>
        {part.blocks.map((block, index) => (
          <ActiveToolCallContext.Provider
            key={block.key}
            value={turnStatus === "inProgress" && index === part.blocks.length - 1}
          >
            <ProtocolBlock block={block} />
          </ActiveToolCallContext.Provider>
        ))}
      </View>
    );
  }
  if (agentNavigationOnly) {
    return (
      <View testID="subagent-activity-navigation" style={styles.turnActivityList}>
        {part.blocks.map((block) => (
          <ExpansionItemKeyContext.Provider key={block.key} value={`${turnKey}:${block.key}`}>
            <NativeRevealSurface
              revealKey={`${turnKey}:${block.key}`}
              animate={animateNew && motionAllowed && turnStatus === "inProgress"}
            >
              <ProtocolBlock
                block={block}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            </NativeRevealSurface>
          </ExpansionItemKeyContext.Provider>
        ))}
      </View>
    );
  }
  return (
    <TurnActivity
      expanded={visiblyExpanded}
      forceExpandCards={forceExpanded}
      label={turnActivityLabel(
        part.blocks.map((block) => block.kind),
        compact,
      )}
      outputFootprint={activityOutputFootprint(
        part.blocks.flatMap((block) =>
          block.kind === "commandExecution" ? [{ raw: block.raw, visibleOutput: block.body }] : [],
        ),
      )}
      onToggle={() => setExpanded((value) => !value)}
      showToggle={!shouldAutoExpand}
    >
      {part.blocks.map((block, index) => (
        <ActiveToolCallContext.Provider
          key={block.key}
          value={shouldAutoExpand && index === part.blocks.length - 1}
        >
          <ExpansionItemKeyContext.Provider value={`${turnKey}:${block.key}`}>
            <NativeRevealSurface
              revealKey={`${turnKey}:${block.key}`}
              animate={animateNew && motionAllowed && turnStatus === "inProgress"}
            >
              <ProtocolBlock
                block={block}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
              />
            </NativeRevealSurface>
          </ExpansionItemKeyContext.Provider>
        </ActiveToolCallContext.Provider>
      ))}
    </TurnActivity>
  );
}

interface TurnActivityProps {
  children: React.ReactNode;
  compactHeader?: boolean;
  expanded: boolean;
  forceExpandCards?: boolean;
  label: string;
  loading?: boolean;
  onToggle(): void;
  outputFootprint?: OutputFootprintProjection | null;
  showToggle?: boolean;
}

function TurnActivity(props: TurnActivityProps) {
  const {
    children,
    compactHeader = false,
    expanded,
    forceExpandCards = false,
    label,
    loading = false,
    onToggle,
    outputFootprint = null,
    showToggle = true,
  } = props;
  return (
    <View
      testID="turn-activity"
      style={[
        styles.turnActivity,
        compactHeader && styles.turnActivityCompact,
        expanded && styles.turnActivityExpanded,
      ]}
    >
      {showToggle && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} activity ${label}`}
          hitSlop={10}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.turnActivityToggle,
            compactHeader && styles.turnActivityToggleCompact,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.activityIconSlot}>
            <InlineIcon name="construct-outline" role="label" color={colors.textMuted} />
          </View>
          {loading ? (
            <WaveText
              testID="turn-activity-loading-shimmer"
              text={label}
              style={styles.turnActivityLabel}
              containerStyle={styles.turnActivityLabelWave}
            />
          ) : (
            <Text numberOfLines={1} style={styles.turnActivityLabel}>
              {label}
            </Text>
          )}
          <OutputFootprintMetric footprint={outputFootprint} />
          <View style={styles.activityChevronSlot}>
            <InlineIcon
              name={expanded ? "chevron-up" : "chevron-down"}
              role="label"
              color={colors.textDim}
            />
          </View>
        </Pressable>
      )}
      {expanded && (
        <ForceExpandCardsContext.Provider value={forceExpandCards}>
          <TurnActivityContentContext.Provider value>
            <View
              testID="turn-activity-list"
              style={[styles.turnActivityList, !showToggle && styles.turnActivityListWithoutToggle]}
            >
              {children}
            </View>
          </TurnActivityContentContext.Provider>
        </ForceExpandCardsContext.Provider>
      )}
    </View>
  );
}

interface TurnFooterProps {
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  readonly durationMs: number | null;
  readonly completedAt: number | null;
  readonly usage?: TurnUsageProjection | null;
  readonly diff?: string;
  readonly changesTarget?: TurnChangesTarget;
}

function TurnFooter(props: TurnFooterProps) {
  const { status, durationMs, completedAt, usage = null, diff = "" } = props;
  const tokenUsage = usage?.turn.tokens ?? null;
  const estimatedCost = usage?.turn.cost ?? null;
  const canOpenChanges = useContext(TurnChangesContext) !== null;
  return (
    <MessageFooterRow
      time={completedAt === null ? null : formatClockTime(completedAt)}
      tokens={
        tokenUsage === null ? null : (
          <View
            accessible
            accessibilityLabel={`${tokenUsage.inputTokens.toLocaleString()} input tokens, ${tokenUsage.outputTokens.toLocaleString()} output tokens`}
            style={styles.turnTokenMetrics}
          >
            <Text numberOfLines={1} style={styles.turnMetaText}>
              {TOKEN_SYMBOL}
            </Text>
            {status === "inProgress" ? (
              <AnimatedNumber
                value={tokenUsage.inputTokens}
                format={compactNumberFormat}
                prefix="↓"
                style={styles.turnMetaText}
              />
            ) : (
              <Text numberOfLines={1} style={styles.turnMetaText}>
                ↓{compactNumber(tokenUsage.inputTokens)}
              </Text>
            )}
            {status === "inProgress" ? (
              <AnimatedNumber
                value={tokenUsage.outputTokens}
                format={compactNumberFormat}
                prefix="↑"
                style={styles.turnMetaText}
              />
            ) : (
              <Text numberOfLines={1} style={styles.turnMetaText}>
                ↑{compactNumber(tokenUsage.outputTokens)}
              </Text>
            )}
          </View>
        )
      }
      cost={
        estimatedCost === null ? null : (
          <CostBreakdownPopover estimate={estimatedCost} animated={status === "inProgress"} />
        )
      }
      changes={
        canOpenChanges && diff.trim() !== "" && props.changesTarget !== undefined ? (
          <TurnChangesFooter diff={diff} target={props.changesTarget} />
        ) : null
      }
    >
      <MessageFooterStatus>
        {status === "inProgress" ? (
          <CalmSpinner size={9} color={colors.textMuted} durationMs={3_000} />
        ) : (
          <View
            accessible
            accessibilityLabel={
              status === "completed" ? "Completed" : status === "interrupted" ? "Stopped" : "Failed"
            }
            style={[
              styles.turnStatusDot,
              status === "failed"
                ? styles.turnStatusFailed
                : status === "interrupted"
                  ? styles.turnStatusStopped
                  : styles.turnStatusCompleted,
            ]}
          />
        )}
        {status === "inProgress" ? (
          <Text numberOfLines={1} testID="running-turn-footer-label" style={styles.turnMetaText}>
            Running
          </Text>
        ) : status === "completed" ? null : (
          <Text numberOfLines={1} style={styles.turnMetaText}>
            {status === "interrupted" ? "Stopped" : "Failed"}
          </Text>
        )}
      </MessageFooterStatus>
      {durationMs !== null && (
        <Text numberOfLines={1} style={styles.turnMetaText}>
          {formatDuration(durationMs)}
        </Text>
      )}
    </MessageFooterRow>
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
  if (kinds.some((kind) => kind === "fileChange" || kind === "turnDiff" || kind === "diff"))
    labels.push("Edited files");
  if (kinds.some((kind) => kind === "commandExecution" || kind === "terminal"))
    labels.push("ran commands");
  if (kinds.some((kind) => kind === "webSearch")) labels.push("searched web");
  if (kinds.some((kind) => kind === "mcpToolCall" || kind === "dynamicToolCall" || kind === "tool"))
    labels.push("used tools");
  if (kinds.some((kind) => kind === "collabAgentToolCall" || kind === "subAgentActivity"))
    labels.push("coordinated agents");
  if (compact) {
    const shortLabels = labels
      .slice(0, 2)
      .map((label) => (label === "coordinated agents" ? "agents" : label));
    return `${shortLabels.length === 0 ? "Activity" : shortLabels.join(", ")} · ${kinds.length}`;
  }
  if (labels.length === 0)
    return `${kinds.length} ${kinds.length === 1 ? "activity" : "activities"}`;
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
        <UserMessageContent
          content={content}
          projectedAttachments={block.raw.codewideAttachments}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
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
        <SearchMessage itemId={block.raw.id}>
          <CompleteAgentMarkdown
            source={block.body ?? ""}
            reviewTarget={reviewTarget}
            streamKey={block.key}
          />
        </SearchMessage>
        <MemoryCitationList value={block.raw.memoryCitation} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </View>
    );
  }
  if (block.kind === "tokenUsage") return <TokenUsageProtocolBlock block={block} />;
  if (block.kind === "commandExecution")
    return (
      <CommandExecutionProtocolBlock
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    );
  if (block.kind === "fileChange")
    return (
      <>
        <FileChangeProtocolBlock block={block} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  if (block.kind === "mcpToolCall" || block.kind === "dynamicToolCall")
    return (
      <>
        <ToolCallProtocolBlock
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  if (block.kind === "webSearch")
    return (
      <>
        <WebSearchProtocolBlock block={block} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  if (block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity")
    return (
      <>
        <AgentActivityProtocolBlock block={block} />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  if (block.kind === "imageView" || block.kind === "imageGeneration") {
    return (
      <>
        <ImageProtocolBlock
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  }
  if (block.kind === "unknown")
    return (
      <>
        <UnknownProtocolBlock
          block={block}
          {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
        />
        <LargeContentControls
          block={block}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      </>
    );
  const displayTitle =
    block.kind === "reasoning"
      ? reasoningActivityTitle(block.body, activeToolCall ? "inProgress" : block.status)
      : block.title;
  if (block.kind === "reasoning") {
    const running = activeToolCall || block.status === "inProgress" || block.status === "running";
    return (
      <View
        testID="thinking-status"
        style={[styles.thinkingStatus, insideTurnActivity && styles.thinkingStatusInActivity]}
      >
        <View style={styles.cardIconSlot}>
          <InlineIcon name="bulb-outline" role="label" color={colors.textMuted} />
        </View>
        {running ? (
          <WaveText
            text={displayTitle}
            style={styles.cardTitle}
            containerStyle={styles.cardTitleWave}
          />
        ) : (
          <Text numberOfLines={1} style={styles.cardTitle}>
            {displayTitle}
          </Text>
        )}
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
      initiallyExpanded={
        !isToolActivityKind(block.kind) &&
        (block.status === "inProgress" || block.status === "running")
      }
    >
      {block.body !== null &&
        (block.kind === "reasoning" ||
        block.kind === "plan" ||
        block.kind === "turnPlan" ||
        block.kind === "hookPrompt" ? (
          <RichMarkdown source={block.body} />
        ) : (
          <ProtocolBody
            body={block.body}
            code={block.kind === "fileChange" || block.kind === "turnDiff"}
            collapsible={block.collapsible}
            {...(block.kind === "turnDiff" || block.kind === "fileChange"
              ? { codeVariant: "diff" as const, language: "diff" }
              : {})}
          />
        ))}
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
      <LargeContentControls
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

function CommandExecutionProtocolBlock({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const activeToolCall = useContext(ActiveToolCallContext);
  const command = commandActivityInput(block.raw, block.title);
  const running = activeToolCall || block.status === "inProgress" || block.status === "running";
  const outputFootprint = commandOutputFootprint(block.raw, block.body ?? "");
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
        <NativeCodeBlock
          value={command}
          language="shellscript"
          maxHeight={TOOL_RESULT_MAX_HEIGHT}
          fillAvailableWidth
          truncate={false}
        />
      </View>
      <LazyCommandOutput
        block={block}
        running={running}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
      <LargeContentControls
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

interface LazyCommandOutputProps {
  readonly block: RenderBlock;
  readonly running: boolean;
  readonly getTransferAccess?: GetTransferAccess;
}

// Card mounts this child only while expanded: neither the resource nor its
// private-content requests exist for a collapsed command.
function LazyCommandOutput(props: LazyCommandOutputProps) {
  const scope = usePrivateFileAccessScope();
  const [byteLimit, setByteLimit] = useState(COMMAND_OUTPUT_PAGE_BYTES);
  const references = commandOutputReferences(props.block.raw);
  const getTransferAccess = props.getTransferAccess;
  const key =
    references.length === 0 || getTransferAccess === undefined
      ? null
      : `command-output:${scope}:${props.block.key}`;
  const revision = commandOutputRevision(references, byteLimit);
  const resource = useEphemeralAsyncResource<CommandOutputPage>(
    key,
    revision,
    async (_publish, signal) => {
      if (getTransferAccess === undefined)
        throw new Error("Command output connection is unavailable");
      return await readCommandOutput({ scope, references, byteLimit, getTransferAccess }, signal);
    },
    (value) => value.text.length * 2,
    true,
  );
  const body = resource.value?.text ?? props.block.body ?? "";
  return (
    <View style={styles.commandActivitySection}>
      <View style={styles.commandActivitySectionHeader}>
        <Text style={styles.commandActivitySectionLabel}>Output</Text>
        {body !== "" && <CopyButton text={body} compact />}
      </View>
      {body !== "" && (
        <ProtocolBody
          body={body}
          code
          collapsible={props.block.collapsible}
          expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
          section="output"
          codeVariant="terminal"
          showCopyAction={false}
        />
      )}
      {resource.status === "loading" && (
        <WaveText text="Loading output…" style={styles.menuNotice} />
      )}
      {resource.error !== null && <Text style={styles.errorText}>{resource.error}</Text>}
      {references.length > 0 && getTransferAccess === undefined && (
        <Text style={styles.errorText}>Command output connection is unavailable</Text>
      )}
      {body === "" && resource.status !== "loading" && resource.error === null && (
        <Text style={styles.menuNotice}>{props.running ? "Waiting for output…" : "No output"}</Text>
      )}
      {resource.value?.hasMore === true && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setByteLimit(byteLimit + COMMAND_OUTPUT_PAGE_BYTES)}
        >
          <Text style={styles.menuNotice}>Load more output</Text>
        </Pressable>
      )}
    </View>
  );
}

function OutputFootprintMetric({ footprint }: { footprint: OutputFootprintProjection | null }) {
  const usage = useContext(TurnUsageContext);
  if (footprint === null || footprint.estimatedTokens === 0) return null;
  const costUsd = estimatedOutputInputCostUsd(footprint, usage);
  const label =
    costUsd === null
      ? `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens`
      : `Estimated command output footprint ${footprint.estimatedTokens.toLocaleString()} tokens, ${formatEstimatedTurnCost(costUsd)} API-equivalent input cost`;
  const value = `≈${TOKEN_SYMBOL}${compactNumber(footprint.estimatedTokens)}${costUsd === null ? "" : ` · ≈${formatEstimatedTurnCost(costUsd)}`}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.outputFootprintMetric}>
      <Text numberOfLines={1} style={styles.outputFootprintMetricText}>
        {value}
      </Text>
    </View>
  );
}

const CONTENT_VIEW_CHUNK_BYTES = 64 * 1024;

function AgentResponseMarkdown({
  block,
  getTransferAccess,
  visibilityRef,
  onVisibilityLayout,
}: {
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
  const resourceKey =
    reference === null || getTransferAccess === undefined
      ? null
      : `complete-markdown:${resourceScope}:${reference.id}:${reference.byteLength}`;
  const resource = useAsyncResource<string[]>(
    resourceKey,
    resourceKey ?? "none",
    async (publish, signal) => {
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
        const projected = projectMarkdownStream(
          remainder,
          body,
          nextOffset >= reference.byteLength,
        );
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
    },
    markdownSegmentsWeight,
  );
  const segments = resource.value ?? [];
  const loading = resource.status === "loading";
  const error = resource.error;
  const fill =
    richMarkdownLayout(block.body ?? "") === "fill" ||
    segments.some((segment) => richMarkdownLayout(segment) === "fill");
  const documentStyle = [styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill];

  if (reference === null || segments.length === 0) {
    return (
      <View ref={visibilityRef} onLayout={onVisibilityLayout} style={documentStyle}>
        <SearchMessage itemId={block.raw.id}>
          <CompleteAgentMarkdown source={block.body ?? ""} reviewTarget={reviewTarget} />
        </SearchMessage>
        {loading && (
          <ActivityIndicator
            accessibilityLabel="Loading complete response"
            size="small"
            color={colors.textMuted}
          />
        )}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }
  return (
    <View ref={visibilityRef} onLayout={onVisibilityLayout} style={documentStyle}>
      {segments.map((segment, index) => (
        <RichMarkdown
          key={`${reference.id}:${index}`}
          source={segment}
          reviewTarget={reviewTarget}
          reviewPathPrefix={`segment-${index}`}
        />
      ))}
      <ContentReviewComments targetId={reviewTarget.id} />
      {loading && (
        <ActivityIndicator
          accessibilityLabel="Loading complete response"
          size="small"
          color={colors.textMuted}
        />
      )}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

function markdownSegmentsWeight(segments: string[]): number {
  return segments.reduce((bytes, segment) => bytes + segment.length * 2, 0);
}

function CompleteAgentMarkdown({
  source,
  reviewTarget,
  streamKey,
}: {
  source: string;
  reviewTarget?: ContentReviewTarget;
  streamKey?: string;
}) {
  const segments = projectCompleteMarkdown(source);
  const fill = richMarkdownLayout(source) === "fill";
  return (
    <View style={[styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill]}>
      {segments.map((segment, index) => {
        const content = (
          <RichMarkdown
            source={segment}
            {...(reviewTarget === undefined
              ? {}
              : { reviewTarget, reviewPathPrefix: `segment-${index}` })}
          />
        );
        return streamKey === undefined ? (
          <Fragment key={index}>{content}</Fragment>
        ) : (
          <StreamingRevealSurface
            key={index}
            streamKey={index === 0 ? streamKey : `${streamKey}:${index}`}
            animateNew={false}
          >
            {content}
          </StreamingRevealSurface>
        );
      })}
      {reviewTarget !== undefined && <ContentReviewComments targetId={reviewTarget.id} />}
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
    <LargeContentViewerContext.Provider value={open}>{children}</LargeContentViewerContext.Provider>
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
    async (_publish, signal) =>
      await readPrivateAssetText(
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

function LargeContentControls({
  block,
  getTransferAccess,
}: {
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
              if (getTransferAccess !== undefined)
                open?.({
                  pointer,
                  reference,
                  presentation: largeContentPresentation(pointer, reference),
                  getTransferAccess,
                });
            }}
            style={({ pressed }) => [styles.largeContentButton, pressed && styles.pressed]}
          >
            <InlineIcon name="document-text-outline" role="label" color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.largeContentButtonText}>
              {references.length === 1
                ? "Open full content"
                : `Open ${contentPointerLabel(pointer, index)}`}
            </Text>
            <Text style={styles.turnMetaText}>{formatContentBytes(reference.byteLength)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function largeContentPresentation(
  pointer: string,
  reference: RenderContentReference,
): LargeContentViewerRequest["presentation"] {
  if (reference.contentType.startsWith("text/markdown")) return "markdown";
  if (
    reference.contentType.startsWith("text/x-ansi") ||
    pointer === "/aggregatedOutput" ||
    pointer.endsWith("/aggregatedOutput")
  )
    return "terminal";
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
  const title =
    selection.pointer === "/" ? "Full output" : contentPointerLabel(selection.pointer, 0);
  const hasPrevious = selection.offset > 0;
  const hasNext =
    selection.nextOffset > selection.offset &&
    selection.nextOffset < selection.reference.byteLength;
  const rangeEnd = Math.max(selection.offset, selection.nextOffset);
  return (
    <View testID="full-content-viewer" style={styles.fullContentViewer}>
      <View style={styles.fullContentHeader}>
        <View style={styles.fullContentHeaderIcon}>
          <Ionicons name="terminal-outline" size={iconSize.navigation} color={colors.textMuted} />
        </View>
        <View style={styles.fullContentHeaderText}>
          <Text numberOfLines={1} style={styles.fullContentTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.fullContentMeta}>
            {selection.loading
              ? "Loading…"
              : `${selection.offset + 1}–${rangeEnd} / ${selection.reference.byteLength.toLocaleString()} bytes`}
          </Text>
        </View>
        {selection.text !== null && <CopyButton text={selection.text} />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close full output"
          onPress={onClose}
          style={styles.headerIcon}
        >
          <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
        </Pressable>
      </View>
      <View
        style={styles.fullContentViewport}
        onLayout={(event) => {
          const nextHeight = Math.floor(event.nativeEvent.layout.height);
          setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
        }}
      >
        {selection.loading ? (
          <View style={styles.fullContentCentered}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.menuNotice}>Loading full output…</Text>
          </View>
        ) : selection.error !== null ? (
          <View style={styles.fullContentCentered}>
            <Text style={styles.errorText}>{selection.error}</Text>
          </View>
        ) : selection.text !== null && viewportHeight > 0 ? (
          selection.presentation === "markdown" ? (
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator
              contentContainerStyle={styles.fullContentMarkdown}
            >
              <RichMarkdown source={selection.text} />
            </ScrollView>
          ) : Platform.OS === "android" ? (
            <NativeCodeBlock
              value={selection.text}
              language="text"
              variant={selection.presentation === "terminal" ? "terminal" : "code"}
              maxHeight={viewportHeight}
              embeddedInParentScroll={false}
              truncate={false}
            />
          ) : (
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                contentContainerStyle={styles.fullContentRawHorizontal}
              >
                <Text selectable style={styles.fullContentRawText}>
                  {selection.presentation === "terminal"
                    ? stripTerminalControlSequences(selection.text)
                    : selection.text}
                </Text>
              </ScrollView>
            </ScrollView>
          )
        ) : null}
      </View>
      <View style={styles.fullContentFooter}>
        <Text style={styles.fullContentFooterText}>
          {formatContentBytes(selection.reference.byteLength)}
        </Text>
        <View style={styles.largeContentPager}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous output page"
            disabled={!hasPrevious || selection.loading}
            onPress={onPrevious}
            style={[
              styles.largeContentPageButton,
              (!hasPrevious || selection.loading) && styles.disabled,
            ]}
          >
            <Ionicons name="chevron-back" size={iconSize.action} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next output page"
            disabled={!hasNext || selection.loading}
            onPress={onNext}
            style={[
              styles.largeContentPageButton,
              (!hasNext || selection.loading) && styles.disabled,
            ]}
          >
            <Ionicons name="chevron-forward" size={iconSize.action} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function contentPointerLabel(pointer: string, index: number): string {
  const segment = pointer.split("/").filter(Boolean).at(-1);
  return segment === undefined
    ? `content ${index + 1}`
    : segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function formatContentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UnknownProtocolBlock({
  block,
  onFixUnsupportedBlock,
}: {
  block: RenderBlock;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const insideBubbleSurface = useInsideBubbleSurface();
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
    <View style={[styles.unknownCard, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <Ionicons name="cube-outline" size={iconSize.action} color={colors.amber} />
      <View style={styles.flex}>
        <Text style={styles.unknownText}>Unsupported · {rawType}</Text>
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <CopyButton getText={() => protocolCopyText(block)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fix unsupported block ${rawType} in new thread`}
        disabled={busy || onFixUnsupportedBlock === undefined}
        onPress={() => void fix()}
        style={[
          styles.unknownFixButton,
          (busy || onFixUnsupportedBlock === undefined) && styles.disabled,
        ]}
      >
        <InlineIcon
          name={busy ? "hourglass-outline" : "construct-outline"}
          role="label"
          color={colors.onPrimary}
        />
        <Text style={styles.unknownFixText}>{busy ? "Starting" : "Fix"}</Text>
      </Pressable>
    </View>
  );
}

function TokenUsageProtocolBlock({ block }: { block: RenderBlock }) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const total = recordValue(block.raw.total);
  const last = recordValue(block.raw.last);
  const metrics: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: number | null;
  }> = [
    { icon: "speedometer-outline", label: "Total", value: numberValue(total.totalTokens) },
    { icon: "log-in-outline", label: "Input", value: numberValue(total.inputTokens) },
    { icon: "log-out-outline", label: "Output", value: numberValue(total.outputTokens) },
    { icon: "flash-outline", label: "Last turn", value: numberValue(last.totalTokens) },
    {
      icon: "scan-outline",
      label: "Context window",
      value: numberValue(block.raw.modelContextWindow),
    },
  ];
  return (
    <View style={[styles.tokenStrip, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <View style={styles.tokenStripTitle}>
        <InlineIcon name="speedometer-outline" role="label" color={colors.textMuted} />
        <Text style={styles.cardTitle}>Usage</Text>
      </View>
      <View style={styles.tokenMetrics}>
        {metrics.map((metric) =>
          metric.value === null ? null : (
            <View
              key={metric.label}
              accessible
              accessibilityLabel={`${metric.label}: ${metric.value.toLocaleString()} tokens`}
              style={styles.tokenMetric}
            >
              <InlineIcon name={metric.icon} role="label" color={colors.textMuted} />
              <Text style={styles.tokenMetricValue}>
                {TOKEN_SYMBOL}
                {compactNumber(metric.value)}
              </Text>
            </View>
          ),
        )}
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
  const imageContainerStyle = [
    variant === "user" ? styles.userImage : styles.generatedImage,
    containerStyle,
  ];
  if (resolvedSource === null) {
    return (
      <View style={imageContainerStyle}>
        {privateImage.failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry ${label}`}
            onPress={() => setRetryRevision((current) => current + 1)}
          >
            <Text style={styles.menuNotice}>Image preview failed · Retry</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={colors.textMuted} />
        )}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}`}
      onPress={() =>
        openImagePreview({ ...previewItem, source: resolvedSource, groupId: resolvedGroupId })
      }
      style={imageContainerStyle}
    >
      <Image
        accessibilityLabel={label}
        source={resolvedSource}
        resizeMode={variant === "user" ? "cover" : "contain"}
        resizeMethod="resize"
        style={styles.openableImage}
        onError={() => {
          setRetryRevision((current) => current + 1);
          onError?.();
        }}
      />
      <View style={styles.imageOpenBadge}>
        <InlineIcon name="expand-outline" role="label" color="#ffffff" />
      </View>
    </Pressable>
  );
}

function ImageProtocolBlock({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  return (
    <Card
      title={block.title}
      icon="image-outline"
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={block.status === "inProgress" || block.status === "running"}
    >
      <ImageProtocolContent
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

function ImageProtocolContent({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const gallery = useContext(ArtifactImageReferences);
  const localPath =
    block.kind === "imageView"
      ? typeof block.raw.path === "string"
        ? block.raw.path
        : null
      : typeof block.raw.savedPath === "string"
        ? block.raw.savedPath
        : null;
  const projectedAsset = privateImageAssetProjection(block.raw.codewideAsset);
  const remoteResult = safeImageUri(block.raw.result);
  const inGallery =
    block.kind === "imageGeneration" &&
    gallery !== null &&
    ((localPath !== null && gallery.has(localPath)) ||
      (projectedAsset !== null && gallery.has(`content:${projectedAsset.id}`)) ||
      (remoteResult !== null && gallery.has(remoteResult)));
  return (
    <>
      {inGallery ? (
        <Text style={styles.menuNotice}>Image attached to this response</Text>
      ) : projectedAsset !== null && getTransferAccess !== undefined ? (
        <ScopedPrivateAssetImage
          previewId={block.key}
          label={block.title}
          reference={`private-asset:${projectedAsset.id}`}
          source={{ kind: "content", id: projectedAsset.id }}
          getTransferAccess={getTransferAccess}
        />
      ) : localPath !== null && getTransferAccess !== undefined ? (
        <ScopedRemoteImage
          previewId={block.key}
          path={localPath}
          getTransferAccess={getTransferAccess}
        />
      ) : remoteResult !== null ? (
        <OpenableImage
          previewId={block.key}
          label={block.title}
          source={{ uri: remoteResult }}
          reference={remoteResult}
        />
      ) : (
        <Text style={styles.menuNotice}>
          {localPath === null ? "No preview was returned." : `Image · ${basename(localPath)}`}
        </Text>
      )}
      {block.kind === "imageGeneration" && typeof block.raw.revisedPrompt === "string" && (
        <RichMarkdown source={block.raw.revisedPrompt} />
      )}
    </>
  );
}

function ScopedRemoteImage({
  path,
  getTransferAccess,
  containerStyle,
  previewId,
  groupId,
  order,
}: {
  path: string;
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
  containerStyle?: StyleProp<ViewStyle>;
  previewId?: string;
  groupId?: string | null;
  order?: number;
}) {
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

function ScopedPrivateAssetImage({
  source: assetSource,
  label,
  reference,
  getTransferAccess,
  containerStyle,
  previewId,
  groupId,
  order,
}: {
  source: PrivateAssetSource;
  label: string;
  reference: string;
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
  containerStyle?: StyleProp<ViewStyle>;
  previewId?: string;
  groupId?: string | null;
  order?: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const downloadDocument = useDocumentDownload();
  const privateImage = usePrivateAssetUri(assetSource, attempt, getTransferAccess);
  if (privateImage.failed) {
    return (
      <View style={[styles.userImage, containerStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry ${label}`}
          onPress={() => setAttempt((current) => current + 1)}
        >
          <Text style={styles.menuNotice}>Image preview failed · Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (privateImage.source === null)
    return (
      <View style={[styles.userImage, containerStyle]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  return (
    <OpenableImage
      previewId={previewId ?? reference}
      label={label}
      source={privateImage.source}
      variant="user"
      reference={reference}
      {...(assetSource.kind !== "path"
        ? {}
        : {
            download: () =>
              downloadDocument({
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
    <Card
      title={`File changes · ${changeCount}`}
      icon="git-compare-outline"
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={false}
    >
      <FileChangeProtocolDetails block={block} />
    </Card>
  );
}

function FileChangeProtocolDetails({ block }: { block: RenderBlock }) {
  const changes = Array.isArray(block.raw.changes)
    ? block.raw.changes.filter(
        (change): change is Record<string, unknown> =>
          change !== null && typeof change === "object" && !Array.isArray(change),
      )
    : [];
  return (
    <>
      {changes.length === 0 ? (
        <Text style={styles.menuNotice}>No structured file changes were returned.</Text>
      ) : (
        changes.map((change, index) => (
          <DiffFile
            key={`${String(change.path ?? "file")}-${index}`}
            path={typeof change.path === "string" ? change.path : `File ${index + 1}`}
            kind={change.kind}
            diff={typeof change.diff === "string" ? change.diff : ""}
          />
        ))
      )}
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} diff ${path}`}
        onPress={() => setExpanded((value) => !value)}
        style={styles.diffFileHeader}
      >
        <InlineIcon
          name={expanded ? "chevron-down" : "chevron-forward"}
          role="label"
          color={colors.textMuted}
        />
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.diffFilePath}>
          {displayPath}
        </Text>
        <Text numberOfLines={1} style={styles.diffKind}>
          {projection.kind}
        </Text>
        <Text style={[styles.diffStat, styles.diffStatAdd]}>+{additions}</Text>
        <Text style={[styles.diffStat, styles.diffStatDelete]}>−{deletions}</Text>
        <CopyButton text={diff} compact />
      </Pressable>
      {expanded && (
        <View style={styles.diffLines}>
          <NativeCodeBlock
            value={projection.renderSource}
            language={nativeCodeLanguageForPath(path)}
            variant="diff"
            maxHeight={TOOL_RESULT_MAX_HEIGHT}
            fillAvailableWidth
          />
        </View>
      )}
    </View>
  );
}

function ToolCallProtocolBlock({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
  return (
    <Card
      title={block.title}
      icon="extension-puzzle-outline"
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={false}
    >
      <ToolCallProtocolDetails
        block={block}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    </Card>
  );
}

function ToolCallProtocolDetails({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
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
          <ProtocolBody
            body={progress.map((entry) => `• ${entry}`).join("\n")}
            code={false}
            collapsible
            section="progress"
          />
        </>
      )}
      <Text style={styles.controlSectionLabel}>Result</Text>
      <ToolCallResultContent
        block={block}
        section="result"
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
      {block.durationMs !== null && (
        <Text style={styles.turnMetaText}>{formatDuration(block.durationMs)}</Text>
      )}
    </>
  );
}

function ToolCallResultContent({
  block,
  section,
  getTransferAccess,
}: {
  block: RenderBlock;
  section: string;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
  if (block.kind === "dynamicToolCall") {
    const items = Array.isArray(block.raw.contentItems) ? block.raw.contentItems : [];
    return items.length === 0 ? (
      <LazyJsonProtocolBody value={{ success: block.raw.success }} section={section} />
    ) : (
      <ToolRichContent
        items={items}
        section={section}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    );
  }
  if (block.raw.error !== null && block.raw.error !== undefined)
    return <LazyJsonProtocolBody value={block.raw.error} section={section} />;
  const result = recordValue(block.raw.result);
  const items = Array.isArray(result.content) ? result.content : [];
  const appContext = recordValue(block.raw.appContext);
  const resourceUri = typeof appContext.resourceUri === "string" ? appContext.resourceUri : null;
  return (
    <>
      {resourceUri !== null && (
        <ToolResourceLink
          uri={resourceUri}
          label={typeof appContext.appName === "string" ? appContext.appName : "MCP App resource"}
        />
      )}
      {items.length > 0 ? (
        <ToolRichContent
          items={items}
          section={section}
          {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
        />
      ) : result.structuredContent === undefined ? (
        <LazyJsonProtocolBody value={block.raw.result ?? null} section={section} />
      ) : null}
      {result.structuredContent !== null && result.structuredContent !== undefined && (
        <>
          <Text style={styles.controlSectionLabel}>Structured result</Text>
          <ProtocolBody
            body={boundedJsonStringify(result.structuredContent)}
            code
            collapsible
            expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
            section="structured-result"
          />
        </>
      )}
    </>
  );
}

function ToolRichContent({
  items,
  section,
  getTransferAccess,
}: {
  items: unknown[];
  section: string;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
  return (
    <View style={styles.protocolBody}>
      {items.map((raw, index) => {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw))
          return <LazyJsonProtocolBody key={index} value={raw} section={`${section}:${index}`} />;
        const item = raw as Record<string, unknown>;
        const type = typeof item.type === "string" ? item.type : "unknown";
        if (type === "text" && typeof item.text === "string") {
          const terminal = containsTerminalControlSequences(item.text);
          return terminal || toolTextNeedsCodeViewport(item.text) ? (
            <ProtocolBody
              key={index}
              body={item.text}
              code
              collapsible
              expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
              section={`${section}:${index}`}
              {...(terminal ? { codeVariant: "terminal" as const } : {})}
            />
          ) : (
            <View key={index} style={styles.toolMarkdownResult}>
              <RichMarkdown source={item.text} />
            </View>
          );
        }
        if ((type === "inputText" || type === "input_text") && typeof item.text === "string")
          return (
            <ProtocolBody
              key={index}
              body={item.text}
              code
              collapsible
              expandedMaxHeight={TOOL_RESULT_MAX_HEIGHT}
              section={`${section}:${index}`}
            />
          );
        const projectedAsset = privateImageAssetProjection(item.codewideAsset);
        if (projectedAsset !== null && getTransferAccess !== undefined) {
          return (
            <ScopedPrivateAssetImage
              key={index}
              previewId={`tool-asset:${projectedAsset.id}`}
              label={`Tool image ${index + 1}`}
              reference={`private-asset:${projectedAsset.id}`}
              source={{ kind: "content", id: projectedAsset.id }}
              getTransferAccess={getTransferAccess}
            />
          );
        }
        if (
          (type === "inputImage" || type === "input_image") &&
          (typeof item.imageUrl === "string" || typeof item.image_url === "string")
        ) {
          const rawUri = typeof item.imageUrl === "string" ? item.imageUrl : String(item.image_url);
          const uri = safeImageUri(rawUri);
          return uri === null ? (
            <Text key={index} selectable style={styles.rawLink}>
              {rawUri}
            </Text>
          ) : (
            <OpenableImage
              key={index}
              previewId={`tool-image:${index}:${uri}`}
              label={`Tool image ${index + 1}`}
              source={{ uri }}
              reference={uri}
            />
          );
        }
        if (type === "image" && typeof item.data === "string") {
          const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
          const uri = safeImageUri(`data:${mimeType};base64,${item.data}`);
          return uri === null ? (
            <LazyJsonProtocolBody key={index} value={item} section={`${section}:${index}`} />
          ) : (
            <OpenableImage
              key={index}
              previewId={`mcp-image:${index}`}
              label={`MCP image ${index + 1}`}
              source={{ uri }}
              reference={`MCP image ${index + 1}`}
            />
          );
        }
        if (type === "resource_link" && typeof item.uri === "string")
          return (
            <ToolResourceLink
              key={index}
              uri={item.uri}
              label={
                typeof item.title === "string"
                  ? item.title
                  : typeof item.name === "string"
                    ? item.name
                    : "Resource"
              }
            />
          );
        if (type === "resource") {
          const resource = recordValue(item.resource);
          if (typeof resource.text === "string")
            return <RichMarkdown key={index} source={resource.text} />;
          if (typeof resource.uri === "string")
            return <ToolResourceLink key={index} uri={resource.uri} label="Embedded resource" />;
        }
        if (type === "inputAudio" || type === "audio") {
          const uri = typeof item.audioUrl === "string" ? item.audioUrl : null;
          const canOpen = uri !== null && isSafeHttpUrl(uri);
          return (
            <Pressable
              key={index}
              disabled={!canOpen}
              onPress={canOpen ? () => void Linking.openURL(uri) : undefined}
              style={styles.attachmentChip}
            >
              <InlineIcon name="volume-medium-outline" role="label" color={colors.textMuted} />
              <Text selectable numberOfLines={1} style={styles.attachmentText}>
                {uri ?? "Audio output"}
              </Text>
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
  if (
    /^(?:\s*[\[{]|\s*(?:diff --git|@@ |Traceback |Exception\b|Error:|stdout:|stderr:))/mu.test(
      value,
    )
  )
    return true;
  return false;
}

function containsTerminalControlSequences(value: string): boolean {
  return value.includes("\u001b[") || value.includes("\u009b") || value.includes("\u001b]");
}

function ToolResourceLink({ uri, label }: { uri: string; label: string }) {
  const canOpen = isSafeHttpUrl(uri);
  return (
    <Pressable
      disabled={!canOpen}
      onPress={canOpen ? () => void Linking.openURL(uri) : undefined}
      style={styles.searchResult}
    >
      <Text numberOfLines={1} style={styles.menuActionTitle}>
        {label}
      </Text>
      <Text selectable numberOfLines={2} style={styles.rawLink}>
        {uri}
      </Text>
    </Pressable>
  );
}

function MemoryCitationList({ value }: { value: unknown }) {
  const citation = recordValue(value);
  const entries = Array.isArray(citation.entries)
    ? citation.entries.flatMap((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry)
          ? [entry as Record<string, unknown>]
          : [],
      )
    : [];
  if (entries.length === 0) return null;
  return (
    <View style={styles.protocolBody}>
      <Text style={styles.controlSectionLabel}>Sources · {entries.length}</Text>
      {entries.map((entry, index) => {
        const path = typeof entry.path === "string" ? entry.path : `Source ${index + 1}`;
        const lineStart = numberValue(entry.lineStart);
        const lineEnd = numberValue(entry.lineEnd);
        const lines =
          lineStart === null
            ? ""
            : lineEnd === null || lineEnd === lineStart
              ? `:${lineStart}`
              : `:${lineStart}–${lineEnd}`;
        return (
          <View key={`${path}:${lineStart ?? index}`} style={styles.searchResult}>
            <Text selectable numberOfLines={1} ellipsizeMode="middle" style={styles.rawLink}>
              {path}
              {lines}
            </Text>
            {typeof entry.note === "string" && (
              <Text selectable style={styles.menuActionSubtitle}>
                {entry.note}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function WebSearchProtocolBlock({ block }: { block: RenderBlock }) {
  const query = typeof block.raw.query === "string" ? block.raw.query : "Search";
  return (
    <Card
      title={`Web search · ${query}`}
      icon="search-outline"
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={false}
    >
      <WebSearchProtocolDetails block={block} />
    </Card>
  );
}

function WebSearchProtocolDetails({ block }: { block: RenderBlock }) {
  const results = Array.isArray(block.raw.results)
    ? block.raw.results.filter(
        (result): result is Record<string, unknown> =>
          result !== null && typeof result === "object" && !Array.isArray(result),
      )
    : [];
  return (
    <>
      {results.length === 0 ? (
        <LazyJsonProtocolBody value={block.raw.action ?? block.raw} />
      ) : (
        results.map((result, index) => {
          const url =
            typeof result.url === "string" && isSafeHttpUrl(result.url) ? result.url : null;
          const title =
            typeof result.title === "string" ? result.title : (url ?? `Result ${index + 1}`);
          const snippet =
            typeof result.snippet === "string"
              ? result.snippet
              : typeof result.text === "string"
                ? result.text
                : null;
          return (
            <Pressable
              key={`${url ?? title}-${index}`}
              disabled={url === null}
              onPress={url === null ? undefined : () => void Linking.openURL(url)}
              style={styles.searchResult}
            >
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.menuActionTitle}>
                {title}
              </Text>
              {snippet !== null && (
                <Text numberOfLines={3} style={styles.menuActionSubtitle}>
                  {snippet}
                </Text>
              )}
              {url !== null && (
                <Text numberOfLines={1} style={styles.rawLink}>
                  {url}
                </Text>
              )}
            </Pressable>
          );
        })
      )}
    </>
  );
}

function LazyJsonProtocolBody({ value, section = "body" }: { value: unknown; section?: string }) {
  return <ProtocolBody body={boundedJsonStringify(value)} code collapsible section={section} />;
}

function AgentActivityProtocolBlock({ block }: { block: RenderBlock }) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const openSubagent = useContext(SubagentNavigationContext);
  const targetThreadId = subagentActivityTargetThreadId(
    block.raw as Thread["turns"][number]["items"][number],
  );
  const handlePress =
    targetThreadId === null || openSubagent === null
      ? undefined
      : () => openSubagent(targetThreadId);
  const canOpen = handlePress !== undefined;
  const path = typeof block.raw.agentPath === "string" ? block.raw.agentPath.trim() : "";
  const pathSegment = path.split("/").filter(Boolean).at(-1)?.replaceAll("_", " ") ?? "";
  const title = pathSegment || block.title || "Subagent";
  const activity = typeof block.raw.kind === "string" ? block.raw.kind : null;
  const activityLabel = activity === null ? "Subagent activity" : subagentActivityLabel(activity);
  const running = block.status === "inProgress" || block.status === "running";
  return (
    <View style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <View style={styles.cardHeader}>
        <Pressable
          testID="subagent-activity-link"
          {...(canOpen
            ? { accessibilityRole: "button" as const, accessibilityLabel: `Open subagent ${title}` }
            : {})}
          disabled={!canOpen}
          onPress={handlePress}
          hitSlop={controlHitSlop.compact}
          style={({ pressed }) => [styles.cardHeaderToggle, pressed && styles.pressed]}
        >
          <View style={styles.cardIconSlot}>
            <InlineIcon name="people-outline" role="label" color={colors.textMuted} />
          </View>
          {running ? (
            <WaveText text={title} style={styles.cardTitle} containerStyle={styles.cardTitleWave} />
          ) : (
            <Text numberOfLines={1} style={styles.cardTitle}>
              {title}
            </Text>
          )}
          <View style={styles.flex} />
          <Text numberOfLines={1} style={styles.agentActivityMeta}>
            {activityLabel}
          </Text>
          {block.status !== null && !running && (
            <View
              accessible
              accessibilityLabel={`Status ${block.status}`}
              style={styles.cardStatusIcon}
            >
              {block.status === "failed" || block.status === "error" ? (
                <InlineIcon name="alert-circle" role="label" color={colors.red} />
              ) : (
                <View style={styles.cardStatusDot} />
              )}
            </View>
          )}
          {canOpen && <InlineIcon name="chevron-forward" role="label" color={colors.textDim} />}
        </Pressable>
      </View>
    </View>
  );
}

function subagentActivityLabel(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  return spaced === ""
    ? "Subagent activity"
    : `${spaced[0]?.toUpperCase() ?? ""}${spaced.slice(1)}`;
}

interface UserMessageContentProps {
  content: unknown[];
  projectedAttachments?: unknown;
  localAttachments?: readonly ComposerAttachment[];
  pendingText?: boolean;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}

function UserMessageContent(props: UserMessageContentProps) {
  const {
    content,
    getTransferAccess,
    localAttachments = [],
    pendingText = false,
    projectedAttachments,
  } = props;
  const parts = content.flatMap((raw) =>
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? [raw as Record<string, unknown>]
      : [],
  );
  const attachments = projectUserMessageAttachments(
    content,
    projectedAttachments,
    localAttachments,
  );
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const otherAttachments = attachments.filter((attachment) => attachment.kind !== "image");
  const bodyParts = parts.filter(
    (part) =>
      !["image", "localImage", "audio", "localAudio", "mention"].includes(String(part.type ?? "")),
  );
  return (
    <View
      style={[
        styles.userMessageContent,
        imageAttachments.length > 0 && styles.userMessageMediaContent,
      ]}
    >
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
          return normalized.text === "" ? null : (
            <CollapsibleUserMessage
              key={index}
              text={normalized.text}
              partIndex={index}
              pending={pendingText}
            />
          );
        }
        const label =
          type === "skill" && typeof part.name === "string"
            ? `Skill · ${part.name}`
            : `Attachment · ${type}`;
        return (
          <View key={index} style={styles.attachmentChip}>
            <Ionicons name="attach-outline" size={iconSize.inline} color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.attachmentText}>
              {label}
            </Text>
          </View>
        );
      })}
      {otherAttachments.length > 0 && (
        <MessageAttachmentGrid>
          {otherAttachments.map((attachment) => (
            <MessageAttachmentCard
              key={`${attachment.kind}:${attachment.name}:${userMessageAttachmentReference(attachment)}`}
              attachment={attachment}
              {...(getTransferAccess === undefined ? {} : { getAccess: getTransferAccess })}
            />
          ))}
        </MessageAttachmentGrid>
      )}
    </View>
  );
}

interface CollapsibleUserMessageProps {
  partIndex: number;
  pending?: boolean;
  text: string;
}

function CollapsibleUserMessage(props: CollapsibleUserMessageProps) {
  const { partIndex, pending = false, text } = props;
  const highlighted = useContext(SearchHighlightQuery) !== "";
  const canCollapse =
    !highlighted &&
    (text.length > USER_MESSAGE_COLLAPSED_CHARS ||
      text.split("\n").length > USER_MESSAGE_COLLAPSED_LINES);
  const [expanded, setExpanded] = usePersistentExpansion(
    `user-message:${partIndex}:${textFingerprint(text)}`,
    false,
  );
  const maxLines = !expanded && canCollapse ? USER_MESSAGE_COLLAPSED_LINES : 0;
  return (
    <View style={styles.userMessageTextBlock}>
      {pending ? (
        <WaveText
          containerStyle={styles.pendingUserMessageShimmer}
          numberOfLines={maxLines}
          style={styles.userBubbleText}
          testID="pending-user-message-shimmer"
          text={text}
        />
      ) : (
        <RichMarkdown
          source={text}
          {...(!expanded && canCollapse ? { maxLines: USER_MESSAGE_COLLAPSED_LINES } : {})}
        />
      )}
      {canCollapse && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={styles.userMessageExpandButton}
        >
          <Text style={styles.userMessageExpandText}>
            {expanded ? "Collapse" : "Show full message"}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={iconSize.inline}
            color={colors.textMuted}
          />
        </Pressable>
      )}
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

function UserImageGallery({
  attachments,
  getTransferAccess,
}: {
  attachments: UserMessageAttachment[];
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
}) {
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
          return (
            <View key={index} style={[styles.userImage, containerStyle]}>
              <Text style={styles.menuNotice}>Attached image</Text>
            </View>
          );
        }
        if (source.type === "url") {
          return (
            <OpenableImage
              key={source.url}
              previewId={`user-image:${index}:${source.url}`}
              label={attachment.name}
              source={{ uri: source.url }}
              variant="user"
              containerStyle={containerStyle}
              order={index}
              reference={source.url}
            />
          );
        }
        if (source.type === "path") {
          return getTransferAccess === undefined ? (
            <View key={source.path} style={[styles.userImage, containerStyle]}>
              <Text style={styles.menuNotice}>{attachment.name}</Text>
            </View>
          ) : (
            <ScopedRemoteImage
              key={source.path}
              previewId={`user-local-image:${index}:${source.path}`}
              path={source.path}
              getTransferAccess={getTransferAccess}
              containerStyle={containerStyle}
              order={index}
            />
          );
        }
        if (source.type === "scoped") {
          return getTransferAccess === undefined ? (
            <View
              key={`${source.rootId}:${source.path}`}
              style={[styles.userImage, containerStyle]}
            >
              <Text style={styles.menuNotice}>{attachment.name}</Text>
            </View>
          ) : (
            <ScopedPrivateAssetImage
              key={`${source.rootId}:${source.path}`}
              previewId={`user-scoped-image:${source.rootId}:${source.path}`}
              label={attachment.name}
              reference={`scoped:${source.rootId}:${source.path}`}
              source={{ kind: "scoped", rootId: source.rootId, path: source.path }}
              getTransferAccess={getTransferAccess}
              containerStyle={containerStyle}
              order={index}
            />
          );
        }
        return (
          <View key={index} style={[styles.userImage, containerStyle]}>
            <Text style={styles.menuNotice}>Image preview unavailable</Text>
          </View>
        );
      })}
    </View>
  );
}

function protocolCopyText(block: RenderBlock): string {
  if (
    block.kind === "agentMessage" ||
    block.kind === "plan" ||
    block.kind === "turnPlan" ||
    block.kind === "turnDiff" ||
    block.kind === "reasoning" ||
    block.kind === "commandExecution"
  ) {
    return block.body ?? "";
  }
  if (block.kind === "userMessage") {
    const content = Array.isArray(block.raw.content) ? block.raw.content : [];
    return content
      .map((part) => {
        if (part === null || typeof part !== "object" || Array.isArray(part)) return "";
        const value = part as Record<string, unknown>;
        if (typeof value.text === "string") return normalizeUserMessage(value.text).text;
        if (typeof value.path === "string") return value.path;
        if (typeof value.url === "string") return value.url;
        if (typeof value.name === "string") return value.name;
        return JSON.stringify(value);
      })
      .filter(Boolean)
      .join("\n");
  }
  return boundedJsonStringify(block.raw, 96_000) || block.body || "";
}

function ProtocolBody({
  body,
  code,
  collapsible,
  expandedMaxHeight,
  section = "body",
  language = "text",
  codeVariant = "code",
  showCopyAction = true,
}: {
  body: string;
  code: boolean;
  collapsible: boolean;
  expandedMaxHeight?: number;
  section?: string;
  language?: string;
  codeVariant?: "code" | "diff" | "terminal";
  showCopyAction?: boolean;
}) {
  const itemKey = useContext(ExpansionItemKeyContext);
  const activeToolCall = useContext(ActiveToolCallContext);
  const collapsedLines = code ? 3 : 2;
  const bodyLines = body === "" ? 0 : body.split("\n").length;
  const canCollapse =
    collapsible && (body.length > COLLAPSED_BODY_CHARS || bodyLines > collapsedLines);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:body:${section}`, false);
  const limit = expanded ? EXPANDED_BODY_CHARS : COLLAPSED_BODY_CHARS;
  const bounded =
    expanded && body.length > limit
      ? `${body.slice(0, limit)}\n…`
      : activeToolCall && !expanded && canCollapse
        ? `…\n${body.slice(-COLLAPSED_BODY_CHARS)}`
        : body;
  const rendered =
    code && !expanded && canCollapse
      ? collapsedCodePreview(bounded, collapsedLines, activeToolCall)
      : bounded;
  const content = code ? (
    <NativeCodeBlock
      value={rendered}
      language={language}
      variant={codeVariant}
      maxHeight={expandedMaxHeight ?? TOOL_RESULT_MAX_HEIGHT}
      fillAvailableWidth
      {...(!expanded && canCollapse ? { maxVisibleLines: collapsedLines } : {})}
    />
  ) : activeToolCall && (expanded || !canCollapse) ? (
    <AppendOnlyLiveContent cacheKey={`${itemKey}:${section}`} source={rendered} mode="markdown" />
  ) : (
    <Text
      selectable
      numberOfLines={!expanded && canCollapse ? collapsedLines : undefined}
      style={styles.agentText}
    >
      {rendered}
    </Text>
  );
  return (
    <View style={styles.protocolBody}>
      {!code && expanded && expandedMaxHeight !== undefined ? (
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ maxHeight: expandedMaxHeight, flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ flexGrow: 0 }}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
      {canCollapse && (
        <View style={styles.protocolBodyActions}>
          <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
            <Text style={styles.rawLink}>
              {expanded
                ? "Show less"
                : `Show more · ${bodyLines.toLocaleString()} ${bodyLines === 1 ? "line" : "lines"}`}
            </Text>
          </Pressable>
          {showCopyAction && <CopyButton text={body} />}
        </View>
      )}
      {expanded && body.length > EXPANDED_BODY_CHARS && (
        <Text style={styles.menuNotice}>
          Rendering is capped for stability; Copy preserves the complete output.
        </Text>
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
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{ dismissLabel: "Close new thread", index: 0, enableDynamicSizing: true }}
    >
      <View style={styles.menuTitleRow}>
        <Text style={styles.sheetTitle}>Choose server</Text>
        <View style={styles.flex} />
      </View>
      <AppSheetScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuScrollContent}
      >
        {servers.map((server, index) => (
          <ControlOption
            key={server.id}
            position={listRowPosition(index, servers.length)}
            title={`${server.emoji} ${server.name}`}
            subtitle={
              busyServerId === server.id ? "Creating…" : connectionStateLabel(server.status)
            }
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
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (!saving) onClose();
  };
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      contentProps={{
        dismissLabel: "Close server pairing",
        enablePanDownToClose: !saving,
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <ConnectionSheetSession
        visible={visible}
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
  localReady: boolean;
  localError: string | null;
  onRetryStartup(): Promise<void>;
  onClose(): void;
  onSave(input: ConnectionInput): Promise<void>;
  initialCode: string | null;
  saving: boolean;
  setSaving(value: boolean): void;
}) {
  const openIdentity = visible ? (initialCode === null ? "manual" : `code:${initialCode}`) : null;
  const initialPairing = initialCode === null ? null : pairingParseResult(initialCode);
  const initialValue = initialPairing?.value ?? null;
  const [presentedOpenIdentity, setPresentedOpenIdentity] = useState(openIdentity);
  const [mode, setMode] = useState<"choose" | "review" | "manual" | "success">(
    initialValue === null ? "choose" : "review",
  );
  const [displayName, setDisplayName] = useState(initialValue?.displayName ?? "");
  const [emoji, setEmoji] = useState(initialValue?.emoji ?? "🖥️");
  const [endpoint, setEndpoint] = useState(initialValue?.endpoint ?? "");
  const [token, setToken] = useState(initialValue?.pairingToken ?? "");
  const [tlsPinSha256, setTlsPinSha256] = useState(initialValue?.tlsPinSha256 ?? "");
  const [expiresAt, setExpiresAt] = useState<number | null>(initialValue?.expiresAt ?? null);
  const [pairingParsedAt, setPairingParsedAt] = useState<number | null>(
    initialPairing?.parsedAt ?? null,
  );
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
    setPairingParsedAt(initialPairing?.parsedAt ?? null);
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
      setTlsPinSha256(pairing.tlsPinSha256);
      setExpiresAt(pairing.expiresAt);
      setPairingParsedAt(result.parsedAt);
      setError(null);
      setMode("review");
      return null;
    }
    setError(result.error);
    return result.error;
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
    const input: ConnectionInput = {
      displayName,
      emoji,
      endpoint,
      token,
      ...(tlsPinSha256.trim() === "" ? {} : { tlsPinSha256 }),
    };
    try {
      await onSave(input);
      setMode("success");
      await new Promise<void>((resolve) => setTimeout(resolve, 650));
      setSaving(false);
      onClose();
      return;
    } catch (cause) {
      setError(humanPairingError(cause));
    }
    setSaving(false);
  };
  const endpointLabel = pairingEndpointLabel(endpoint);
  const minutesLeft =
    expiresAt === null || pairingParsedAt === null
      ? null
      : Math.max(0, Math.ceil((expiresAt - pairingParsedAt) / 60_000));
  return (
    <AppSheetScrollView
      style={styles.connectionSheetScroll}
      contentContainerStyle={styles.connectionSheetContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pairingHeader}>
        {mode !== "choose" && mode !== "success" ? (
          <Pressable
            accessibilityLabel="Back to connection methods"
            hitSlop={8}
            onPress={() => {
              setMode("choose");
              setError(null);
            }}
            style={styles.pairingBack}
          >
            <Ionicons name="chevron-back" size={iconSize.action} color={colors.text} />
          </Pressable>
        ) : null}
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.pairingHeaderTitle}>
          {mode === "review"
            ? "Ready to connect"
            : mode === "manual"
              ? "Manual setup"
              : mode === "success"
                ? "Connected"
                : "Connect a server"}
        </Text>
      </View>

      {mode === "choose" && (
        <View style={styles.pairingBody}>
          <View style={styles.pairingHeroIcon}>
            <Ionicons name="link" size={iconSize.illustration} color={colors.primary} />
          </View>
          <Text style={styles.pairingLead}>
            Connect this phone to Codex running on another machine.
          </Text>
          <Text style={styles.pairingHint}>
            On the host, run <Text style={styles.pairingCode}>codewide-host pair</Text>. Then scan
            or paste the one-time link.
          </Text>
          <View style={styles.pairingActionStack}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan pairing QR"
              onPress={() => void openPairingScanner()}
              style={styles.pairingPrimaryAction}
            >
              <Ionicons
                name="qr-code-outline"
                size={iconSize.navigation}
                color={colors.onPrimary}
              />
              <Text style={styles.pairingPrimaryText}>Scan QR code</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Paste connection link"
              onPress={() => void pasteCode()}
              style={styles.pairingSecondaryAction}
            >
              <Ionicons name="clipboard-outline" size={iconSize.action} color={colors.text} />
              <Text style={styles.pairingSecondaryText}>Paste connection link</Text>
            </Pressable>
          </View>
          {error !== null && (
            <View style={styles.pairingError}>
              <Ionicons name="alert-circle-outline" size={iconSize.action} color={colors.red} />
              <Text style={[styles.errorText, styles.flex]}>{error}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open manual server setup"
            onPress={() => {
              setMode("manual");
              setError(null);
            }}
            style={styles.pairingTextAction}
          >
            <Text style={styles.pairingTextActionLabel}>Advanced manual setup</Text>
            <Ionicons name="chevron-forward" size={iconSize.inline} color={colors.textMuted} />
          </Pressable>
          <View style={styles.pairingSafety}>
            <Ionicons name="shield-checkmark-outline" size={iconSize.inline} color={colors.green} />
            <Text style={styles.pairingSafetyText}>
              One-time code · device-bound credentials · revocable access
            </Text>
          </View>
        </View>
      )}

      {mode === "review" && (
        <View style={styles.pairingBody}>
          <View style={styles.pairingReviewCard}>
            <View style={styles.pairingIdentityRow}>
              <TextInput
                voiceInput={false}
                accessibilityLabel="Server emoji"
                value={emoji}
                onChangeText={setEmoji}
                style={styles.pairingEmojiInput}
              />
              <TextInput
                accessibilityLabel="Server name"
                value={displayName}
                onChangeText={setDisplayName}
                selectTextOnFocus
                style={styles.pairingNameInput}
              />
            </View>
            <View style={styles.pairingServerMeta}>
              <Ionicons name="lock-closed-outline" size={iconSize.inline} color={colors.green} />
              <Text numberOfLines={1} ellipsizeMode="middle" style={styles.pairingEndpoint}>
                {endpointLabel}
              </Text>
            </View>
            <View style={styles.pairingServerMeta}>
              <Ionicons name="time-outline" size={iconSize.inline} color={colors.textMuted} />
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.pairingMetaText}>
                {minutesLeft === null
                  ? "One-time connection"
                  : `Code expires in ${minutesLeft} min`}
              </Text>
            </View>
          </View>
          {(error ?? localError) !== null && (
            <View style={styles.pairingError}>
              <Ionicons name="alert-circle-outline" size={iconSize.action} color={colors.red} />
              <Text style={[styles.errorText, styles.flex]}>{error ?? localError}</Text>
              {localError !== null && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry local startup"
                  hitSlop={8}
                  onPress={() => void onRetryStartup()}
                >
                  <Ionicons name="refresh" size={iconSize.action} color={colors.text} />
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connect server"
            disabled={saving || !localReady}
            onPress={() => void save()}
            style={[styles.pairingPrimaryAction, (saving || !localReady) && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Ionicons name="link" size={iconSize.action} color={colors.onPrimary} />
            )}
            <Text style={styles.pairingPrimaryText}>
              {saving
                ? "Securing this device…"
                : localReady
                  ? "Connect"
                  : localError === null
                    ? "Preparing local storage…"
                    : "Local storage unavailable"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit connection details"
            disabled={saving}
            onPress={() => setMode("manual")}
            style={styles.pairingTextAction}
          >
            <Text style={styles.pairingTextActionLabel}>Edit details</Text>
            <Ionicons name="options-outline" size={iconSize.inline} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {mode === "manual" && (
        <View style={styles.pairingBody}>
          <Text style={styles.pairingHint}>
            Use this only when QR and connection links are unavailable.
          </Text>
          <View style={styles.pairingIdentityFields}>
            <TextInput
              voiceInput={false}
              accessibilityLabel="Server emoji"
              value={emoji}
              onChangeText={setEmoji}
              style={styles.pairingEmojiInput}
            />
            <TextInput
              accessibilityLabel="Server name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Home workstation"
              placeholderTextColor={colors.textDim}
              style={[styles.fieldInput, styles.flex]}
            />
          </View>
          <Text style={styles.fieldLabel}>Secure endpoint</Text>
          <TextInput
            accessibilityLabel="Server endpoint"
            value={endpoint}
            onChangeText={setEndpoint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="wss://host.example/v1/sync"
            placeholderTextColor={colors.textDim}
            style={styles.fieldInput}
          />
          <Text style={styles.fieldLabel}>One-time pairing token</Text>
          <TextInput
            accessibilityLabel="One-time pairing token"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Paste token"
            placeholderTextColor={colors.textDim}
            style={styles.fieldInput}
          />
          <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
          <TextInput
            voiceInput={false}
            accessibilityLabel="TLS certificate pin"
            value={tlsPinSha256}
            onChangeText={setTlsPinSha256}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="sha256/base64…"
            placeholderTextColor={colors.textDim}
            style={styles.fieldInput}
          />
          {(error ?? localError) !== null && (
            <View style={styles.pairingError}>
              <Ionicons name="alert-circle-outline" size={iconSize.action} color={colors.red} />
              <Text style={[styles.errorText, styles.flex]}>{error ?? localError}</Text>
              {localError !== null && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry local startup"
                  hitSlop={8}
                  onPress={() => void onRetryStartup()}
                >
                  <Ionicons name="refresh" size={iconSize.action} color={colors.text} />
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connect server manually"
            disabled={saving || !localReady}
            onPress={() => void save()}
            style={[styles.pairingPrimaryAction, (saving || !localReady) && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Ionicons name="link" size={iconSize.action} color={colors.onPrimary} />
            )}
            <Text style={styles.pairingPrimaryText}>
              {saving
                ? "Securing this device…"
                : localReady
                  ? "Connect"
                  : localError === null
                    ? "Preparing local storage…"
                    : "Local storage unavailable"}
            </Text>
          </Pressable>
        </View>
      )}

      {mode === "success" && (
        <View style={styles.pairingSuccess}>
          <View style={styles.pairingSuccessIcon}>
            <Ionicons name="checkmark" size={iconSize.illustration} color={colors.onPrimary} />
          </View>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.pairingSuccessTitle}>
            {emoji} {displayName}
          </Text>
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
        <Pressable
          accessibilityLabel="Close QR scanner"
          onPress={onClose}
          style={styles.headerIcon}
        >
          <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
        </Pressable>
      </View>
      {permission === null ? (
        <View style={styles.emptyConversation}>
          <Text style={styles.emptyText}>Starting camera…</Text>
        </View>
      ) : permission.granted ? (
        <CameraView
          style={styles.scannerCamera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            scanned
              ? undefined
              : ({ data }) => {
                  setScanned(true);
                  const message = onScan(data);
                  if (message !== null) {
                    setScanError(message);
                    setTimeout(() => setScanned(false), 900);
                  }
                }
          }
        >
          <View style={styles.scannerFrame} />
          {scanError !== null && (
            <View style={styles.scannerError}>
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
          )}
        </CameraView>
      ) : (
        <View style={styles.emptyConversation}>
          <Text style={styles.emptyText}>
            Camera permission is required to scan the one-time pairing code.
          </Text>
          <Pressable
            onPress={() =>
              void (permission.canAskAgain
                ? requestPermission().then(setPermission)
                : Linking.openSettings())
            }
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              {permission.canAskAgain ? "Allow camera" : "Open settings"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function SubscribedConnectionSettings({ accountRateLimitsDatabase, ...props }:
  Omit<Parameters<typeof ConnectionSettings>[0], "accountRateLimits"> & {
    accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
  }) {
  const query = useLiveQuery(() => accountRateLimitsDatabase?.collection, [accountRateLimitsDatabase]);
  return <ConnectionSettings {...props} accountRateLimits={query.data ?? []} />;
}

function ConnectionSettings({
  connections,
  onClose,
  onAddServer,
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
  connections: StoredConnection[];
  onClose(): void;
  onAddServer(): void;
  onToggle(connectionId: string, enabled: boolean): Promise<void>;
  onReconnect(connectionId: string): Promise<void>;
  onDelete(connectionId: string): Promise<void>;
  onUpdate(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  onMove(connectionId: string, direction: -1 | 1): Promise<void>;
  accountRateLimits: AccountRateLimitsRow[];
  onRefreshAccountPool?(connectionId: string): Promise<AccountPoolSnapshot>;
  onStartAccountLogin?(
    connectionId: string,
  ): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelAccountLogin?(connectionId: string, loginId: string): Promise<void>;
  onActivateAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdateAccountProfile?(
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ): Promise<AccountPoolSnapshot>;
  onRemoveAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
}) {
  const appLock = useAppLockSettings();
  const uiGeneration = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  const [appLockSaving, setAppLockSaving] = useState(false);
  const [appLockError, setAppLockError] = useState<string | null>(null);
  const changeAppLock = useEvent(async (enabled: boolean) => {
    if (appLockSaving) return;
    setAppLockSaving(true);
    setAppLockError(null);
    try {
      await appLock.setEnabled(enabled);
    } catch (cause) {
      setAppLockError(cause instanceof Error ? cause.message : "Could not update app lock");
    }
    setAppLockSaving(false);
  });
  return (
    <SettingsSheet
      onClose={onClose}
      onAddServer={onAddServer}
      security={
        Platform.OS === "web" ? null : (
          <View testID="app-lock-setting">
            <AppListRow
              title="App lock"
              description="Use fingerprint, face or device authentication"
              fixedHeight={listRowHeight.double}
              leadingIcon={{ name: "finger-print", size: iconSize.action, color: colors.textMuted }}
              trailing={
                <>
                  {appLockSaving && <ActivityIndicator color={colors.textMuted} size="small" />}
                  <Switch
                    accessibilityLabel="Biometric app lock"
                    disabled={appLockSaving}
                    value={appLock.enabled}
                    onValueChange={changeAppLock}
                  />
                </>
              }
            />
            {appLockError !== null && (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {appLockError}
              </Text>
            )}
          </View>
        )
      }
      advanced={
        <>
          <SettingsSection title="Interface">
            <View testID="ui-generation-setting">
              <AppListRow
                title="Interface"
                description="Legacy"
                fixedHeight={listRowHeight.double}
                leadingIcon={{ name: "layers-outline", size: iconSize.action, color: colors.textMuted }}
              />
              {uiGeneration.status === "ready" ? (
                <UiGenerationControl current={uiGeneration.generation} />
              ) : (
                <ActivityIndicator
                  accessibilityLabel="Loading interface generation"
                  color={colors.textMuted}
                  size="small"
                />
              )}
            </View>
          </SettingsSection>
          <SettingsSection title="Experiments">
            <ComposerEditorTrialEntry />
          </SettingsSection>
          <SettingsSection title="Diagnostics">
            <PerformanceDiagnostics />
          </SettingsSection>
        </>
      }
      servers={connections.map((connection) => ({
        id: connection.id,
        title: connection.displayName,
        description: connectionStateLabel(connection.state, connection.enabled),
        leading: (
          <Text style={styles.serverEmoji}>
            {Platform.OS === "web"
              ? connection.displayName.slice(0, 1).toLocaleUpperCase()
              : connection.emoji}
          </Text>
        ),
        statusIcon:
          connection.enabled && connectionActivity(connection.state) !== null ? (
            <ConnectionActivityIndicator status={connection.state} size={iconSize.indicator} />
          ) : (
            <View
              style={[
                styles.connectionStateDot,
                {
                  backgroundColor: connection.enabled
                    ? connectionStateColor(connection.state)
                    : colors.textDim,
                },
              ]}
            />
          ),
        content: (
          <ConnectionRowEditor
            connection={connection}
            onToggle={onToggle}
            onReconnect={onReconnect}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onMove={onMove}
            accountPool={
              accountRateLimits.find((row) => row.connectionId === connection.id)?.accountPool ??
              null
            }
            {...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool })}
            {...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin })}
            {...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin })}
            {...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile })}
            {...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile })}
            {...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile })}
          />
        ),
      }))}
      version={<SettingsVersion version={Constants.expoConfig?.version ?? "unknown"} />}
    />
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
  onStartAccountLogin?(
    connectionId: string,
  ): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelAccountLogin?(connectionId: string, loginId: string): Promise<void>;
  onActivateAccountProfile?(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdateAccountProfile?(
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ): Promise<AccountPoolSnapshot>;
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
  const secureLive = connection.enabled && connection.state === "live";
  const copyDiagnostic = async () => {
    if (connection.lastError === null) return;
    await Clipboard.setStringAsync(
      connectionDiagnosticReport({
        appVersion: Constants.expoConfig?.version ?? null,
        connectionId: connection.id,
        enabled: connection.enabled,
        error: connection.lastError,
        occurredAt: connection.lastErrorAt,
        platform: Platform.OS,
        platformVersion: Platform.Version,
        state: connection.state,
      }),
    );
  };
  const handleConnectionAction = (id: string) => {
    if (id === "reconnect") void onReconnect(connection.id);
    else if (id === "edit") setEditing(true);
    else if (id === "move-up") void onMove(connection.id, -1);
    else if (id === "move-down") void onMove(connection.id, 1);
    else if (id === "delete") {
      dialog.alert("Delete server?", `Remove ${connection.displayName} from this device?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void onDelete(connection.id);
          },
        },
      ]);
    }
  };
  return (
    <View style={styles.connectionEditor}>
      {editing ? (
        <View style={styles.connectionEditorForm}>
          <View style={styles.connectionIdentityFields}>
            <TextInput
              voiceInput={false}
              accessibilityLabel={`Emoji for ${connection.displayName}`}
              value={emoji}
              onChangeText={setEmoji}
              style={styles.connectionEmojiInput}
            />
            <TextInput
              accessibilityLabel={`Name for ${connection.displayName}`}
              value={name}
              onChangeText={setName}
              style={[styles.fieldInput, styles.flex]}
            />
          </View>
          <Text style={styles.fieldLabel}>Secure endpoint</Text>
          <TextInput
            voiceInput={false}
            accessibilityLabel={`Endpoint for ${connection.displayName}`}
            value={endpoint}
            onChangeText={setEndpoint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.fieldInput}
          />
          <Text style={styles.fieldLabel}>
            Replacement capability (leave blank to keep current)
          </Text>
          <TextInput
            accessibilityLabel={`Replacement capability for ${connection.displayName}`}
            value={replacementToken}
            onChangeText={setReplacementToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.fieldInput}
          />
          <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
          <TextInput
            voiceInput={false}
            accessibilityLabel={`TLS pin for ${connection.displayName}`}
            value={tlsPinSha256}
            onChangeText={setTlsPinSha256}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.fieldInput}
          />
          {error !== null && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.sheetActions}>
            <Pressable
              accessibilityLabel={`Cancel editing ${connection.displayName}`}
              disabled={saving}
              onPress={cancelEditing}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Save ${connection.displayName}`}
              disabled={saving}
              onPress={() => void save()}
              style={[styles.primaryButton, saving && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.connectionRow}>
          <AppListRow
            title="Connection"
            description={connection.endpoint}
            fixedHeight={listRowHeight.double}
            leadingIcon={{ name: "server-outline", size: iconSize.action, color: colors.textMuted }}
            descriptionLeading={
              secureLive ? (
                <Ionicons
                  accessibilityLabel="Secure connection"
                  name="lock-closed"
                  size={iconSize.indicator}
                  color={colors.green}
                />
              ) : undefined
            }
            trailing={
              <>
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
                  <Pressable
                    accessibilityLabel={`Actions for ${connection.displayName}`}
                    style={styles.connectionMiniButton}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={iconSize.action}
                      color={colors.textMuted}
                    />
                  </Pressable>
                </ActionMenu>
              </>
            }
          />
          {!secureLive && (
            <View style={styles.connectionStateRow}>
              <View style={styles.connectionStateIcon}>
                {connection.enabled && connectionActivity(connection.state) !== null ? (
                  <ConnectionActivityIndicator
                    status={connection.state}
                    size={iconSize.indicator}
                  />
                ) : (
                  <View
                    style={[
                      styles.connectionStateDot,
                      {
                        backgroundColor: connection.enabled
                          ? connectionStateColor(connection.state)
                          : colors.textDim,
                      },
                    ]}
                  />
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.connectionStateText,
                  {
                    color: connection.enabled
                      ? connectionStateColor(connection.state)
                      : colors.textDim,
                  },
                ]}
              >
                {connectionStateLabel(connection.state, connection.enabled)}
              </Text>
            </View>
          )}
          {connection.lastError !== null && connection.state !== "live" && (
            <View style={styles.connectionDiagnostic}>
              <View style={styles.connectionDiagnosticHeader}>
                <Ionicons name="warning-outline" size={iconSize.inline} color={colors.red} />
                <Text selectable style={styles.connectionDiagnosticSummary}>
                  {connectionDiagnosticSummary(connection.lastError)}
                </Text>
              </View>
              <View style={styles.connectionDiagnosticMeta}>
                {connection.lastErrorAt !== null && (
                  <Text style={styles.connectionDiagnosticTime}>
                    {connectionDiagnosticTime(connection.lastErrorAt)}
                  </Text>
                )}
                <Pressable
                  accessibilityLabel={`${diagnosticExpanded ? "Hide" : "Show"} error details for ${connection.displayName}`}
                  onPress={() => setDiagnosticExpanded((value) => !value)}
                >
                  <Text style={styles.rawLink}>
                    {diagnosticExpanded ? "Hide details" : "Error details"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Copy error for ${connection.displayName}`}
                  onPress={() => void copyDiagnostic()}
                >
                  <Text style={styles.rawLink}>Copy</Text>
                </Pressable>
              </View>
              {diagnosticExpanded && (
                <Text selectable style={styles.connectionDiagnosticRaw}>
                  {connection.lastError}
                </Text>
              )}
            </View>
          )}
          {onRefreshAccountPool !== undefined &&
            onStartAccountLogin !== undefined &&
            onCancelAccountLogin !== undefined &&
            onActivateAccountProfile !== undefined &&
            onUpdateAccountProfile !== undefined &&
            onRemoveAccountProfile !== undefined && (
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
  onStartLogin(
    connectionId: string,
  ): Promise<{ loginId: string; verificationUrl: string; userCode: string }>;
  onCancelLogin(connectionId: string, loginId: string): Promise<void>;
  onActivate(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  onUpdate(
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ): Promise<AccountPoolSnapshot>;
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
  const profileIds = profiles
    .map((profile) => profile.id)
    .sort()
    .join("|");
  const pendingAccountLogin =
    pendingAccountLoginState?.profileIds === profileIds ? pendingAccountLoginState : null;

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
            <Text style={styles.menuActionSubtitle}>
              Manual selection · automatic fallback on limit
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Refresh Codex accounts"
            disabled={busy}
            onPress={() => void run(async () => await onRefresh(connectionId))}
            style={[styles.connectionMiniButton, busy && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Ionicons name="refresh" size={iconSize.action} color={colors.textMuted} />
            )}
          </Pressable>
        </View>
        {profiles.length === 0 && (
          <Text style={styles.menuNotice}>
            {accountPool === null
              ? "Account data is not available yet. Refresh to try again."
              : "No Codex accounts connected."}
          </Text>
        )}
        {profiles.map((profile, index) => {
          const label = accountProfileLabel(profile, index);
          const weekly = selectWeeklyRateLimit(profile.rateLimits);
          const limitLabel =
            weekly !== null
              ? `${Math.round(weekly.remainingPercent)}% left`
              : profile.exhaustedIndefinitely
                ? "Limit reached"
                : "Usage pending";
          const actions: ActionMenuItem[] = [
            {
              id: "activate",
              label: profile.active ? "Active account" : "Switch to account",
              icon: "person-circle-outline",
              selected: profile.active,
              disabled: profile.active || !profile.enabled,
            },
            ...(index === 0
              ? []
              : [{ id: "make-primary", label: "Make primary", icon: "star-outline" as const }]),
            ...(profiles.length > 2 && index > 0
              ? [{ id: "move-up", label: "Move earlier", icon: "arrow-up" as const }]
              : []),
            ...(profiles.length > 2 && index < profiles.length - 1
              ? [{ id: "move-down", label: "Move later", icon: "arrow-down" as const }]
              : []),
            {
              id: "toggle-enabled",
              label: profile.enabled ? "Disable fallback" : "Enable fallback",
              icon: profile.enabled ? "pause-circle-outline" : "play-circle-outline",
              selected: profile.enabled,
            },
            ...(!profile.active
              ? [
                  {
                    id: "remove",
                    label: "Remove account",
                    icon: "trash-outline" as const,
                    destructive: true,
                  },
                ]
              : []),
          ];
          const handleAction = (id: string) => {
            if (id === "activate") void run(async () => await onActivate(connectionId, profile.id));
            else if (id === "make-primary")
              void run(async () => await onUpdate(connectionId, profile.id, { priority: 0 }));
            else if (id === "move-up")
              void run(
                async () => await onUpdate(connectionId, profile.id, { priority: index - 1 }),
              );
            else if (id === "move-down")
              void run(
                async () => await onUpdate(connectionId, profile.id, { priority: index + 1 }),
              );
            else if (id === "toggle-enabled")
              void run(
                async () => await onUpdate(connectionId, profile.id, { enabled: !profile.enabled }),
              );
            else if (id === "remove")
              void run(async () => await onRemove(connectionId, profile.id));
          };
          return (
            <AppListRow
              key={profile.id}
              title={label}
              position={listRowPosition(index, profiles.length)}
              fixedHeight={listRowHeight.double}
              description={`${profile.planType ?? "Plan pending"} · ${index === 0 ? "Primary" : `Backup ${index}`}${profile.active ? " · Active" : ""}${profile.enabled ? "" : " · disabled"}`}
              leading={
                <View
                  style={[
                    styles.connectionStateDot,
                    {
                      backgroundColor: profile.active
                        ? colors.green
                        : profile.exhaustedUntil !== null || profile.exhaustedIndefinitely
                          ? colors.red
                          : colors.textDim,
                    },
                  ]}
                />
              }
              trailing={
                <>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.accountPoolLimit,
                      weekly === null && styles.accountPoolLimitPending,
                    ]}
                  >
                    {limitLabel}
                  </Text>
                  <ActionMenu
                    accessibilityLabel={`Actions for ${label}`}
                    actions={actions}
                    onSelect={handleAction}
                    style={styles.accountPoolMenuAnchor}
                  >
                    <Pressable
                      accessibilityLabel={`Actions for ${label}`}
                      disabled={busy}
                      style={[styles.connectionMiniButton, busy && styles.disabled]}
                    >
                      <Ionicons
                        name="ellipsis-horizontal"
                        size={iconSize.action}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </ActionMenu>
                </>
              }
            />
          );
        })}
        {accountPool?.allExhausted === true && (
          <Text style={styles.errorText}>All configured accounts are exhausted.</Text>
        )}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void run(addAccount)}
          style={[styles.secondaryButton, styles.accountPoolAddButton, busy && styles.disabled]}
        >
          <Ionicons name="person-add-outline" size={iconSize.inline} color={colors.text} />
          <Text style={styles.secondaryButtonText}>Add Codex account</Text>
        </Pressable>
      </View>
      {pendingAccountLogin !== null && (
        <AppSheet
          isOpen
          onOpenChange={(open) => {
            if (!open) closeAccountLogin();
          }}
          contentProps={{
            dismissLabel: "Close Codex account sign-in",
            index: 0,
            enableDynamicSizing: true,
            enableOverDrag: false,
          }}
        >
          <View style={styles.accountLoginSheet}>
            <View style={styles.accountLoginHeader}>
              <View style={styles.accountLoginIcon}>
                <Ionicons name="people-outline" size={iconSize.action} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.accountLoginTitle}>Connect Codex account</Text>
                <Text style={styles.accountLoginSubtitle}>
                  Sign in to add this account as an automatic fallback.
                </Text>
              </View>
            </View>
            <View style={styles.accountLoginCodeCard}>
              <View style={styles.flex}>
                <Text style={styles.accountLoginCodeLabel}>One-time code</Text>
                <Text selectable style={styles.accountLoginCode}>
                  {pendingAccountLogin.userCode}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy one-time Codex sign-in code"
                onPress={() => void copyAccountCode()}
                style={[
                  styles.accountLoginCopyButton,
                  codeCopied && styles.accountLoginCopyButtonDone,
                ]}
              >
                <Ionicons
                  name={codeCopied ? "checkmark" : "copy-outline"}
                  size={iconSize.inline}
                  color={codeCopied ? colors.green : colors.text}
                />
                <Text
                  style={[
                    styles.accountLoginCopyLabel,
                    codeCopied && styles.accountLoginCopyLabelDone,
                  ]}
                >
                  {codeCopied ? "Copied" : "Copy"}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.accountLoginHint}>
              The code is copied automatically when you open sign-in. Paste it in the browser to
              finish connecting.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={loginActionBusy}
              onPress={() => void openAccountSignIn()}
              style={[
                styles.primaryButton,
                styles.accountLoginPrimaryButton,
                loginActionBusy && styles.disabled,
              ]}
            >
              {loginActionBusy ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Ionicons name="open-outline" size={iconSize.action} color={colors.onPrimary} />
              )}
              <Text style={styles.primaryButtonText}>
                {loginActionBusy ? "Opening…" : "Open sign-in"}
              </Text>
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
  return (
    kind === "commandExecution" ||
    kind === "fileChange" ||
    kind === "turnDiff" ||
    kind === "mcpToolCall" ||
    kind === "dynamicToolCall" ||
    kind === "webSearch" ||
    kind === "collabAgentToolCall" ||
    kind === "subAgentActivity"
  );
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
    const checklist = metadata.plan.steps
      .map((step) => `${step.status === "completed" ? "- [x]" : "- [ ]"} ${step.step}`)
      .join("\n");
    blocks.push({
      key: `${scope}/${turn.id}/live-plan`,
      kind: "turnPlan",
      title: "Plan",
      body: [metadata.plan.explanation, checklist]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n\n"),
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

function parseThreadSelectionKey(
  value: string | null,
): { connectionId: string; threadId: string } | null {
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
  const match = value.match(
    /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)/u,
  );
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

function ThreadTitle({ value, running }: { value: string; running: boolean }) {
  const emoji = leadingEmoji(value);
  const title = emoji === null ? value : value.slice(emoji.length).trimStart();
  return (
    <View style={styles.runningThreadTitle}>
      {emoji !== null && title !== "" && <InlineEmoji value={emoji} role="body" />}
      {running ? (
        <WaveText
          testID="running-thread-title-shimmer"
          text={title === "" ? value : title}
          style={styles.threadTitle}
          containerStyle={styles.threadTitleWave}
        />
      ) : (
        <Text numberOfLines={1} style={styles.threadTitle}>
          {title === "" ? value : title}
        </Text>
      )}
    </View>
  );
}

function RunningThreadTitle({ value }: { value: string }) {
  return <ThreadTitle value={value} running />;
}

function serverGlyph(server: Pick<ThreadListServer, "emoji" | "name">): string {
  return Platform.OS === "web"
    ? server.name.trim().slice(0, 1).toLocaleUpperCase() || "C"
    : server.emoji;
}

function basename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "attachment";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function formatTurnMeta(
  status: "completed" | "interrupted" | "failed" | "inProgress",
  durationMs: number | null,
  completedAt: number | null,
): string {
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
  const value =
    item.kind === "turn"
      ? [
          ...item.turn.items.map((rawItem) => {
            if (rawItem.type === "userMessage")
              return rawItem.content
                .map((content) =>
                  "text" in content ? content.text : boundedJsonStringify(content, 8_192),
                )
                .join("\n");
            if (rawItem.type === "agentMessage") return rawItem.text;
            return boundedJsonStringify(rawItem, 16_384);
          }),
          boundedJsonStringify(projectedTurnMetadata(item.turn) ?? {}, 8_192),
        ].join("\n")
      : item.kind === "optimistic"
        ? item.text
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
  const state =
    thread.pendingRequestCount > 0
      ? "approval"
      : thread.status.type === "active"
        ? "running"
        : thread.status.type === "systemError"
          ? "failed"
          : null;
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

function subagentThreadListItem(
  summary: StoredThreadSummary,
  thread: Thread,
  connectionId: string,
): ThreadListItem {
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
  desktopWorkspace: { backgroundColor: colors.threadListSurface, flex: 1, flexDirection: "row" },
  flex: { flex: 1 },
  pressed: { opacity: 0.68 },
  serverEmoji: { ...typeScale.emoji },
  connectionActivityIndicator: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  threadSidebar: {
    minWidth: 280,
    maxWidth: 480,
    flexShrink: 0,
    backgroundColor: colors.threadListSurface,
    overflow: "hidden",
  },
  threadListHeaderChrome: { flexShrink: 0, backgroundColor: colors.threadListSurface },
  threadListContentSurface: { flex: 1, minHeight: 0 },
  threadListSuspended: { flex: 1 },
  sidebarHeader: {
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingTop: 0,
    paddingBottom: spacing.xxs,
  },
  serverTitleRow: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  serverTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  headerMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  threadSearchRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.optical,
  },
  threadSearchBox: { ...searchFieldLayout, height: controlSize.regular, flex: 1, minWidth: 0 },
  threadFilterButton: {
    width: controlSize.touch,
    minHeight: controlSize.touch,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
    position: "relative",
  },
  threadFilterActiveDot: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  searchBox: {
    height: controlSize.touch,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainer,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.body, paddingVertical: 0 },
  sectionHeader: {
    height: THREAD_LIST_SECTION_HEIGHT,
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
    textTransform: "uppercase",
    letterSpacing: typeTracking.caps,
  },
  threadListEmpty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
  },
  threadListEmptyText: { color: colors.textMuted, ...typeScale.body },
  threadRow: {
    minWidth: 0,
    maxWidth: "100%",
    height: THREAD_LIST_ROW_CONTENT_HEIGHT,
    alignSelf: "stretch",
    marginHorizontal: threadListLayout.edgeInset,
    marginVertical: THREAD_LIST_ROW_VERTICAL_MARGIN,
    paddingVertical: spacing.compact,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.selected,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    position: "relative",
  },
  threadContextMenu: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    flexShrink: 1,
  },
  threadRowSwipeChild: {
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: radii.selected,
    backgroundColor: colors.threadListSurface,
  },
  swipeContainer: {
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    marginHorizontal: threadListLayout.edgeInset,
    marginVertical: THREAD_LIST_ROW_VERTICAL_MARGIN,
    borderRadius: radii.selected,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  swipeChildren: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    backgroundColor: "transparent",
  },
  swipeActionsLeft: {
    flexDirection: "row",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
  },
  swipeActionsRight: {
    flexDirection: "row",
    height: "100%",
    width: THREAD_SWIPE_ACTIONS_WIDTH,
  },
  swipeActionsUnderlay: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.selected,
    overflow: "hidden",
    paddingLeft: THREAD_SWIPE_UNDERLAY_OVERLAP,
    width: THREAD_SWIPE_ACTIONS_WIDTH + THREAD_SWIPE_UNDERLAY_OVERLAP,
  },
  swipeAction: {
    alignSelf: "stretch",
    width: THREAD_SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  swipeActionNeutral: { backgroundColor: colors.surfaceContainerHigh },
  swipeActionAccent: { backgroundColor: colors.primary },
  swipeActionDanger: { backgroundColor: colors.errorContainer },
  swipeActionPressed: { opacity: 0.72 },
  swipeActionText: { ...typeScale.label, fontWeight: typeWeight.semibold },
  threadRowSelected: { backgroundColor: colors.secondaryContainer },
  selectionBar: { display: "none" },
  threadText: { flex: 1, minWidth: 0, maxWidth: "100%", gap: spacing.optical },
  threadTitleLine: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  threadServerEmoji: { ...typeScale.emoji },
  threadTitleSlot: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  runningThreadTitle: {
    maxWidth: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  threadTitle: {
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  threadTitleWave: { maxWidth: "100%" },
  threadStatusIcon: {
    width: 18,
    height: 18,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  threadMeta: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  threadTime: {
    flexShrink: 0,
    color: colors.textMuted,
    ...typeScale.caption,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  unreadSlot: {
    width: 7,
    height: 18,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  threadPreviewLine: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  threadPreview: {
    minWidth: 0,
    maxWidth: "100%",
    flex: 1,
    flexShrink: 1,
    color: colors.textMuted,
    ...typeScale.label,
  },
  mobileList: { flex: 1, backgroundColor: colors.threadListSurface, overflow: "hidden" },
  mobileTitleRow: {
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
    paddingRight: threadListLayout.edgeInset,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.optical,
  },
  mobileTitleSelector: {
    flex: 1,
    minWidth: 0,
    minHeight: touchTarget,
    paddingHorizontal: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.medium,
  },
  mobileIdentity: { flex: 1, minWidth: 0 },
  mobileTitle: { flexShrink: 1, color: colors.text, ...typeScale.title },
  mobileTitleGrow: { flex: 1, minWidth: 0 },
  mobileSubtitle: { color: colors.textMuted, ...typeScale.label },
  mobileSearchWrap: {
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingBottom: spacing.xs,
  },
  newThreadFab: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    width: 56,
    height: 56,
    borderRadius: radii.large,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    zIndex: 10,
    elevation: 3,
  },
  conversation: { flex: 1, minWidth: 0, backgroundColor: colors.conversationSurface },
  conversationRaised: {
    borderBottomLeftRadius: radii.composer,
    borderTopLeftRadius: radii.composer,
    overflow: "hidden",
  },
  conversationKeyboard: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    backgroundColor: colors.conversationSurface,
  },
  emptyConversation: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.conversationSurface,
  },
  emptyText: { color: colors.textMuted, ...typeScale.title },
  newChatEmptyState: {
    maxWidth: 520,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  newChatPrompt: { color: colors.text, ...typeScale.heading, textAlign: "center" },
  newChatProjectButton: {
    maxWidth: "100%",
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.large,
  },
  newChatProjectText: { minWidth: 0, flexShrink: 1, color: colors.accent, ...typeScale.title },
  newChatWorkspaceButton: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.large,
  },
  newChatWorkspaceText: { color: colors.textMuted, ...typeScale.body },
  projectSearch: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainerLow,
  },
  projectSearchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...typeScale.body,
    paddingVertical: 0,
  },
  projectPickerProgress: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  conversationHeaderChrome: { left: 0, position: "absolute", right: 0, top: 0, zIndex: 30 },
  conversationHeader: {
    minHeight: layoutSize.header,
    paddingHorizontal: conversationChromeEdgeInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  conversationHeaderUnderlay: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 29,
  },
  conversationIdentity: { flex: 1, minWidth: 0 },
  conversationIdentityRaised: {
    marginLeft: spacing.xs,
    transform: [{ translateY: spacing.optical }],
  },
  conversationTitleRow: {
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  conversationTitle: { color: colors.text, ...typeScale.title },
  conversationHeaderTitle: { minWidth: 0, flexShrink: 1 },
  conversationBackendRefreshIndicator: { flexShrink: 0 },
  emojiText: { fontFamily: Platform.select({ web: "system-ui", default: "sans-serif" }) },
  conversationSubtitle: { color: colors.textMuted, ...typeScale.label, marginTop: spacing.optical },
  threadSearchBar: {
    ...searchFieldLayout,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xxs,
  },
  searchAction: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  threadSearchCount: {
    color: colors.textMuted,
    ...typeScale.label,
    minWidth: 34,
    textAlign: "right",
  },
  conversationScroll: { backgroundColor: colors.conversationSurface, flex: 1 },
  conversationContentSurface: { flex: 1, minHeight: 0 },
  conversationKeyboardBody: { backgroundColor: colors.conversationSurface, flex: 1, minHeight: 0 },
  timelineShell: { flex: 1 },
  historyLoadingIndicator: {
    position: "absolute",
    top: spacing.xs,
    left: 0,
    right: 0,
    zIndex: 11,
    alignItems: "center",
  },
  historyLoadingIndicatorPill: {
    width: controlSize.compact,
    height: controlSize.compact,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainerHigh,
  },
  livePlanFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.sm,
    zIndex: 10,
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  conversationContent: { paddingHorizontal: spacing.md, paddingTop: spacing.compact },
  conversationContentCompact: { flexGrow: 1, justifyContent: "flex-end" },
  conversationContentWide: { flexGrow: 1, paddingHorizontal: spacing.md },
  timelineRow: { width: "100%" },
  historyBeginning: {
    color: colors.textDim,
    ...typeScale.caption,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
  timelineItem: { width: "100%", maxWidth: 880, alignSelf: "center" },
  timelineItemWide: { alignSelf: "flex-start" },
  turnGroup: { gap: spacing.xxs },
  preTurnLifecycleList: {
    width: "100%",
    minWidth: 0,
    alignSelf: "stretch",
    gap: spacing.xxs,
    paddingVertical: spacing.optical,
  },
  preTurnLifecycleRow: {
    width: "100%",
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  preTurnLifecycleIcon: {
    width: 16,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  preTurnLifecycleText: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  preTurnLifecycleWave: { minWidth: 0, flexShrink: 1 },
  preTurnLifecycleDetail: { width: "100%", minWidth: 0, alignSelf: "stretch" },
  turnMessages: { gap: spacing.xxs },
  turnBlock: { width: "100%" },
  turnFooter: {
    minHeight: TURN_FOOTER_MIN_HEIGHT,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: spacing.xxs,
  },
  turnTokenMetrics: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  turnFooterEnd: { alignSelf: "flex-end", justifyContent: "flex-end", maxWidth: "86%" },
  turnStatusDot: { width: 7, height: 7, borderRadius: radii.pill },
  turnStatusRunning: { backgroundColor: colors.amber },
  turnStatusFailed: { backgroundColor: colors.red },
  turnStatusStopped: { backgroundColor: colors.textDim },
  turnStatusCompleted: { backgroundColor: colors.green },
  userTurnCluster: { width: "100%", alignItems: "stretch", gap: spacing.optical },
  userMessageRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "column",
    alignItems: "flex-end",
    gap: spacing.xxs,
  },
  agentMessageRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: 0,
  },
  messageActionRail: {
    width: controlSize.compact,
    minHeight: controlSize.compact,
    flexShrink: 0,
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  messageActionButton: {
    width: controlSize.compact,
    height: controlSize.compact,
    flexShrink: 0,
    alignItems: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  userBubble: {
    minWidth: 0,
    alignSelf: "flex-end",
    width: "auto",
    maxWidth: "82%",
    backgroundColor: colors.messageSurface,
    borderRadius: radii.selected,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  userBubbleText: { color: colors.text, ...typeScale.body },
  userMessageContent: { minWidth: 0, gap: spacing.compact },
  userMessageMediaContent: { width: 320, maxWidth: "100%" },
  userMessageBlock: { minWidth: 0 },
  userMessageTextBlock: { minWidth: 0 },
  pendingUserMessageShimmer: { alignSelf: "stretch" },
  userMessageExpandButton: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
  },
  userMessageExpandText: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  userImageGallery: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xxs,
    overflow: "hidden",
    borderRadius: radii.medium,
  },
  userImageGalleryHero: { width: "100%", aspectRatio: 16 / 9 },
  userImageGalleryTile: { width: "49%", flexGrow: 1, aspectRatio: 1 },
  userImage: {
    width: 220,
    maxWidth: "100%",
    aspectRatio: 4 / 3,
    overflow: "hidden",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  generatedImage: {
    width: "100%",
    maxWidth: 600,
    aspectRatio: 4 / 3,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  openableImage: { width: "100%", height: "100%", borderRadius: radii.medium },
  imageOpenBadge: {
    position: "absolute",
    right: 8,
    top: 8,
    width: controlSize.compact,
    height: controlSize.compact,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  attachmentChip: {
    minHeight: controlSize.compact,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.small,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachmentText: { flex: 1, color: colors.textMuted, ...typeScale.label },
  messageTime: {
    flexShrink: 0,
    color: colors.textDim,
    ...typeScale.caption,
    paddingHorizontal: spacing.sm,
  },
  optimisticError: {
    maxWidth: "82%",
    alignSelf: "flex-end",
    paddingHorizontal: spacing.compact,
    color: colors.red,
    ...typeScale.caption,
    textAlign: "right",
  },
  retryMessageButton: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.medium,
  },
  retryMessageText: { color: colors.accent, ...typeScale.label, fontWeight: typeWeight.semibold },
  agentMessage: { paddingHorizontal: spacing.optical, paddingVertical: spacing.xxs },
  agentMarkdownDocument: {
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "flex-start",
    gap: spacing.xxs,
  },
  agentMarkdownDocumentFill: { width: "100%", alignSelf: "stretch" },
  waveTextShell: {
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    alignSelf: "flex-start",
    overflow: "hidden",
  },
  waveTextRest: { opacity: 0.58 },
  waveTextMask: { color: "#000000" },
  waveTextBand: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    experimental_backgroundImage:
      "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 24%, rgba(255,255,255,0.72) 42%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.72) 58%, rgba(255,255,255,0.08) 76%, rgba(255,255,255,0) 100%)",
  },
  agentPlaceholder: { color: colors.textDim, ...typeScale.label },
  turnActivity: { maxWidth: "100%", alignSelf: "flex-start", marginTop: spacing.optical },
  turnActivityCompact: { marginTop: 0 },
  turnActivityExpanded: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  turnActivityToggle: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: 0,
  },
  turnActivityToggleCompact: { minHeight: typeScale.body.lineHeight },
  activityIconSlot: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  activityChevronSlot: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  turnActivityLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  turnActivityLabelWave: { minWidth: 0, flexShrink: 1, alignSelf: "center" },
  outputFootprintMetric: { flexShrink: 0, justifyContent: "center" },
  outputFootprintMetricText: {
    color: colors.textDim,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  turnActivityList: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    gap: spacing.xxs,
    paddingTop: spacing.optical,
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: spacing.optical,
  },
  turnActivityListWithoutToggle: { paddingLeft: 0 },
  activityMoreButton: {
    minHeight: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerLow,
  },
  activityMoreText: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  copyButton: {
    width: controlSize.compact,
    height: controlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  copyButtonCompact: {
    width: controlSize.compact,
    height: controlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.small,
  },
  agentText: { minWidth: 0, maxWidth: "100%", color: colors.text, ...typeScale.body },
  liveAgentResponse: { minWidth: 0, maxWidth: "100%", alignSelf: "flex-start" },
  liveAgentResponseFill: { width: "100%", alignSelf: "stretch" },
  liveMarkdownResponse: { gap: spacing.xxs },
  // Keep the collapsed header outside Android's clipped child layer. Fabric
  // could retain the measured card while dropping its painted header after an
  // animated running body was removed, producing a correctly-sized blank row.
  card: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    paddingVertical: spacing.xxs,
    paddingHorizontal: 0,
    gap: spacing.xxs,
  },
  bubbleNestedSurface: { backgroundColor: "transparent" },
  cardContent: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    gap: spacing.xxs,
  },
  cardHeader: {
    width: "100%",
    minWidth: 0,
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    opacity: 1,
  },
  cardHeaderToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: controlSize.compact,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    opacity: 1,
  },
  cardIconSlot: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  cardTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  cardTitleWave: { alignSelf: "center", justifyContent: "center" },
  cardStatusIcon: {
    minWidth: typeScale.label.lineHeight,
    minHeight: typeScale.label.lineHeight,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  cardStatusDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.green },
  commandActivitySection: { width: "100%", minWidth: 0, maxWidth: "100%", gap: spacing.xxs },
  commandActivitySectionHeader: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.compact,
  },
  commandActivitySectionLabel: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: typeTracking.caps,
  },
  agentActivityMeta: { flexShrink: 0, color: colors.textMuted, ...typeScale.caption },
  tokenStrip: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerLow,
  },
  tokenStripTitle: { flexDirection: "row", alignItems: "center", gap: spacing.compact },
  tokenMetrics: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xxs,
  },
  tokenMetric: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  tokenMetricValue: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  planStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    paddingVertical: spacing.optical,
  },
  planText: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.label },
  reasoningCard: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.inputInset,
  },
  reasoningText: { flex: 1, color: colors.textMuted, ...typeScale.label },
  thinkingStatusSection: {
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  thinkingStatus: {
    minWidth: 0,
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: 0,
  },
  thinkingStatusInActivity: { paddingLeft: 0 },
  monospaceStrong: {
    color: colors.text,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    fontWeight: typeWeight.semibold,
    marginBottom: spacing.optical,
  },
  toolRow: { minHeight: 18, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  toolLabel: {
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    width: 42,
  },
  toolValue: {
    flex: 1,
    color: colors.text,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
  },
  codeBlock: {
    backgroundColor: colors.code,
    borderRadius: radii.small,
    padding: spacing.xs,
    gap: spacing.optical,
  },
  codeLine: {
    minWidth: 0,
    maxWidth: "100%",
    color: "#B8B8B8",
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
  },
  commandLine: {
    color: colors.text,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    marginBottom: spacing.xxs,
  },
  diffAdd: { color: colors.green },
  diffRemove: { color: colors.red },
  diffFile: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    borderRadius: radii.small,
    backgroundColor: colors.code,
  },
  diffFileHeader: {
    width: "100%",
    minWidth: 0,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.compact,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    backgroundColor: colors.surface,
  },
  diffFilePath: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
  },
  diffKind: {
    flexShrink: 0,
    color: colors.textMuted,
    ...typeScale.caption,
    textTransform: "uppercase",
  },
  diffStat: {
    minWidth: 18,
    flexShrink: 0,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  diffStatAdd: { color: colors.green },
  diffStatDelete: { color: colors.red },
  diffLines: { width: "100%", minWidth: 0, paddingVertical: spacing.xxs },
  searchResult: {
    paddingVertical: spacing.compact,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  compactToolCard: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.xs,
  },
  compactToolTitle: { color: colors.text, ...typeScale.label, fontWeight: typeWeight.semibold },
  compactToolText: { color: colors.textMuted, ...typeScale.caption, marginTop: spacing.optical },
  resultCount: { color: colors.textDim, ...typeScale.caption },
  unknownCard: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.xs,
  },
  unknownText: { flex: 1, color: colors.textMuted, ...typeScale.label },
  unknownFixButton: {
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radii.medium,
    backgroundColor: colors.primary,
  },
  unknownFixText: {
    color: colors.onPrimary,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  rawLink: { color: colors.accent, ...typeScale.label, fontWeight: typeWeight.semibold },
  protocolBody: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    gap: spacing.xxs,
  },
  toolMarkdownResult: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  protocolBodyActions: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  largeContentControl: {
    width: "100%",
    minWidth: 0,
    gap: spacing.compact,
    paddingTop: spacing.xxs,
  },
  largeContentActions: { width: "100%", minWidth: 0, gap: spacing.xxs },
  largeContentButton: {
    minHeight: controlSize.compact,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  largeContentButtonText: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  largeContentPager: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.xxs },
  largeContentPageButton: {
    width: controlSize.compact,
    height: controlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  fullContentViewer: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  fullContentHeader: {
    minHeight: layoutSize.header,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
  fullContentHeaderIcon: {
    width: controlSize.compact,
    height: controlSize.compact,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  fullContentHeaderText: { flex: 1, minWidth: 0 },
  fullContentTitle: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  fullContentMeta: { color: colors.textMuted, ...typeScale.caption, fontVariant: ["tabular-nums"] },
  fullContentViewport: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors.code,
    overflow: "hidden",
  },
  fullContentCentered: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.md,
  },
  fullContentMarkdown: { padding: spacing.md, paddingBottom: spacing.xl },
  fullContentRawHorizontal: { flexGrow: 0, padding: spacing.sm },
  fullContentRawText: {
    color: "#D3D7DE",
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
  },
  fullContentFooter: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
  fullContentFooterText: { flex: 1, color: colors.textMuted, ...typeScale.caption },
  turnMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.optical,
  },
  turnMetaText: { color: colors.textMuted, ...typeScale.caption },
  jumpToLatest: {
    position: "absolute",
    right: spacing.md,
    zIndex: 20,
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryContainer,
    elevation: 3,
  },
  jumpToLatestBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 20,
    minHeight: 20,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.optical,
    borderRadius: radii.small,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  jumpToLatestBadgeText: {
    color: colors.onPrimary,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
  composerSticky: { bottom: 0, left: 0, minWidth: 0, position: "absolute", right: 0, zIndex: 30 },
  composerDock: { paddingTop: 0, flexShrink: 0, minWidth: 0, alignSelf: "stretch" },
  composerContextStrip: { flexGrow: 0, flexShrink: 0 },
  composerContextContent: {
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: COMPOSER_CHIP_TOP_INSET,
    paddingBottom: 0,
  },
  composerContextChip: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "flex-start",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  composerContextText: {
    flexGrow: 0,
    flexShrink: 0,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  composerContextCount: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
    justifyContent: "center",
  },
  composerContextCountHidden: { opacity: 0 },
  composerContextRefreshOverlay: {
    position: "absolute",
    inset: 0,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  composerContextValue: { alignSelf: "center", justifyContent: "center" },
  composerContextWave: { flexGrow: 0, flexShrink: 0 },
  threadResourceRoute: { flex: 1, width: "100%", minHeight: 0 },
  threadResourceRouteHidden: { display: "none" },
  threadResourcesContent: { paddingBottom: spacing.md },
  threadAttachmentCell: { height: listRowHeight.double },
  threadResourceDocumentContent: {
    width: "100%",
    minWidth: 0,
    alignSelf: "stretch",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  threadResourcePreviewCenter: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  primaryAction: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.large,
    backgroundColor: colors.primary,
  },
  primaryActionText: { color: colors.onPrimary, fontWeight: typeWeight.semibold },
  threadResourceRow: {
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.medium,
  },
  threadResourceIcon: {
    width: controlSize.compact,
    height: controlSize.compact,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  threadResourceText: { flex: 1, minWidth: 0 },
  threadResourceTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  threadResourceSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  threadResourceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.optical,
  },
  threadResourceStat: {
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    fontVariant: ["tabular-nums"],
  },
  threadResourceDeleted: { color: colors.red, ...typeScale.caption },
  threadResourceUnavailable: { color: colors.amber, ...typeScale.caption },
  threadResourcesEmpty: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  composerAttachments: { flexGrow: 0 },
  composerAttachmentsContent: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xs,
    paddingBottom: spacing.optical,
  },
  composerAttachmentCard: {
    width: 224,
    minHeight: layoutSize.row,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  composerAttachmentOpen: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.xxs,
  },
  composerAttachmentThumbnail: {
    width: controlSize.touch,
    height: controlSize.touch,
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: radii.small,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  composerAttachmentFileIcon: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    borderRadius: radii.small,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  composerAttachmentText: { minWidth: 0, flex: 1, gap: spacing.optical },
  composerAttachmentName: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  composerAttachmentKind: {
    color: colors.textMuted,
    ...typeScale.caption,
    textTransform: "capitalize",
  },
  composerAttachmentRemove: {
    width: 32,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  composerAccessoryTray: {
    minHeight: layoutSize.row,
    marginHorizontal: conversationChromeEdgeInset,
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.optical,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainer,
  },
  composerAccessoryAction: {
    minWidth: 0,
    minHeight: controlSize.touch,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radii.medium,
  },
  composerAccessoryLabel: {
    maxWidth: "100%",
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    textAlign: "center",
  },
  queuedComposerEditBar: {
    minHeight: controlSize.regular,
    marginHorizontal: conversationChromeEdgeInset,
    marginTop: spacing.xs,
    paddingLeft: spacing.inputInset,
    paddingRight: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    borderRadius: radii.composer,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queuedComposerEditTitle: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  queuedComposerEditPreview: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.caption,
  },
  queuedComposerEditClose: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  composer: {
    minWidth: 0,
    flexShrink: 0,
    minHeight: touchTarget + COMPOSER_CHIP_BOTTOM_INSET + spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: COMPOSER_CHIP_BOTTOM_INSET,
    paddingBottom: spacing.compact,
    flexDirection: "row",
    alignSelf: "stretch",
    alignItems: "flex-end",
    gap: spacing.xs,
    overflow: "visible",
  },
  composerErrorRow: {
    minHeight: controlSize.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
  },
  composerError: { minWidth: 0, flex: 1, color: colors.red, ...typeScale.label },
  composerMenu: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    borderRadius: radii.composer,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  composerMenuActive: { backgroundColor: colors.primaryContainer },
  composerMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  composerMenuText: { color: colors.text, ...typeScale.body },
  composerInputShell: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    width: 0,
    minWidth: 0,
    minHeight: COMPOSER_MIN_HEIGHT,
    position: "relative",
    flexDirection: "row",
    alignItems: "flex-end",
    overflow: "visible",
    // The shell paints behind its native editor children. A separate opaque
    // sibling must not participate in their drawing order.
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.composer,
    borderWidth: 1,
    borderColor: colors.border,
  },
  composerInput: {
    minHeight: COMPOSER_MIN_HEIGHT,
    maxHeight: COMPOSER_MAX_HEIGHT,
    color: colors.text,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.xxs,
    paddingVertical: spacing.inputInset,
    ...typeScale.composerInput,
  },
  voiceCapture: {
    flex: 1,
    minHeight: touchTarget,
    paddingLeft: spacing.xxs,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.inputInset,
  },
  voiceMeter: {
    height: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  voiceMeterBar: {
    width: 3,
    minHeight: 4,
    maxHeight: 24,
    borderRadius: radii.compact,
    backgroundColor: colors.accent,
  },
  voiceCaptureLabel: {
    color: colors.textMuted,
    ...typeScale.voiceLabel,
    fontVariant: ["tabular-nums"],
  },
  composerIcon: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    borderRadius: radii.composer,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  sendButtonPressed: { backgroundColor: colors.primaryPressed },
  stopButton: { backgroundColor: colors.red },
  sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.heading },
  sheetPage: { width: "100%", minHeight: 0 },
  expandedSheetPage: { flex: 1 },
  menuTitleRow: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  sheetHeaderIconSlot: {
    width: controlSize.compact,
    height: controlSize.compact,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  queueRow: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    gap: spacing.compact,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.medium,
  },
  queueCompactRow: {
    minHeight: layoutSize.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  queueDragHandle: {
    width: 34,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  queueBody: { flex: 1, minWidth: 0, paddingVertical: spacing.xxs },
  queueText: { color: colors.text, ...typeScale.body },
  queueMetaRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  queueTime: { color: colors.textDim, ...typeScale.label },
  queueSteerButton: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.inputInset,
    borderRadius: radii.medium,
    backgroundColor: colors.accent,
  },
  queueSteerLabel: { color: colors.onPrimary, ...typeScale.body, fontWeight: typeWeight.semibold },
  optimisticAttachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.compact,
    marginBottom: spacing.compact,
  },
  menuNotice: { color: colors.textMuted, ...typeScale.body, paddingVertical: spacing.xs },
  menuScroll: { flex: 1, minHeight: 0 },
  menuScrollContent: { paddingBottom: spacing.sm },
  securitySettingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.row,
  },
  securitySettingIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  menuAction: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  menuActionIcon: {
    width: controlSize.regular,
    height: controlSize.regular,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  menuActionText: { flex: 1, minWidth: 0 },
  menuActionTitle: { color: colors.text, ...typeScale.title },
  menuActionSubtitle: { color: colors.textMuted, ...typeScale.label, marginTop: spacing.optical },
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  controlOption: {
    minHeight: layoutSize.header,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.selected,
  },
  controlOptionText: { flex: 1, minWidth: 0 },
  controlOptionTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  controlOptionTitleText: { minWidth: 0, flexShrink: 1 },
  controlOptionSelected: { backgroundColor: colors.primaryContainer },
  controlOptionAttention: { backgroundColor: colors.warningContainer },
  runtimeSelector: { flexShrink: 0, marginBottom: spacing.xs },
  disabled: { opacity: 0.42 },
  previewRoot: { flex: 1, backgroundColor: colors.background },
  previewEmbeddedRoot: {
    width: "100%",
    minHeight: 0,
    borderRadius: radii.medium,
    overflow: "hidden",
  },
  previewHeader: {
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.inputInset,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.inputInset,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  previewIdentity: { flex: 1, minWidth: 0 },
  previewSetup: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.inputInset,
  },
  previewWebView: { flex: 1, backgroundColor: colors.background },
  previewError: {
    color: colors.red,
    backgroundColor: colors.errorContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typeScale.label,
  },
  previewLoading: { position: "absolute", inset: 0 },
  tunnelTtlChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.compact },
  tunnelTtlChip: {
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainer,
  },
  tunnelTtlChipSelected: { backgroundColor: colors.primaryContainer },
  livePill: {
    paddingHorizontal: spacing.inputInset,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.successContainer,
  },
  livePillText: { color: colors.green, ...typeScale.label, fontWeight: typeWeight.semibold },
  approvalCard: {
    marginHorizontal: spacing.xs,
    marginTop: spacing.xxs,
    padding: spacing.xs,
    gap: spacing.xxs,
    borderRadius: radii.medium,
    backgroundColor: colors.warningContainer,
  },
  approvalInline: {
    marginHorizontal: 0,
    marginTop: spacing.optical,
    backgroundColor: colors.warningContainer,
  },
  approvalTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.compact },
  approvalTitle: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    flex: 1,
  },
  approvalPending: { color: colors.amber, ...typeScale.caption, fontWeight: typeWeight.semibold },
  approvalQueueCount: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  approvalReason: { color: colors.textMuted, ...typeScale.label },
  approvalCommand: {
    color: colors.text,
    backgroundColor: colors.code,
    borderRadius: radii.small,
    padding: spacing.compact,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
  },
  approvalCwd: { color: colors.textDim, ...typeScale.label },
  approvalQuestion: { gap: spacing.xxs },
  approvalInput: {
    minHeight: controlSize.touch,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    ...typeScale.label,
  },
  answerOptions: { gap: spacing.xxs },
  approvalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.compact,
    flexWrap: "wrap",
  },
  approvalButton: { minHeight: controlSize.regular, paddingHorizontal: spacing.sm },
  approvalDeclineButton: {
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.inputInset,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  approvalDeclineText: { color: colors.textMuted, fontWeight: typeWeight.semibold },
  modeSelector: { width: "100%", minHeight: touchTarget },
  overwriteRow: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  overwriteLabel: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.title },
  transferProgress: {
    minHeight: controlSize.compact,
    overflow: "hidden",
    justifyContent: "center",
    paddingVertical: spacing.xxs,
    borderRadius: radii.small,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  transferProgressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accentMuted,
  },
  transferProgressText: { color: colors.text, ...typeScale.label, paddingHorizontal: spacing.xs },
  successText: { color: colors.green, ...typeScale.label },
  dangerButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.error,
  },
  connectionSheetScroll: { width: "100%" },
  connectionSheetContent: { gap: spacing.xs },
  pairingHeader: {
    minHeight: layoutSize.header,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xxs,
  },
  pairingHeaderTitle: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.heading },
  pairingBack: {
    width: controlSize.regular,
    height: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  pairingBody: { gap: spacing.md, paddingBottom: spacing.optical },
  pairingHeroIcon: {
    width: controlSize.touch,
    height: controlSize.touch,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.primaryContainer,
  },
  pairingLead: {
    color: colors.text,
    ...typeScale.heading,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  pairingHint: {
    color: colors.textMuted,
    ...typeScale.body,
    textAlign: "center",
    paddingHorizontal: spacing.xs,
  },
  pairingCode: {
    color: colors.text,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
  },
  pairingActionStack: { gap: spacing.xs, marginTop: spacing.optical },
  pairingPrimaryAction: {
    minHeight: touchTarget,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pairingPrimaryText: {
    color: colors.onPrimary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  pairingSecondaryAction: {
    minHeight: touchTarget,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pairingSecondaryText: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  pairingTextAction: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  pairingTextActionLabel: {
    color: colors.textMuted,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  pairingSafety: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.compact,
    paddingTop: spacing.xxs,
  },
  pairingSafetyText: { color: colors.textDim, ...typeScale.label, flexShrink: 1 },
  pairingError: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.inputInset,
    borderRadius: radii.medium,
    backgroundColor: colors.errorContainer,
  },
  pairingReviewCard: {
    gap: spacing.inputInset,
    padding: spacing.sm,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainerLow,
  },
  pairingIdentityRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pairingIdentityFields: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pairingEmojiInput: {
    width: 52,
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.xs,
    ...typeScale.emoji,
    textAlign: "center",
  },
  pairingNameInput: {
    flex: 1,
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.sm,
    ...typeScale.title,
  },
  pairingServerMeta: {
    minHeight: layoutSize.metadataRow,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  pairingEndpoint: { color: colors.textMuted, ...typeScale.label, flex: 1 },
  pairingMetaText: { flex: 1, minWidth: 0, color: colors.textMuted, ...typeScale.label },
  pairingSuccess: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  pairingSuccessIcon: {
    width: 60,
    height: layoutSize.row,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  pairingSuccessTitle: { color: colors.text, ...typeScale.heading, textAlign: "center" },
  goalDialogContent: { gap: spacing.md },
  goalDialogIntro: { gap: spacing.xxs, paddingRight: spacing.xl },
  goalObjectiveInput: {
    minHeight: 112,
    color: colors.text,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    textAlignVertical: "top",
    ...typeScale.body,
  },
  goalClearPrompt: { color: colors.red, ...typeScale.label },
  goalDialogActions: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  fieldLabel: { color: colors.textMuted, ...typeScale.label, marginTop: spacing.xxs },
  fieldInput: {
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    ...typeScale.body,
  },
  errorText: { color: colors.red, ...typeScale.body },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.inputInset,
    marginTop: spacing.inputInset,
  },
  secondaryButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  secondaryButtonText: { color: colors.text, fontWeight: typeWeight.semibold },
  primaryButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: typeWeight.semibold },
  connectionEditor: { minWidth: 0 },
  connectionEditorForm: { paddingVertical: spacing.sm, gap: spacing.xs },
  connectionIdentityFields: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  connectionRow: { minHeight: layoutSize.row, paddingVertical: spacing.xs, gap: spacing.xxs },
  connectionSummary: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  connectionActions: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xxs,
  },
  connectionMiniButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  connectionActionMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  connectionEmojiInput: {
    width: 52,
    minHeight: controlSize.touch,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    ...typeScale.emoji,
  },
  connectionStateRow: {
    minHeight: 18,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    marginTop: spacing.xxs,
  },
  connectionStateIcon: {
    width: 12,
    height: 12,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  connectionEndpointRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  connectionEndpointText: { flex: 1, minWidth: 0 },
  connectionStateDot: { width: 7, height: 7, borderRadius: radii.pill },
  connectionStateText: {
    minWidth: 0,
    flexShrink: 1,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  connectionDiagnostic: {
    gap: spacing.xs,
    marginLeft: controlSize.touch,
    padding: spacing.inputInset,
    borderRadius: radii.medium,
    backgroundColor: colors.errorContainer,
  },
  connectionDiagnosticHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  connectionDiagnosticSummary: { flex: 1, color: colors.onErrorContainer, ...typeScale.label },
  connectionDiagnosticMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
  },
  connectionDiagnosticTime: { color: colors.textMuted, ...typeScale.caption },
  connectionDiagnosticRaw: {
    color: colors.onErrorContainer,
    ...typeScale.code,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    paddingLeft: spacing.lg,
  },
  accountPoolEditor: { gap: 0, marginTop: spacing.md },
  accountPoolHeader: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  accountPoolRow: {
    minHeight: layoutSize.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  accountPoolDivider: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  accountPoolTitleRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  accountPoolName: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.title },
  accountPoolRole: {
    flexShrink: 0,
    color: colors.textDim,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
  },
  accountPoolRoleActive: { color: colors.green },
  accountPoolLimit: {
    flexShrink: 0,
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
  accountPoolLimitPending: { color: colors.textDim, fontWeight: typeWeight.semibold },
  accountPoolMenuAnchor: { width: touchTarget, height: touchTarget, flexShrink: 0 },
  accountPoolAddButton: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  accountLoginSheet: { gap: spacing.md, paddingBottom: spacing.xs },
  accountLoginHeader: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  accountLoginIcon: {
    width: controlSize.regular,
    height: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
    backgroundColor: colors.primaryContainer,
  },
  accountLoginTitle: { color: colors.text, ...typeScale.heading },
  accountLoginSubtitle: { color: colors.textMuted, ...typeScale.body, marginTop: spacing.optical },
  accountLoginCodeCard: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainerLow,
  },
  accountLoginCodeLabel: { color: colors.textMuted, ...typeScale.label },
  accountLoginCode: {
    color: colors.text,
    ...typeScale.heading,
    fontFamily: Platform.select({ android: "monospace", default: "Courier" }),
    letterSpacing: typeTracking.pairingCode,
  },
  accountLoginCopyButton: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  accountLoginCopyButtonDone: {
    borderColor: colors.green,
    backgroundColor: colors.successContainer,
  },
  accountLoginCopyLabel: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  accountLoginCopyLabelDone: { color: colors.green },
  accountLoginHint: { color: colors.textMuted, ...typeScale.body },
  accountLoginPrimaryButton: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    gap: spacing.xs,
  },
  scannerRoot: { flex: 1, backgroundColor: colors.background },
  scannerHeader: {
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scannerCamera: { flex: 1, alignItems: "center", justifyContent: "center" },
  scannerFrame: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: radii.large,
    backgroundColor: "transparent",
  },
  scannerError: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    padding: spacing.sm,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerHigh,
  },
});
