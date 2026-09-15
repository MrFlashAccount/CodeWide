import { View } from "react-native";
import { recordThreadNavigationVisualEvent } from "../../../data/thread-navigation-metrics";
import { TimelineMotionContext } from "../../../rendering/FluidLayoutFrame";
import { spacing } from "../../../theme";
import { CommitOnChangeProbe, EveryCommitProbe } from "../../../ui/CommitProbe";
import { MessageListBoundary } from "../../../ui/MessageListBoundary";
import { LiveTurnPlanPopover } from "../../goal/LiveTurnPlanPopover";
import { ThreadHistoryLoadingIndicator } from "../ConversationHistoryStatus";
import { styles } from "./ConversationTimelineSurface.styles";
import type { ConversationTimelineSurfaceProps } from "./ConversationTimelineSurfaceContract";
import { ThreadTimelineNavigationCommit } from "./ThreadTimelineNavigationCommit";

/** Composes timeline viewport, search, pending state, and scroll controls. */
export function ConversationTimelineSurface({
  timelineViewportRef,
  draftConnectionId,
  draftThreadId,
  composerScope,
  timeline,
  readOnly,
  historyViewport,
  latestUnreadReceiptKey,
  commitUnreadReceipt,
  messageListState,
  positionSearchTurn,
  completeLatestJump,
  timelineModelReady,
  timelinePositioned,
  remoteThread,
  initialRestoreAnchorTurnId,
  timelineDidLoad,
  timelineGestureActive,
  fullscreenCovered,
  awayFromLatest,
  threadSearchActive,
  timelineContent,
  historyActivityModel,
  historyActivityResourceId,
  liveStatusVisible,
  bottomChromeHeight,
  liveTurnPlan,
  goalContent,
}: ConversationTimelineSurfaceProps) {
  return (
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
            {timelineContent}
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
          {liveTurnPlan === null ? null : <LiveTurnPlanPopover plan={liveTurnPlan} />}
          {goalContent}
        </View>
      )}
    </View>
  );
}
