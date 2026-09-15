import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../../data/use-thread-history-controller";
import { useConversationOwner } from "../../ui/use-conversation-owner";
import { useWindowLayout } from "../workspace/useWindowLayout";
import { projectConversationPresentation } from "./conversationPresentation";
import type { ConversationReadSurfaceProps } from "./conversationReadCapabilities";
import { useHistoryAnchorActions, useHistoryAnchorState } from "./timeline/historyAnchor";
import { useInitialTimelinePosition } from "./timeline/initialTimelinePosition";
import { projectConversationTimeline } from "./timeline/timelineProjection";
import {
  useTimelineSearchActions,
  useTimelineSearchProjection,
  useTimelineSearchState,
} from "./timeline/timelineSearch";
import {
  useConversationPaneGeometry,
  useTimelineViewportActions,
} from "./timeline/timelineViewport";
import { useUnreadReceiptActions, useUnreadReceiptState } from "./timeline/unreadReceipt";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useReadConversationTimelineBindings(props: {
  server: ConversationReadSurfaceProps["server"];
  thread: ConversationReadSurfaceProps["thread"];
  remoteThread: ConversationReadSurfaceProps["remoteThread"];
  viewport: ConversationReadSurfaceProps["viewport"];
  overlayState: ConversationReadSurfaceProps["overlayState"];
}) {
  const windowLayout = useWindowLayout();
  const conversationInsets = useSafeAreaInsets();
  const composerScope = `${props.server?.id ?? "no-connection"}\u0000${props.thread.id}`;
  const connectionId = props.server?.id ?? null;
  const owner = useConversationOwner(composerScope);
  const {
    narrowConversationPane: narrow,
    setNarrowConversationPane: setNarrow,
    setConversationPaneHeight: setPaneHeight,
  } = useConversationPaneGeometry();
  const historyViewport = COMPLETE_STATIC_THREAD_HISTORY;
  const search = useTimelineSearchState(composerScope, null);
  const anchor = useHistoryAnchorState(
    composerScope,
    null,
    null,
    connectionId,
    props.thread.id,
    undefined,
  );
  const unread = useUnreadReceiptState(composerScope);
  const { timeline } = projectConversationTimeline({
    remoteThread: props.remoteThread,
    remoteSealedTurns: props.remoteThread.turns.filter((turn) => turn.status !== "inProgress"),
    remoteLiveTurns: props.remoteThread.turns.filter((turn) => turn.status === "inProgress"),
    timelineEntries: undefined,
    composerScope,
    serverId: props.server?.id ?? "remote",
    draftConnectionId: connectionId,
    draftThreadId: props.thread.id,
  });
  const presentation = projectConversationPresentation(
    props.remoteThread,
    true,
    timeline,
    props.thread.state,
    null,
  );
  const searchProjection = useTimelineSearchProjection(search.threadSearch, timeline);
  const searchActions = useTimelineSearchActions({
    focusedSearchMessageRef: search.focusedSearchMessageRef,
    positionedSearchWindowRef: search.positionedSearchWindowRef,
    isCurrentSearchWindow: search.isCurrentSearchWindow,
    searchOriginOffsetRef: search.searchOriginOffsetRef,
    timelineIndexRetryTimerRef: search.timelineIndexRetryTimerRef,
    threadSearchMatch: search.threadSearchMatch,
    setThreadSearch: search.setThreadSearch,
    setThreadSearchVisible: search.setThreadSearchVisible,
    setThreadSearchMatch: search.setThreadSearchMatch,
    timelineViewportRef: props.viewport.timelineViewportRef,
    timelineRef: props.viewport.timelineRef,
    lastTimelineOffsetYRef: props.viewport.lastTimelineOffsetYRef,
    timelineContentHeightRef: props.viewport.timelineContentHeightRef,
    timelineViewportHeightRef: props.viewport.timelineViewportHeightRef,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    searchWindow: null,
    timelineModelReady: true,
    threadSearchMatches: searchProjection.threadSearchMatches,
    threadSearchActive: searchProjection.threadSearchActive,
    displayedTimeline: searchProjection.displayedTimeline,
  });
  const viewportActions = useTimelineViewportActions({
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    lastTimelineOffsetYRef: props.viewport.lastTimelineOffsetYRef,
    paginationEdgeLockRef: props.viewport.paginationEdgeLockRef,
    timelineViewportHeightRef: props.viewport.timelineViewportHeightRef,
    timelineContentHeightRef: props.viewport.timelineContentHeightRef,
    firstVisibleHistoryAnchorRef: anchor.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorKeyRef: anchor.firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorStatusRef: anchor.firstVisibleHistoryAnchorStatusRef,
    fullscreenScrollOwnership: props.overlayState.fullscreenScrollOwnership,
    historyViewport,
    draftConnectionId: connectionId,
    draftThreadId: props.thread.id,
    timeline,
    displayedTimeline: searchProjection.displayedTimeline,
    threadSearchActive: searchProjection.threadSearchActive,
  });
  const unreadActions = useUnreadReceiptActions({
    latestUnreadAgentRef: unread.latestUnreadAgentRef,
    unreadVisibilityFrameRef: unread.unreadVisibilityFrameRef,
    unreadVisibilityScheduledKeyRef: unread.unreadVisibilityScheduledKeyRef,
    latestUnreadReceiptKeyRef: unread.latestUnreadReceiptKeyRef,
    acknowledgedUnreadReceiptKeyRef: unread.acknowledgedUnreadReceiptKeyRef,
    timelineViewportRef: props.viewport.timelineViewportRef,
    latestUnreadReceiptKey: null,
    onViewedLatest: undefined,
  });
  const timelineInitialPosition = useInitialTimelinePosition(
    search.searchTimelineScope,
    true,
    timeline,
    anchor.initialRestoreAnchorTurnId,
    anchor.initialHistoryRestore,
    null,
  );
  const anchorActions = useHistoryAnchorActions({
    awayFromLatestRef: anchor.awayFromLatestRef,
    setAwayFromLatest: anchor.setAwayFromLatest,
    firstVisibleHistoryAnchorRef: anchor.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorStatusRef: anchor.firstVisibleHistoryAnchorStatusRef,
    firstVisibleHistoryAnchorKeyRef: anchor.firstVisibleHistoryAnchorKeyRef,
    scrollSaveTimerRef: anchor.scrollSaveTimerRef,
    pendingLatestJump: anchor.pendingLatestJump,
    setPendingLatestJump: anchor.setPendingLatestJump,
    timelineContentHeightRef: props.viewport.timelineContentHeightRef,
    timelineViewportHeightRef: props.viewport.timelineViewportHeightRef,
    setTimelineDidLoad: props.viewport.setTimelineDidLoad,
    timelineRef: props.viewport.timelineRef,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    timelineInitialPosition,
    draftConnectionId: connectionId,
    draftThreadId: props.thread.id,
    timeline,
    currentTurnId: presentation.currentTurnId,
    composerScope,
    saveScrollOffset: undefined,
    latestUnreadReceiptKey: null,
    acknowledgeUnreadReceipt: unreadActions.acknowledgeUnreadReceipt,
    searchWindow: null,
    timelineModelReady: true,
    historyViewport,
    conversationOwner: owner,
    fullscreenScrollOwnership: props.overlayState.fullscreenScrollOwnership,
  });
  return {
    windowLayout,
    conversationInsets,
    composerScope,
    connectionId,
    narrow,
    setNarrow,
    setPaneHeight,
    historyViewport,
    search,
    anchor,
    unread,
    timeline,
    presentation,
    searchProjection,
    searchActions,
    viewportActions,
    unreadActions,
    timelineInitialPosition,
    anchorActions,
  };
}
