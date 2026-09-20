import { ConversationEmptyState } from "./ConversationEmptyState";
import type { ConversationReadSurfaceProps } from "./conversationReadCapabilities";
import { ReadSurfaceHeader } from "./header/ReadSurfaceHeader";
import { renderReadConversationLayout } from "./ReadConversationLayout";
import { useReadConversationTimelineBindings } from "./readConversationTimelineBindings";
import { ConversationTimelineSurface } from "./timeline/ConversationTimelineSurface";
import { useTimelineCleanup } from "./timeline/historyAnchor";
import { useConversationAndroidBack } from "./timeline/overlayScrollOwnership";
import { useThreadTimeline, useThreadTimelineActions } from "./timeline/ThreadTimeline";
import { projectTimelineDateLabels } from "./timeline/timelineProjection";
import { TimelineViewport } from "./timeline/TimelineViewport";

/** Projects authoritative thread data into the read-only conversation surface. */
export function ConversationReadSurface(props: ConversationReadSurfaceProps) {
  const read = useReadConversationTimelineBindings({
    overlayState: props.overlayState,
    remoteThread: props.remoteThread,
    server: props.server,
    thread: props.thread,
    viewport: props.viewport,
  });
  useTimelineCleanup({
    composerScope: read.composerScope,
    fullscreenOverlay: props.overlay.fullscreenOverlay,
    latestUnreadAgentRef: read.unread.latestUnreadAgentRef,
    mountedConversationScopeRef: read.anchor.mountedConversationScopeRef,
    paginationTrimTimerRef: props.viewport.paginationTrimTimerRef,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    scrollSaveTimerRef: read.anchor.scrollSaveTimerRef,
    timelineIndexRetryTimerRef: read.search.timelineIndexRetryTimerRef,
    unreadVisibilityFrameRef: read.unread.unreadVisibilityFrameRef,
  });
  useConversationAndroidBack(false, () => undefined, props.compact, props.onBack);
  const rowActions = useThreadTimelineActions(props.onFixUnsupportedBlock, undefined, undefined);
  const rows = useThreadTimeline({
    animateLiveUpdates: props.server?.status === "live",
    composerScope: read.composerScope,
    fixUnsupportedBlock: rowActions.fixUnsupportedBlock,
    focusSearchMessage: read.searchActions.focusSearchMessage,
    forkThroughTurn: rowActions.forkThroughTurn,
    getStableTransferAccess: props.getStableTransferAccess,
    getTransferAccess: props.getTransferAccess,
    latestUnreadAgentTurnId: null,
    loadStableTurnItems: rowActions.loadStableTurnItems,
    onFixUnsupportedBlock: props.onFixUnsupportedBlock,
    onFork: undefined,
    onLoadTurnItems: undefined,
    onRetryFailedMessage: undefined,
    openThreadDocumentLink: props.openThreadDocumentLink,
    requestPrompt: null,
    scheduleUnreadAgentVisibilityCheck: read.unreadActions.scheduleUnreadAgentVisibilityCheck,
    searchWindow: null,
    setLatestUnreadAgentNode: read.unreadActions.setLatestUnreadAgentNode,
    threadSearchActive: read.searchProjection.threadSearchActive,
    timelineCompact: props.compact || read.narrow,
    timelineDateLabels: projectTimelineDateLabels(read.timeline, true),
  });
  const timelinePositioned = read.timeline.length === 0 || props.viewport.timelineDidLoad;
  const liveStatusVisible =
    read.presentation.liveTurnPlan !== null &&
    timelinePositioned &&
    !read.searchProjection.threadSearchActive;
  const timelineContent = (
    <TimelineViewport
      {...props.viewport}
      {...read.search}
      {...read.searchProjection}
      {...read.viewportActions}
      {...read.anchorActions}
      {...read.jumpActions}
      {...props.pagination}
      awayFromLatest={read.anchor.awayFromLatest}
      awayFromLatestRef={read.anchor.awayFromLatestRef}
      composerScope={read.composerScope}
      conversationInsets={read.conversationInsets}
      draftConnectionId={read.connectionId}
      draftThreadId={props.thread.id}
      emptyContent={
        <ConversationEmptyState
          cwd={props.remoteThread.cwd}
          historyActivityModel={null}
          historyActivityResourceId={null}
          newChat={false}
          onChangeWorkspaceMode={undefined}
          openProjectPicker={() => undefined}
          threadSearchActive={read.searchProjection.threadSearchActive}
          workspaceMode="current"
          workspaceSupport={null}
        />
      }
      firstVisibleHistoryAnchorRef={read.anchor.firstVisibleHistoryAnchorRef}
      footerContent={null}
      fullscreenCovered={props.overlayState.fullscreenCovered}
      fullscreenScrollOwnership={props.overlayState.fullscreenScrollOwnership}
      historyViewport={read.historyViewport}
      inlineQueueExpanded={false}
      latestUnreadAgentRef={read.unread.latestUnreadAgentRef}
      latestUnreadAgentTurnId={null}
      liveStatusVisible={liveStatusVisible}
      renderTimelineItem={rows.renderTimelineItem}
      scheduleUnreadAgentVisibilityCheck={read.unreadActions.scheduleUnreadAgentVisibilityCheck}
      searchMessageItemId={null}
      setAwayFromLatest={read.anchor.setAwayFromLatest}
      timelineCompact={props.compact || read.narrow}
      timelinePositioned={timelinePositioned}
      timelineViewportRef={props.viewport.timelineViewportRef}
      windowLayout={read.windowLayout}
    />
  );
  const headerContent = (
    <ReadSurfaceHeader
      closeThreadSearch={read.searchActions.closeThreadSearch}
      compact={props.compact}
      cwd={props.remoteThread.cwd}
      dismissComposerKeyboardForOverlay={props.overlay.dismissComposerKeyboardForOverlay}
      draftConnectionId={read.connectionId}
      draftThreadId={props.thread.id}
      onBack={props.onBack}
      remoteThread={props.remoteThread}
      server={props.server}
      sessionCompactionCount={read.presentation.sessionCompactionCount}
      setThreadSearchVisible={read.search.setThreadSearchVisible}
      thread={props.thread}
      threadSearchVisible={read.search.threadSearchVisible}
    />
  );
  const timelineSurface = (
    <ConversationTimelineSurface
      {...props.viewport}
      {...read.anchorActions}
      {...read.searchProjection}
      awayFromLatest={read.anchor.awayFromLatest}
      commitUnreadReceipt={read.unreadActions.commitUnreadReceipt}
      composerScope={read.composerScope}
      draftConnectionId={read.connectionId}
      draftThreadId={props.thread.id}
      fullscreenCovered={props.overlayState.fullscreenCovered}
      goalContent={null}
      historyActivityModel={null}
      historyActivityResourceId={null}
      historyViewport={read.historyViewport}
      latestUnreadReceiptKey={null}
      liveStatusVisible={liveStatusVisible}
      liveTurnPlan={read.presentation.liveTurnPlan}
      messageListState={{ status: "ready" }}
      positionSearchTurn={read.searchActions.positionSearchTurn}
      readOnly
      remoteThread={props.remoteThread}
      timeline={read.timeline}
      timelineContent={timelineContent}
      timelineModelReady
      timelinePositioned={timelinePositioned}
    />
  );
  return renderReadConversationLayout({
    headerContent,
    props,
    read,
    timelinePositioned,
    timelineSurface,
  });
}
