import { ThreadTimelineList } from "../../../rendering/ThreadTimelineList";
import { useEvent } from "../../../react/useEvent";
import type { ReactElement } from "react";
import {
  conversationBottomContentInset,
  conversationTopContentInset,
} from "../../../ui/conversation-chrome-layout";
import { AppText as Text } from "../../../ui/Typography";
import { useTimelineGestureBindings } from "./timelineGestureBindings";
import { TIMELINE_TAIL_MODE_THRESHOLD_RATIO } from "./historyAnchor";
import { useTimelineJumpExecution } from "./timelineJump";
import { useTimelineMeasurementBindings } from "./timelineMeasurementBindings";
import { timelineItemKey } from "./timelineProjection";
import {
  projectTimelineRows,
  timelineRowItem,
  timelineRowKey,
  timelineRowSizeEstimate,
  type TimelineRow,
} from "./timelineRows";
import { styles } from "./TimelineViewport.styles";
import type { TimelineViewportProps } from "./TimelineViewportContract";

export function TimelineViewport(props: TimelineViewportProps): ReactElement {
  const {
    completeTimelineJump,
    fullscreenCovered,
    latestUnreadAgentRef,
    persistTimelineAtEnd,
    scrollOffsetRef,
    timelineJumpRequest,
    timelineRef,
    timelineViewportRef,
  } = props;
  const timelineRows = projectTimelineRows(props.displayedTimeline, {
    enabled: true,
    latestUnreadAgentTurnId: props.latestUnreadAgentTurnId,
    searchMessageItemId: props.searchMessageItemId,
    threadSearchActive: props.threadSearchActive,
  });
  const onFirstVisibleItemChanged = useEvent(
    ({ item: row }: { index: number; item: TimelineRow; key: string }) => {
      const item = timelineRowItem(row);
      props.onTimelineFirstVisibleItemChanged({
        index: row.timelineIndex,
        item,
        key: timelineItemKey(item),
      });
    },
  );
  const gestures = useTimelineGestureBindings(props);
  const measurement = useTimelineMeasurementBindings(props);
  useTimelineJumpExecution({
    completeTimelineJump,
    fullscreenCovered,
    latestUnreadAgentRef,
    persistTimelineAtEnd,
    scrollOffsetRef,
    timelineJumpRequest,
    timelineRef,
    timelineViewportRef,
  });
  return (
    <ThreadTimelineList
      automaticallyAdjustContentInsets={false}
      contentContainerStyle={[
        styles.conversationContent,
        props.timelineCompact ? styles.conversationContentCompact : styles.conversationContentWide,
        {
          paddingBottom: conversationBottomContentInset(
            props.bottomChromeHeight,
            props.liveStatusVisible,
          ),
          paddingTop: conversationTopContentInset(props.threadSearchVisible),
        },
      ]}
      contentInsetAdjustmentBehavior="never"
      data={timelineRows}
      extraData={`${props.threadSearch}:${String(props.threadSearchMatch)}:${props.windowLayout.measurementRevision}`}
      getItemType={(row) =>
        row.kind === "turnSlice"
          ? row.parts.length === 1 && row.parts[0]?.kind === "markdownBlock"
            ? `markdown:${row.parts[0].block.node.type}`
            : "turnSlice"
          : row.item.kind
      }
      initialScrollAtEnd={!props.timelinePositioned}
      itemSizeEstimate={timelineRowSizeEstimate(timelineRows)}
      key={props.composerScope}
      keyboardDismissMode="interactive"
      keyboardLiftBehavior="always"
      keyboardOffset={props.conversationInsets.bottom}
      keyboardShouldPersistTaps="handled"
      keyExtractor={timelineRowKey}
      ListEmptyComponent={props.emptyContent}
      ListFooterComponent={props.footerContent}
      ListHeaderComponent={
        props.historyViewport.containsBeginning &&
        !props.threadSearchActive &&
        props.displayedTimeline.length > 0 ? (
          <Text style={styles.historyBeginning} testID="history-beginning">
            You’re at the beginning of this conversation
          </Text>
        ) : null
      }
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={TIMELINE_TAIL_MODE_THRESHOLD_RATIO}
      maintainVisibleContentPosition
      nestedScrollEnabled
      onContentSizeChange={measurement.onContentSizeChange}
      onEndReached={props.loadNewerAtTimelineEnd}
      onEndReachedThreshold={0.5}
      onFirstVisibleItemChanged={onFirstVisibleItemChanged}
      onLayout={measurement.onLayout}
      onLoad={measurement.onLoad}
      onMomentumScrollBegin={gestures.onMomentumScrollBegin}
      onMomentumScrollEnd={gestures.onMomentumScrollEnd}
      onScroll={gestures.onScroll}
      onScrollBeginDrag={gestures.onScrollBeginDrag}
      onScrollEndDrag={gestures.onScrollEndDrag}
      onStartReached={props.loadOlderAtTimelineStart}
      onStartReachedThreshold={0.5}
      ref={timelineRef}
      renderItem={props.renderTimelineItem}
      renderRevision={props.composerScope}
      scrollEnabled={!props.inlineQueueExpanded}
      scrollEventThrottle={16}
      scrollsChildToFocus={false}
      showsVerticalScrollIndicator={false}
      style={styles.conversationScroll}
      testID="conversation-timeline"
    />
  );
}
