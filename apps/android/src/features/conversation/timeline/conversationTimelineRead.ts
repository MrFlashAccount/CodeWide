import type { MainThreadReadCapabilities } from "../mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "../conversationSurfaceCapabilities";
import type { useConversationOwner } from "../../../ui/use-conversation-owner";
import { projectConversationPresentation } from "../conversationPresentation";
import type { useConversationTimelineState } from "./conversationTimelineState";
import { useHistoryAnchorActions, useTimelineCleanup } from "./historyAnchor";
import { useInitialTimelinePosition } from "./initialTimelinePosition";
import type { useOverlayScrollOwnership, useOverlayScrollState } from "./overlayScrollOwnership";
import { projectConversationTimeline, projectTimelineDateLabels } from "./timelineProjection";
import { useTimelineSearchActions, useTimelineSearchProjection } from "./timelineSearch";
import { useTimelineViewportActions } from "./timelineViewport";
import { projectUnreadReceipt, useUnreadReceiptActions } from "./unreadReceipt";

export function useConversationTimelineRead({
  composerScope,
  conversationOwner,
  currentOutcome,
  draftConnectionId,
  draftThreadId,
  historyRestoreReady,
  historyViewport,
  messageListState,
  newChat,
  overlayScrollOwnershipBinding,
  overlayScrollStateBinding,
  readInputs,
  searchWindow,
  surfaceInputs,
  timelineState,
  unread,
}: {
  composerScope: string;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  currentOutcome: Exclude<MainThreadReadCapabilities["currentOutcome"], undefined>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  historyRestoreReady: Exclude<MainThreadReadCapabilities["historyRestoreReady"], undefined>;
  historyViewport: Exclude<MainThreadReadCapabilities["historyViewport"], undefined>;
  messageListState: Exclude<MainThreadReadCapabilities["messageListState"], undefined>;
  newChat: Exclude<ConversationSurfaceCapabilities["newChat"], undefined>;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  overlayScrollStateBinding: ReturnType<typeof useOverlayScrollState>;
  readInputs: MainThreadReadCapabilities;
  searchWindow: Exclude<MainThreadReadCapabilities["searchWindow"], undefined>;
  surfaceInputs: ConversationSurfaceCapabilities;
  timelineState: ReturnType<typeof useConversationTimelineState>;
  unread: Exclude<ConversationSurfaceCapabilities["unread"], undefined>;
}) {
  const newItemCount = timelineState.historyAnchorStateBinding.awayFromLatest ? unread : 0;
  const conversationTimelineBinding = projectConversationTimeline({
    composerScope,
    draftConnectionId,
    draftThreadId,
    remoteLiveTurns: readInputs.remoteLiveTurns,
    remoteSealedTurns: readInputs.remoteSealedTurns,
    remoteThread: readInputs.remoteThread,
    serverId: surfaceInputs.server?.id ?? "remote",
    timelineEntries: readInputs.timelineEntries,
  });
  const conversationPresentationBinding = projectConversationPresentation(
    readInputs.remoteThread,
    historyViewport.completeTurnHeaders,
    conversationTimelineBinding.timeline,
    surfaceInputs.thread?.state,
    currentOutcome,
  );
  const unreadReceiptBinding = projectUnreadReceipt(
    conversationTimelineBinding.timeline,
    unread,
    composerScope,
    draftConnectionId,
    draftThreadId,
  );
  const unreadReceiptActionsBinding = useUnreadReceiptActions({
    acknowledgedUnreadReceiptKeyRef:
      timelineState.unreadReceiptStateBinding.acknowledgedUnreadReceiptKeyRef,
    latestUnreadAgentRef: timelineState.unreadReceiptStateBinding.latestUnreadAgentRef,
    latestUnreadReceiptKey: unreadReceiptBinding.latestUnreadReceiptKey,
    latestUnreadReceiptKeyRef: timelineState.unreadReceiptStateBinding.latestUnreadReceiptKeyRef,
    onViewedLatest: surfaceInputs.onViewedLatest,
    timelineViewportRef: timelineState.timelineViewportStateBinding.timelineViewportRef,
    unreadVisibilityFrameRef: timelineState.unreadReceiptStateBinding.unreadVisibilityFrameRef,
    unreadVisibilityScheduledKeyRef:
      timelineState.unreadReceiptStateBinding.unreadVisibilityScheduledKeyRef,
  });
  const timelineModelReady = messageListState.status === "ready";
  const timelinePositioned =
    timelineModelReady &&
    (conversationTimelineBinding.timeline.length === 0 ||
      timelineState.timelineViewportStateBinding.timelineDidLoad);
  const conversationBackdropVisible =
    timelinePositioned && conversationTimelineBinding.timeline.length > 0;
  const timelineSearchProjectionBinding = useTimelineSearchProjection(
    timelineState.timelineSearchStateBinding.threadSearch,
    conversationTimelineBinding.timeline,
  );
  const timelineViewportActionsBinding = useTimelineViewportActions({
    displayedTimeline: timelineSearchProjectionBinding.displayedTimeline,
    draftConnectionId,
    draftThreadId,
    firstVisibleHistoryAnchorKeyRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorStatusRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorStatusRef,
    fullscreenScrollOwnership: overlayScrollStateBinding.fullscreenScrollOwnership,
    historyViewport,
    lastTimelineOffsetYRef: timelineState.timelineViewportStateBinding.lastTimelineOffsetYRef,
    paginationEdgeLockRef: timelineState.timelineViewportStateBinding.paginationEdgeLockRef,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    threadSearchActive: timelineSearchProjectionBinding.threadSearchActive,
    timeline: conversationTimelineBinding.timeline,
    timelineContentHeightRef: timelineState.timelineViewportStateBinding.timelineContentHeightRef,
    timelineViewportHeightRef: timelineState.timelineViewportStateBinding.timelineViewportHeightRef,
  });
  const timelineSearchActionsBinding = useTimelineSearchActions({
    displayedTimeline: timelineSearchProjectionBinding.displayedTimeline,
    focusedSearchMessageRef: timelineState.timelineSearchStateBinding.focusedSearchMessageRef,
    isCurrentSearchWindow: timelineState.timelineSearchStateBinding.isCurrentSearchWindow,
    lastTimelineOffsetYRef: timelineState.timelineViewportStateBinding.lastTimelineOffsetYRef,
    positionedSearchWindowRef: timelineState.timelineSearchStateBinding.positionedSearchWindowRef,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    searchOriginOffsetRef: timelineState.timelineSearchStateBinding.searchOriginOffsetRef,
    searchWindow,
    setThreadSearch: timelineState.timelineSearchStateBinding.setThreadSearch,
    setThreadSearchMatch: timelineState.timelineSearchStateBinding.setThreadSearchMatch,
    setThreadSearchVisible: timelineState.timelineSearchStateBinding.setThreadSearchVisible,
    threadSearchActive: timelineSearchProjectionBinding.threadSearchActive,
    threadSearchMatch: timelineState.timelineSearchStateBinding.threadSearchMatch,
    threadSearchMatches: timelineSearchProjectionBinding.threadSearchMatches,
    timelineContentHeightRef: timelineState.timelineViewportStateBinding.timelineContentHeightRef,
    timelineIndexRetryTimerRef: timelineState.timelineSearchStateBinding.timelineIndexRetryTimerRef,
    timelineModelReady,
    timelineRef: timelineState.timelineViewportStateBinding.timelineRef,
    timelineViewportHeightRef: timelineState.timelineViewportStateBinding.timelineViewportHeightRef,
    timelineViewportRef: timelineState.timelineViewportStateBinding.timelineViewportRef,
  });
  const timelineDateLabels = projectTimelineDateLabels(
    conversationTimelineBinding.timeline,
    historyViewport.containsBeginning,
  );
  const timelineInitialPosition = useInitialTimelinePosition(
    timelineState.timelineSearchStateBinding.searchTimelineScope,
    timelineModelReady,
    conversationTimelineBinding.timeline,
    timelineState.historyAnchorStateBinding.initialRestoreAnchorTurnId,
    timelineState.historyAnchorStateBinding.initialHistoryRestore,
    searchWindow,
  );
  const emptyRemoteThread =
    newChat ||
    (readInputs.remoteThread !== null &&
      readInputs.remoteThread !== undefined &&
      historyRestoreReady &&
      historyViewport.readStatus() === "ready" &&
      readInputs.remoteThread.turns.length === 0 &&
      !conversationTimelineBinding.timeline.some((item) => item.kind === "optimistic"));
  const historyAnchorActionsBinding = useHistoryAnchorActions({
    acknowledgeUnreadReceipt: unreadReceiptActionsBinding.acknowledgeUnreadReceipt,
    awayFromLatestRef: timelineState.historyAnchorStateBinding.awayFromLatestRef,
    composerScope,
    conversationOwner,
    currentTurnId: conversationPresentationBinding.currentTurnId,
    draftConnectionId,
    draftThreadId,
    firstVisibleHistoryAnchorKeyRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorStatusRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorStatusRef,
    fullscreenScrollOwnership: overlayScrollStateBinding.fullscreenScrollOwnership,
    historyViewport,
    latestUnreadReceiptKey: unreadReceiptBinding.latestUnreadReceiptKey,
    pendingLatestJump: timelineState.historyAnchorStateBinding.pendingLatestJump,
    saveScrollOffset: readInputs.saveScrollOffset,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    scrollSaveTimerRef: timelineState.historyAnchorStateBinding.scrollSaveTimerRef,
    searchWindow,
    setAwayFromLatest: timelineState.historyAnchorStateBinding.setAwayFromLatest,
    setPendingLatestJump: timelineState.historyAnchorStateBinding.setPendingLatestJump,
    setTimelineDidLoad: timelineState.timelineViewportStateBinding.setTimelineDidLoad,
    timeline: conversationTimelineBinding.timeline,
    timelineContentHeightRef: timelineState.timelineViewportStateBinding.timelineContentHeightRef,
    timelineInitialPosition,
    timelineModelReady,
    timelineRef: timelineState.timelineViewportStateBinding.timelineRef,
    timelineViewportHeightRef: timelineState.timelineViewportStateBinding.timelineViewportHeightRef,
  });
  useTimelineCleanup({
    composerScope,
    fullscreenOverlay: overlayScrollOwnershipBinding.fullscreenOverlay,
    latestUnreadAgentRef: timelineState.unreadReceiptStateBinding.latestUnreadAgentRef,
    mountedConversationScopeRef:
      timelineState.historyAnchorStateBinding.mountedConversationScopeRef,
    paginationTrimTimerRef: timelineState.timelineViewportStateBinding.paginationTrimTimerRef,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    scrollSaveTimerRef: timelineState.historyAnchorStateBinding.scrollSaveTimerRef,
    timelineIndexRetryTimerRef: timelineState.timelineSearchStateBinding.timelineIndexRetryTimerRef,
    unreadVisibilityFrameRef: timelineState.unreadReceiptStateBinding.unreadVisibilityFrameRef,
  });
  return {
    conversationBackdropVisible,
    conversationPresentationBinding,
    conversationTimelineBinding,
    emptyRemoteThread,
    historyAnchorActionsBinding,
    newItemCount,
    timelineDateLabels,
    timelineInitialPosition,
    timelineModelReady,
    timelinePositioned,
    timelineSearchActionsBinding,
    timelineSearchProjectionBinding,
    timelineViewportActionsBinding,
    unreadReceiptActionsBinding,
    unreadReceiptBinding,
  };
}
