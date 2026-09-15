import { recordTiming } from "../../../data/operational-metrics";
import {
  markThreadNavigationStage,
  recordThreadNavigationVisualEvent,
} from "../../../data/thread-navigation-metrics";
import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListProps } from "../../../rendering/ThreadTimelineList";
import type { TimelineItem } from "./timelineTypes";
import type { TimelineViewportProps } from "./TimelineViewportContract";

/** Synchronizes existing viewport lifetime callbacks without owning history state. */
export function useTimelineMeasurementBindings(props: TimelineViewportProps) {
  const { timelineContentHeightRef, timelineViewportHeightRef } = props;
  const onLoad = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onLoad"]>>(
    ({ elapsedTimeInMs }) => {
      recordTiming("timeline_first_draw_ms", elapsedTimeInMs);
      if (props.draftConnectionId !== null && props.draftThreadId !== null) {
        recordThreadNavigationVisualEvent(
          props.draftConnectionId,
          props.draftThreadId,
          "timeline_first_draw",
          {
            values: {
              nativeListDrawMs: elapsedTimeInMs,
              itemCount: props.displayedTimeline.length,
            },
            tags: { status: props.historyViewport.readStatus() },
          },
        );
      }
      if (props.draftConnectionId !== null && props.draftThreadId !== null) {
        markThreadNavigationStage(
          props.draftConnectionId,
          props.draftThreadId,
          "timeline_first_draw",
          {
            values: {
              nativeListDrawMs: elapsedTimeInMs,
              itemCount: props.displayedTimeline.length,
            },
          },
        );
      }
      props.commitInitialTimelineLoad();
    },
  );
  const onLayout = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onLayout"]>>(
    ({ nativeEvent }) => {
      timelineViewportHeightRef.current = nativeEvent.layout.height;
      props.reportHistoryViewport();
      props.scheduleUnreadAgentVisibilityCheck();
    },
  );
  const onContentSizeChange = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onContentSizeChange"]>
  >((_width, height) => {
    timelineContentHeightRef.current = height;
    props.reportHistoryViewport();
    if (props.draftConnectionId !== null && props.draftThreadId !== null) {
      recordThreadNavigationVisualEvent(
        props.draftConnectionId,
        props.draftThreadId,
        "timeline_content_size_changed",
        {
          values: {
            heightPx: height,
            viewportHeightPx: timelineViewportHeightRef.current,
            itemCount: props.displayedTimeline.length,
          },
          tags: {
            positioned: props.timelinePositioned ? "true" : "false",
            status: props.historyViewport.readStatus(),
          },
        },
      );
    }
    props.scheduleUnreadAgentVisibilityCheck();
  });
  return { onLoad, onLayout, onContentSizeChange };
}
