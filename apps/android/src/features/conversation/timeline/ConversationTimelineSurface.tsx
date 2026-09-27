import { View } from "react-native";
import { recordThreadNavigationVisualEvent } from "../../../data/thread-navigation-metrics";
import { TimelineMotionContext } from "../../../rendering/FluidLayoutFrame";
import { spacing } from "../../../theme";
import { CommitOnChangeProbe, EveryCommitProbe } from "../../../ui/CommitProbe";
import {
  conversationBottomContentInset,
  conversationTopContentInset,
} from "../../../ui/conversation-chrome-layout";
import {
  MessageListBoundary,
  type MessageListPresentationState,
  type MessageListState,
} from "../../../ui/MessageListBoundary";
import { LiveTurnPlanMenu } from "../../goal/LiveTurnPlanMenu";
import { ThreadHistoryLoadingIndicator } from "../ConversationHistoryStatus";
import { styles } from "./ConversationTimelineSurface.styles";
import type { ConversationTimelineSurfaceProps } from "./ConversationTimelineSurfaceContract";
import { ThreadTimelineNavigationCommit } from "./ThreadTimelineNavigationCommit";

/** Composes timeline viewport, search, pending state, and scroll controls. */
export function ConversationTimelineSurface({
  awayFromLatest,
  bottomChromeHeight,
  commitUnreadReceipt,
  composerScope,
  draftConnectionId,
  draftThreadId,
  fullscreenCovered,
  goalContent,
  historyActivityModel,
  historyActivityResourceId,
  historyViewport,
  latestUnreadReceiptKey,
  liveStatusVisible,
  liveTurnPlan,
  messageListState,
  positionSearchTurn,
  readOnly,
  remoteThread,
  threadSearchActive,
  threadSearchVisible,
  timeline,
  timelineContent,
  timelineDidLoad,
  timelineGestureActive,
  timelineModelReady,
  timelinePositioned,
  timelineViewportRef,
}: ConversationTimelineSurfaceProps) {
  const presentationState = messageListPresentationState(
    messageListState,
    timelineModelReady,
    timelinePositioned,
  );
  return (
    <View ref={timelineViewportRef} style={styles.timelineShell}>
      {draftConnectionId !== null && draftThreadId !== null && (
        <CommitOnChangeProbe
          onCommit={() => {
            const navigationId = recordThreadNavigationVisualEvent(
              draftConnectionId,
              draftThreadId,
              "timeline_surface_visible",
              {
                tags: {
                  readOnly: readOnly ? "true" : "false",
                  status: historyViewport.readStatus(),
                },
                values: { itemCount: timeline.length },
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
          revision={composerScope}
          scope={`timeline-surface:${composerScope}`}
        />
      )}
      <CommitOnChangeProbe
        onCommit={commitUnreadReceipt}
        revision={latestUnreadReceiptKey}
        scope={composerScope}
      />
      <MessageListBoundary
        contentInsets={{
          bottom: conversationBottomContentInset(bottomChromeHeight, liveStatusVisible),
          top: conversationTopContentInset(threadSearchVisible),
        }}
        loadingKey={composerScope}
        state={presentationState}
      >
        <EveryCommitProbe onCommit={positionSearchTurn} />
        <ThreadTimelineNavigationCommit
          connectionId={draftConnectionId}
          itemCount={timeline.length}
          loadStatus={historyViewport.readStatus()}
          modelReady={timelineModelReady}
          threadId={draftThreadId}
          turnCount={remoteThread?.turns.length ?? 0}
          visible={timelinePositioned}
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
          hasTimeline={timeline.length > 0}
          model={historyActivityModel}
          resourceId={historyActivityResourceId}
        />
      )}
      {liveStatusVisible && (
        <View
          pointerEvents="box-none"
          style={[
            styles.livePlanFloat,
            {
              bottom: bottomChromeHeight + spacing.sm,
            },
          ]}
          testID="live-plan-float"
        >
          {liveTurnPlan === null ? null : <LiveTurnPlanMenu plan={liveTurnPlan} />}
          {goalContent}
        </View>
      )}
    </View>
  );
}

function messageListPresentationState(
  model: MessageListState,
  modelReadyForPlacement: boolean,
  positioned: boolean,
): MessageListPresentationState {
  if (model.status === "error") {
    return model;
  }
  if (positioned) {
    return { status: "ready" };
  }
  if (!modelReadyForPlacement) {
    return { status: "loading" };
  }
  return { status: "positioning" };
}
