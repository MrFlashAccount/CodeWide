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
      key={props.composerScope}
      ref={timelineRef}
      testID="conversation-timeline"
      data={props.displayedTimeline}
      initialPosition={props.timelineInitialPosition}
      extraData={`${props.threadSearch}:${props.threadSearchMatch}:${props.windowLayout.measurementRevision}`}
      renderRevision={props.composerScope}
      measurementRevision={props.windowLayout.measurementRevision}
      style={styles.conversationScroll}
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
      keyboardLiftBehavior="always"
      scrollsChildToFocus={false}
      keyboardOffset={props.conversationInsets.bottom}
      followTail={
        !props.fullscreenCovered &&
        props.historyViewport.containsLatest &&
        !props.awayFromLatest &&
        !props.threadSearchActive
      }
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      scrollEnabled={!props.inlineQueueExpanded}
      getItemType={(item) => item.kind}
      scrollEventThrottle={16}
      onLoad={measurement.onLoad}
      onLayout={measurement.onLayout}
      onScrollBeginDrag={gestures.onScrollBeginDrag}
      onScroll={gestures.onScroll}
      onScrollEndDrag={gestures.onScrollEndDrag}
      onMomentumScrollBegin={gestures.onMomentumScrollBegin}
      onMomentumScrollEnd={gestures.onMomentumScrollEnd}
      onContentSizeChange={measurement.onContentSizeChange}
      showsVerticalScrollIndicator={false}
      onStartReached={props.loadOlderAtTimelineStart}
      onStartReachedThreshold={0.5}
      onEndReached={props.loadNewerAtTimelineEnd}
      onEndReachedThreshold={0.5}
      onFirstVisibleItemChanged={props.onTimelineFirstVisibleItemChanged}
      keyExtractor={timelineItemKey}
      ListHeaderComponent={
        props.historyViewport.containsBeginning &&
        !props.threadSearchActive &&
        props.displayedTimeline.length > 0 ? (
          <Text testID="history-beginning" style={styles.historyBeginning}>
            You’re at the beginning of this conversation
          </Text>
        ) : null
      }
      ListEmptyComponent={props.emptyContent}
      ListFooterComponent={props.footerContent}
      renderItem={props.renderTimelineItem}
    />
  );
}
