import { recordThreadHistoryTelemetry } from "../../../data/thread-history-telemetry";
import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListProps } from "../../../rendering/ThreadTimelineList";
import { LATEST_TIMELINE_THRESHOLD_PX } from "./historyAnchor";
import type { TimelineItem } from "./timelineTypes";
import type { TimelineViewportProps } from "./TimelineViewportContract";

/** Synchronizes existing viewport lifetime callbacks without owning history state. */
export function useTimelineGestureBindings(props: TimelineViewportProps) {
  const { awayFromLatestRef, firstVisibleHistoryAnchorRef, lastTimelineOffsetYRef, paginationEdgeLockRef, scrollGestureStartedAtRef, scrollOffsetRef, timelineContentHeightRef, timelineViewportHeightRef } = props;
  const onScrollBeginDrag = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onScrollBeginDrag"]>
  >(({ nativeEvent }) => {
    props.setTimelineGestureActive(true);
    if (props.fullscreenScrollOwnership.isCovered()) return;
    if (props.threadSearchActive) return;
    props.cancelScheduledPaginationTrim();
    paginationEdgeLockRef.current = null;
    scrollGestureStartedAtRef.current = performance.now();
    lastTimelineOffsetYRef.current = nativeEvent.contentOffset.y;
    if (props.draftConnectionId !== null && props.draftThreadId !== null) {
      recordThreadHistoryTelemetry(
        props.draftConnectionId,
        props.draftThreadId,
        "chat.scroll.gesture_started",
        {
          ...(firstVisibleHistoryAnchorRef.current === null
            ? {}
            : { turnId: firstVisibleHistoryAnchorRef.current }),
          values: {
            offsetY: nativeEvent.contentOffset.y,
            contentHeightPx: nativeEvent.contentSize.height,
            viewportHeightPx: nativeEvent.layoutMeasurement.height,
            distanceFromEndPx: Math.max(
              0,
              nativeEvent.contentSize.height -
                nativeEvent.layoutMeasurement.height -
                nativeEvent.contentOffset.y,
            ),
            itemCount: props.displayedTimeline.length,
          },
          tags: { status: props.historyViewport.readStatus() },
        },
      );
    }
  });
  const onScroll = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onScroll"]>>(
    ({ nativeEvent }) => {
      if (props.fullscreenScrollOwnership.isCovered()) return;
      timelineViewportHeightRef.current = nativeEvent.layoutMeasurement.height;
      timelineContentHeightRef.current = nativeEvent.contentSize.height;
      props.scheduleUnreadAgentVisibilityCheck();
      if (props.threadSearchActive) return;
      lastTimelineOffsetYRef.current = nativeEvent.contentOffset.y;
      const distance = Math.max(
        0,
        nativeEvent.contentSize.height -
          nativeEvent.layoutMeasurement.height -
          nativeEvent.contentOffset.y,
      );
      scrollOffsetRef.current = distance;
      const away = !props.historyViewport.containsLatest || distance > LATEST_TIMELINE_THRESHOLD_PX;
      const wasAway = awayFromLatestRef.current;
      if (awayFromLatestRef.current !== away) {
        awayFromLatestRef.current = away;
        props.setAwayFromLatest(away);
      }
      if (!away && wasAway) props.persistTimelineAtEnd();
    },
  );
  const onScrollEndDrag = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onScrollEndDrag"]>
  >(({ nativeEvent }) => {
    props.setTimelineGestureActive(false);
    if (props.fullscreenScrollOwnership.isCovered()) return;
    if (props.threadSearchActive) return;
    props.schedulePaginationWindowTrim();
    props.persistTimelineOffset(
      Math.max(
        0,
        nativeEvent.contentSize.height -
          nativeEvent.layoutMeasurement.height -
          nativeEvent.contentOffset.y,
      ),
    );
    if (props.draftConnectionId !== null && props.draftThreadId !== null) {
      recordThreadHistoryTelemetry(
        props.draftConnectionId,
        props.draftThreadId,
        "chat.scroll.drag_ended",
        {
          ...(firstVisibleHistoryAnchorRef.current === null
            ? {}
            : { turnId: firstVisibleHistoryAnchorRef.current }),
          values: {
            durationMs:
              scrollGestureStartedAtRef.current === null
                ? 0
                : performance.now() - scrollGestureStartedAtRef.current,
            offsetY: nativeEvent.contentOffset.y,
            contentHeightPx: nativeEvent.contentSize.height,
            viewportHeightPx: nativeEvent.layoutMeasurement.height,
            distanceFromEndPx: Math.max(
              0,
              nativeEvent.contentSize.height -
                nativeEvent.layoutMeasurement.height -
                nativeEvent.contentOffset.y,
            ),
            itemCount: props.displayedTimeline.length,
          },
          tags: { status: props.historyViewport.readStatus() },
        },
      );
    }
  });
  const onMomentumScrollBegin = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onMomentumScrollBegin"]>
  >(() => {
    props.setTimelineGestureActive(true);
    props.cancelScheduledPaginationTrim();
  });
  const onMomentumScrollEnd = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onMomentumScrollEnd"]>
  >(({ nativeEvent }) => {
    props.setTimelineGestureActive(false);
    if (props.fullscreenScrollOwnership.isCovered()) return;
    if (props.threadSearchActive) return;
    props.trimPaginationWindow();
    props.persistTimelineOffset(
      Math.max(
        0,
        nativeEvent.contentSize.height -
          nativeEvent.layoutMeasurement.height -
          nativeEvent.contentOffset.y,
      ),
    );
    if (props.draftConnectionId !== null && props.draftThreadId !== null) {
      recordThreadHistoryTelemetry(
        props.draftConnectionId,
        props.draftThreadId,
        "chat.scroll.momentum_ended",
        {
          ...(firstVisibleHistoryAnchorRef.current === null
            ? {}
            : { turnId: firstVisibleHistoryAnchorRef.current }),
          values: {
            durationMs:
              scrollGestureStartedAtRef.current === null
                ? 0
                : performance.now() - scrollGestureStartedAtRef.current,
            offsetY: nativeEvent.contentOffset.y,
            contentHeightPx: nativeEvent.contentSize.height,
            viewportHeightPx: nativeEvent.layoutMeasurement.height,
            distanceFromEndPx: Math.max(
              0,
              nativeEvent.contentSize.height -
                nativeEvent.layoutMeasurement.height -
                nativeEvent.contentOffset.y,
            ),
            itemCount: props.displayedTimeline.length,
          },
          tags: { status: props.historyViewport.readStatus() },
        },
      );
    }
    scrollGestureStartedAtRef.current = null;
  });
  return {
    onScrollBeginDrag,
    onScroll,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  };
}
