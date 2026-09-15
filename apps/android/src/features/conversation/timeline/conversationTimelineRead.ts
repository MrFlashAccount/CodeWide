import type { MainThreadReadCapabilities } from "../mainThreadReadCapabilities";
import type { ConversationSurfaceCapabilities } from "../conversationSurfaceCapabilities";
import { useConversationOwner } from "../../../ui/use-conversation-owner";
import { projectConversationPresentation } from "../conversationPresentation";
import { useConversationTimelineState } from "./conversationTimelineState";
import { useHistoryAnchorActions, useTimelineCleanup } from "./historyAnchor";
import { useInitialTimelinePosition } from "./initialTimelinePosition";
import { useOverlayScrollOwnership, useOverlayScrollState } from "./overlayScrollOwnership";
import { projectConversationTimeline, projectTimelineDateLabels } from "./timelineProjection";
import { useTimelineSearchActions, useTimelineSearchProjection } from "./timelineSearch";
import { useTimelineViewportActions } from "./timelineViewport";
import { projectUnreadReceipt, useUnreadReceiptActions } from "./unreadReceipt";

export function useConversationTimelineRead({
  timelineState,
  unread,
  readInputs,
  composerScope,
  surfaceInputs,
  draftConnectionId,
  draftThreadId,
  historyViewport,
  currentOutcome,
  messageListState,
  overlayScrollStateBinding,
  searchWindow,
  newChat,
  historyRestoreReady,
  conversationOwner,
  overlayScrollOwnershipBinding,
}: {
  timelineState: ReturnType<typeof useConversationTimelineState>;
  unread: Exclude<ConversationSurfaceCapabilities["unread"], undefined>;
  readInputs: MainThreadReadCapabilities;
  composerScope: string;
  surfaceInputs: ConversationSurfaceCapabilities;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  historyViewport: Exclude<MainThreadReadCapabilities["historyViewport"], undefined>;
  currentOutcome: Exclude<MainThreadReadCapabilities["currentOutcome"], undefined>;
  messageListState: Exclude<MainThreadReadCapabilities["messageListState"], undefined>;
  overlayScrollStateBinding: ReturnType<typeof useOverlayScrollState>;
  searchWindow: Exclude<MainThreadReadCapabilities["searchWindow"], undefined>;
  newChat: Exclude<ConversationSurfaceCapabilities["newChat"], undefined>;
  historyRestoreReady: Exclude<MainThreadReadCapabilities["historyRestoreReady"], undefined>;
  conversationOwner: ReturnType<typeof useConversationOwner>;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
}) {
  const newItemCount = timelineState.historyAnchorStateBinding.awayFromLatest ? unread : 0;
  const conversationTimelineBinding = projectConversationTimeline({
    remoteThread: readInputs.remoteThread,
    remoteSealedTurns: readInputs.remoteSealedTurns,
    remoteLiveTurns: readInputs.remoteLiveTurns,
    timelineEntries: readInputs.timelineEntries,
    composerScope,
    serverId: surfaceInputs.server?.id ?? "remote",
    draftConnectionId,
    draftThreadId,
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
    latestUnreadAgentRef: timelineState.unreadReceiptStateBinding.latestUnreadAgentRef,
    unreadVisibilityFrameRef: timelineState.unreadReceiptStateBinding.unreadVisibilityFrameRef,
    unreadVisibilityScheduledKeyRef:
      timelineState.unreadReceiptStateBinding.unreadVisibilityScheduledKeyRef,
    latestUnreadReceiptKeyRef: timelineState.unreadReceiptStateBinding.latestUnreadReceiptKeyRef,
    acknowledgedUnreadReceiptKeyRef:
      timelineState.unreadReceiptStateBinding.acknowledgedUnreadReceiptKeyRef,
    timelineViewportRef: timelineState.timelineViewportStateBinding.timelineViewportRef,
    latestUnreadReceiptKey: unreadReceiptBinding.latestUnreadReceiptKey,
    onViewedLatest: surfaceInputs.onViewedLatest,
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
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    lastTimelineOffsetYRef: timelineState.timelineViewportStateBinding.lastTimelineOffsetYRef,
    paginationEdgeLockRef: timelineState.timelineViewportStateBinding.paginationEdgeLockRef,
    timelineViewportHeightRef: timelineState.timelineViewportStateBinding.timelineViewportHeightRef,
    timelineContentHeightRef: timelineState.timelineViewportStateBinding.timelineContentHeightRef,
    firstVisibleHistoryAnchorRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorKeyRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorStatusRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorStatusRef,
    fullscreenScrollOwnership: overlayScrollStateBinding.fullscreenScrollOwnership,
    historyViewport,
    draftConnectionId,
    draftThreadId,
    timeline: conversationTimelineBinding.timeline,
    displayedTimeline: timelineSearchProjectionBinding.displayedTimeline,
    threadSearchActive: timelineSearchProjectionBinding.threadSearchActive,
  });
  const timelineSearchActionsBinding = useTimelineSearchActions({
    focusedSearchMessageRef: timelineState.timelineSearchStateBinding.focusedSearchMessageRef,
    positionedSearchWindowRef: timelineState.timelineSearchStateBinding.positionedSearchWindowRef,
    isCurrentSearchWindow: timelineState.timelineSearchStateBinding.isCurrentSearchWindow,
    searchOriginOffsetRef: timelineState.timelineSearchStateBinding.searchOriginOffsetRef,
    timelineIndexRetryTimerRef: timelineState.timelineSearchStateBinding.timelineIndexRetryTimerRef,
    threadSearchMatch: timelineState.timelineSearchStateBinding.threadSearchMatch,
    setThreadSearch: timelineState.timelineSearchStateBinding.setThreadSearch,
    setThreadSearchVisible: timelineState.timelineSearchStateBinding.setThreadSearchVisible,
    setThreadSearchMatch: timelineState.timelineSearchStateBinding.setThreadSearchMatch,
    timelineViewportRef: timelineState.timelineViewportStateBinding.timelineViewportRef,
    timelineRef: timelineState.timelineViewportStateBinding.timelineRef,
    lastTimelineOffsetYRef: timelineState.timelineViewportStateBinding.lastTimelineOffsetYRef,
    timelineContentHeightRef: timelineState.timelineViewportStateBinding.timelineContentHeightRef,
    timelineViewportHeightRef: timelineState.timelineViewportStateBinding.timelineViewportHeightRef,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    searchWindow,
    timelineModelReady,
    threadSearchMatches: timelineSearchProjectionBinding.threadSearchMatches,
    threadSearchActive: timelineSearchProjectionBinding.threadSearchActive,
    displayedTimeline: timelineSearchProjectionBinding.displayedTimeline,
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
    awayFromLatestRef: timelineState.historyAnchorStateBinding.awayFromLatestRef,
    setAwayFromLatest: timelineState.historyAnchorStateBinding.setAwayFromLatest,
    firstVisibleHistoryAnchorRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorStatusRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorStatusRef,
    firstVisibleHistoryAnchorKeyRef:
      timelineState.historyAnchorStateBinding.firstVisibleHistoryAnchorKeyRef,
    scrollSaveTimerRef: timelineState.historyAnchorStateBinding.scrollSaveTimerRef,
    pendingLatestJump: timelineState.historyAnchorStateBinding.pendingLatestJump,
    setPendingLatestJump: timelineState.historyAnchorStateBinding.setPendingLatestJump,
    timelineContentHeightRef: timelineState.timelineViewportStateBinding.timelineContentHeightRef,
    timelineViewportHeightRef: timelineState.timelineViewportStateBinding.timelineViewportHeightRef,
    setTimelineDidLoad: timelineState.timelineViewportStateBinding.setTimelineDidLoad,
    timelineRef: timelineState.timelineViewportStateBinding.timelineRef,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    timelineInitialPosition,
    draftConnectionId,
    draftThreadId,
    timeline: conversationTimelineBinding.timeline,
    currentTurnId: conversationPresentationBinding.currentTurnId,
    composerScope,
    saveScrollOffset: readInputs.saveScrollOffset,
    latestUnreadReceiptKey: unreadReceiptBinding.latestUnreadReceiptKey,
    acknowledgeUnreadReceipt: unreadReceiptActionsBinding.acknowledgeUnreadReceipt,
    searchWindow,
    timelineModelReady,
    historyViewport,
    conversationOwner,
    fullscreenScrollOwnership: overlayScrollStateBinding.fullscreenScrollOwnership,
  });
  useTimelineCleanup({
    scrollSaveTimerRef: timelineState.historyAnchorStateBinding.scrollSaveTimerRef,
    mountedConversationScopeRef:
      timelineState.historyAnchorStateBinding.mountedConversationScopeRef,
    scrollOffsetRef: timelineState.timelineViewportStateBinding.scrollOffsetRef,
    paginationTrimTimerRef: timelineState.timelineViewportStateBinding.paginationTrimTimerRef,
    unreadVisibilityFrameRef: timelineState.unreadReceiptStateBinding.unreadVisibilityFrameRef,
    latestUnreadAgentRef: timelineState.unreadReceiptStateBinding.latestUnreadAgentRef,
    timelineIndexRetryTimerRef: timelineState.timelineSearchStateBinding.timelineIndexRetryTimerRef,
    fullscreenOverlay: overlayScrollOwnershipBinding.fullscreenOverlay,
    composerScope,
  });
  return {
    conversationPresentationBinding,
    timelinePositioned,
    timelineSearchProjectionBinding,
    timelineDateLabels,
    timelineSearchActionsBinding,
    unreadReceiptBinding,
    unreadReceiptActionsBinding,
    timelineInitialPosition,
    historyAnchorActionsBinding,
    timelineViewportActionsBinding,
    emptyRemoteThread,
    conversationTimelineBinding,
    timelineModelReady,
    newItemCount,
    conversationBackdropVisible,
  };
}
