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

export function ConversationReadSurface(props: ConversationReadSurfaceProps) {
  const read = useReadConversationTimelineBindings({
    server: props.server,
    thread: props.thread,
    remoteThread: props.remoteThread,
    viewport: props.viewport,
    overlayState: props.overlayState,
  });
  useTimelineCleanup({
    composerScope: read.composerScope,
    scrollSaveTimerRef: read.anchor.scrollSaveTimerRef,
    mountedConversationScopeRef: read.anchor.mountedConversationScopeRef,
    scrollOffsetRef: props.viewport.scrollOffsetRef,
    paginationTrimTimerRef: props.viewport.paginationTrimTimerRef,
    unreadVisibilityFrameRef: read.unread.unreadVisibilityFrameRef,
    latestUnreadAgentRef: read.unread.latestUnreadAgentRef,
    timelineIndexRetryTimerRef: read.search.timelineIndexRetryTimerRef,
    fullscreenOverlay: props.overlay.fullscreenOverlay,
  });
  useConversationAndroidBack(false, () => undefined, props.compact, props.onBack);
  const rowActions = useThreadTimelineActions(props.onFixUnsupportedBlock, undefined, undefined);
  const rows = useThreadTimeline({
    fixUnsupportedBlock: rowActions.fixUnsupportedBlock,
    forkThroughTurn: rowActions.forkThroughTurn,
    loadStableTurnItems: rowActions.loadStableTurnItems,
    onFixUnsupportedBlock: props.onFixUnsupportedBlock,
    onFork: undefined,
    onLoadTurnItems: undefined,
    timelineDateLabels: projectTimelineDateLabels(read.timeline, true),
    searchWindow: null,
    focusSearchMessage: read.searchActions.focusSearchMessage,
    openThreadDocumentLink: props.openThreadDocumentLink,
    composerScope: read.composerScope,
    getTransferAccess: props.getTransferAccess,
    getStableTransferAccess: props.getStableTransferAccess,
    timelineCompact: props.compact || read.narrow,
    animateLiveUpdates: props.server?.status === "live",
    threadSearchActive: read.searchProjection.threadSearchActive,
    requestPrompt: null,
    latestUnreadAgentTurnId: null,
    setLatestUnreadAgentNode: read.unreadActions.setLatestUnreadAgentNode,
    scheduleUnreadAgentVisibilityCheck: read.unreadActions.scheduleUnreadAgentVisibilityCheck,
    onRetryFailedMessage: undefined,
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
      {...props.pagination}
      composerScope={read.composerScope}
      timelineInitialPosition={read.timelineInitialPosition}
      windowLayout={read.windowLayout}
      timelineCompact={props.compact || read.narrow}
      liveStatusVisible={liveStatusVisible}
      conversationInsets={read.conversationInsets}
      fullscreenCovered={props.overlayState.fullscreenCovered}
      historyViewport={read.historyViewport}
      awayFromLatest={read.anchor.awayFromLatest}
      inlineQueueExpanded={false}
      draftConnectionId={read.connectionId}
      draftThreadId={props.thread.id}
      scheduleUnreadAgentVisibilityCheck={read.unreadActions.scheduleUnreadAgentVisibilityCheck}
      fullscreenScrollOwnership={props.overlayState.fullscreenScrollOwnership}
      firstVisibleHistoryAnchorRef={read.anchor.firstVisibleHistoryAnchorRef}
      awayFromLatestRef={read.anchor.awayFromLatestRef}
      setAwayFromLatest={read.anchor.setAwayFromLatest}
      timelinePositioned={timelinePositioned}
      renderTimelineItem={rows.renderTimelineItem}
      emptyContent={
        <ConversationEmptyState
          historyActivityModel={null}
          historyActivityResourceId={null}
          threadSearchActive={read.searchProjection.threadSearchActive}
          emptyRemoteThread={props.remoteThread.turns.length === 0}
          cwd={props.remoteThread.cwd}
          openProjectPicker={() => undefined}
          workspaceSupport={null}
          onChangeWorkspaceMode={undefined}
          workspaceMode="current"
        />
      }
      footerContent={null}
    />
  );
  const headerContent = (
    <ReadSurfaceHeader
      compact={props.compact}
      onBack={props.onBack}
      thread={props.thread}
      server={props.server}
      cwd={props.remoteThread.cwd}
      remoteThread={props.remoteThread}
      draftConnectionId={read.connectionId}
      draftThreadId={props.thread.id}
      threadSearchVisible={read.search.threadSearchVisible}
      closeThreadSearch={read.searchActions.closeThreadSearch}
      setThreadSearchVisible={read.search.setThreadSearchVisible}
      sessionCompactionCount={read.presentation.sessionCompactionCount}
      dismissComposerKeyboardForOverlay={props.overlay.dismissComposerKeyboardForOverlay}
    />
  );
  const timelineSurface = (
    <ConversationTimelineSurface
      {...props.viewport}
      {...read.anchorActions}
      {...read.searchProjection}
      draftConnectionId={read.connectionId}
      draftThreadId={props.thread.id}
      composerScope={read.composerScope}
      timeline={read.timeline}
      readOnly
      historyViewport={read.historyViewport}
      latestUnreadReceiptKey={null}
      commitUnreadReceipt={read.unreadActions.commitUnreadReceipt}
      messageListState={{ status: "ready" }}
      positionSearchTurn={read.searchActions.positionSearchTurn}
      timelineModelReady
      timelinePositioned={timelinePositioned}
      remoteThread={props.remoteThread}
      initialRestoreAnchorTurnId={read.anchor.initialRestoreAnchorTurnId}
      fullscreenCovered={props.overlayState.fullscreenCovered}
      awayFromLatest={read.anchor.awayFromLatest}
      timelineContent={timelineContent}
      historyActivityModel={null}
      historyActivityResourceId={null}
      liveStatusVisible={liveStatusVisible}
      liveTurnPlan={read.presentation.liveTurnPlan}
      goalContent={null}
    />
  );
  return renderReadConversationLayout({
    props,
    read,
    headerContent,
    timelineSurface,
    timelinePositioned,
  });
}
