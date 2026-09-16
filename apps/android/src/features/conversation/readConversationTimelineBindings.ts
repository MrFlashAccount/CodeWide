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
  overlayState: ConversationReadSurfaceProps["overlayState"];
  remoteThread: ConversationReadSurfaceProps["remoteThread"];
  server: ConversationReadSurfaceProps["server"];
  thread: ConversationReadSurfaceProps["thread"];
  viewport: ConversationReadSurfaceProps["viewport"];
}) {
  const windowLayout = useWindowLayout();
  const conversationInsets = useSafeAreaInsets();
  const composerScope = `${props.server?.id ?? "no-connection"}\u0000${props.thread.id}`;
  const connectionId = props.server?.id ?? null;
  const owner = useConversationOwner(composerScope);
  const {
    narrowConversationPane: narrow,
    setConversationPaneHeight: setPaneHeight,
    setNarrowConversationPane: setNarrow,
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
    composerScope,
    draftConnectionId: connectionId,
    draftThreadId: props.thread.id,
    remoteLiveTurns: props.remoteThread.turns.filter((turn) => turn.status === "inProgress"),
    remoteSealedTurns: props.remoteThread.turns.filter((turn) => turn.status !== "inProgress"),
    remoteThread: props.remoteThread,
    serverId: props.server?.id ?? "remote",
    timelineEntries: undefined,
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
    displayedTimeline: searchProjection.displayedTimeline,
    focusedSearchMessageRef: search.focusedSearchMessageRef,
    isCurrentSearchWindow: search.isCurrentSearchWindow,
    lastTimelineOffsetYRef: props.viewport.lastTimelineOffsetYRef,
    positionedSearchWindowRef: search.positionedSearchWindowRef,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    searchOriginOffsetRef: search.searchOriginOffsetRef,
    searchWindow: null,
    setThreadSearch: search.setThreadSearch,
    setThreadSearchMatch: search.setThreadSearchMatch,
    setThreadSearchVisible: search.setThreadSearchVisible,
    threadSearchActive: searchProjection.threadSearchActive,
    threadSearchMatch: search.threadSearchMatch,
    threadSearchMatches: searchProjection.threadSearchMatches,
    timelineContentHeightRef: props.viewport.timelineContentHeightRef,
    timelineIndexRetryTimerRef: search.timelineIndexRetryTimerRef,
    timelineModelReady: true,
    timelineRef: props.viewport.timelineRef,
    timelineViewportHeightRef: props.viewport.timelineViewportHeightRef,
    timelineViewportRef: props.viewport.timelineViewportRef,
  });
  const viewportActions = useTimelineViewportActions({
    displayedTimeline: searchProjection.displayedTimeline,
    draftConnectionId: connectionId,
    draftThreadId: props.thread.id,
    firstVisibleHistoryAnchorKeyRef: anchor.firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorRef: anchor.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorStatusRef: anchor.firstVisibleHistoryAnchorStatusRef,
    fullscreenScrollOwnership: props.overlayState.fullscreenScrollOwnership,
    historyViewport,
    lastTimelineOffsetYRef: props.viewport.lastTimelineOffsetYRef,
    paginationEdgeLockRef: props.viewport.paginationEdgeLockRef,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    threadSearchActive: searchProjection.threadSearchActive,
    timeline,
    timelineContentHeightRef: props.viewport.timelineContentHeightRef,
    timelineViewportHeightRef: props.viewport.timelineViewportHeightRef,
  });
  const unreadActions = useUnreadReceiptActions({
    acknowledgedUnreadReceiptKeyRef: unread.acknowledgedUnreadReceiptKeyRef,
    latestUnreadAgentRef: unread.latestUnreadAgentRef,
    latestUnreadReceiptKey: null,
    latestUnreadReceiptKeyRef: unread.latestUnreadReceiptKeyRef,
    onViewedLatest: undefined,
    timelineViewportRef: props.viewport.timelineViewportRef,
    unreadVisibilityFrameRef: unread.unreadVisibilityFrameRef,
    unreadVisibilityScheduledKeyRef: unread.unreadVisibilityScheduledKeyRef,
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
    acknowledgeUnreadReceipt: unreadActions.acknowledgeUnreadReceipt,
    awayFromLatestRef: anchor.awayFromLatestRef,
    composerScope,
    conversationOwner: owner,
    currentTurnId: presentation.currentTurnId,
    draftConnectionId: connectionId,
    draftThreadId: props.thread.id,
    firstVisibleHistoryAnchorKeyRef: anchor.firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorRef: anchor.firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorStatusRef: anchor.firstVisibleHistoryAnchorStatusRef,
    fullscreenScrollOwnership: props.overlayState.fullscreenScrollOwnership,
    historyViewport,
    latestUnreadReceiptKey: null,
    pendingLatestJump: anchor.pendingLatestJump,
    saveScrollOffset: undefined,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    scrollSaveTimerRef: anchor.scrollSaveTimerRef,
    searchWindow: null,
    setAwayFromLatest: anchor.setAwayFromLatest,
    setPendingLatestJump: anchor.setPendingLatestJump,
    setTimelineDidLoad: props.viewport.setTimelineDidLoad,
    timeline,
    timelineContentHeightRef: props.viewport.timelineContentHeightRef,
    timelineInitialPosition,
    timelineModelReady: true,
    timelineRef: props.viewport.timelineRef,
    timelineViewportHeightRef: props.viewport.timelineViewportHeightRef,
  });
  return {
    anchor,
    anchorActions,
    composerScope,
    connectionId,
    conversationInsets,
    historyViewport,
    narrow,
    presentation,
    search,
    searchActions,
    searchProjection,
    setNarrow,
    setPaneHeight,
    timeline,
    timelineInitialPosition,
    unread,
    unreadActions,
    viewportActions,
    windowLayout,
  };
}
