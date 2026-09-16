import { ThreadTimelineList } from "../../../rendering/ThreadTimelineList";
import {
  conversationBottomContentInset,
  conversationTopContentInset,
} from "../../../ui/conversation-chrome-layout";
import { AppText as Text } from "../../../ui/Typography";
import { useTimelineGestureBindings } from "./timelineGestureBindings";
import { useTimelineMeasurementBindings } from "./timelineMeasurementBindings";
import { timelineItemKey } from "./timelineProjection";
import { styles } from "./TimelineViewport.styles";
import type { TimelineViewportProps } from "./TimelineViewportContract";

export function TimelineViewport(props: TimelineViewportProps) {
  const { timelineRef } = props;
  const gestures = useTimelineGestureBindings(props);
  const measurement = useTimelineMeasurementBindings(props);
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
      data={props.displayedTimeline}
      extraData={`${props.threadSearch}:${String(props.threadSearchMatch)}:${props.windowLayout.measurementRevision}`}
      followTail={
        !props.fullscreenCovered &&
        props.historyViewport.containsLatest &&
        !props.awayFromLatest &&
        !props.threadSearchActive
      }
      getItemType={(item) => item.kind}
      initialPosition={props.timelineInitialPosition}
      key={props.composerScope}
      keyboardDismissMode="interactive"
      keyboardLiftBehavior="always"
      keyboardOffset={props.conversationInsets.bottom}
      keyboardShouldPersistTaps="handled"
      keyExtractor={timelineItemKey}
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
      measurementRevision={props.windowLayout.measurementRevision}
      nestedScrollEnabled
      onContentSizeChange={measurement.onContentSizeChange}
      onEndReached={props.loadNewerAtTimelineEnd}
      onEndReachedThreshold={0.5}
      onFirstVisibleItemChanged={props.onTimelineFirstVisibleItemChanged}
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
