import { recordThreadHistoryTelemetry } from "../../../data/thread-history-telemetry";
import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListProps } from "../../../rendering/ThreadTimelineList";
import { timelineTailModeThreshold } from "./historyAnchor";
import type { TimelineItem } from "./timelineTypes";
import type { TimelineViewportProps } from "./TimelineViewportContract";

/** Synchronizes existing viewport lifetime callbacks without owning history state. */
export function useTimelineGestureBindings(props: TimelineViewportProps) {
  const {
    awayFromLatestRef,
    firstVisibleHistoryAnchorRef,
    lastTimelineOffsetYRef,
    paginationEdgeLockRef,
    scrollGestureStartedAtRef,
    scrollOffsetRef,
    timelineContentHeightRef,
    timelineViewportHeightRef,
  } = props;
  const onScrollBeginDrag = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onScrollBeginDrag"]>
  >(({ nativeEvent }) => {
    props.setTimelineGestureActive(true);
    if (props.fullscreenScrollOwnership.isCovered()) {
      return;
    }
    if (props.threadSearchActive) {
      return;
    }
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
          tags: { status: props.historyViewport.readStatus() },
          values: {
            contentHeightPx: nativeEvent.contentSize.height,
            distanceFromEndPx: Math.max(
              0,
              nativeEvent.contentSize.height -
                nativeEvent.layoutMeasurement.height -
                nativeEvent.contentOffset.y,
            ),
            itemCount: props.displayedTimeline.length,
            offsetY: nativeEvent.contentOffset.y,
            viewportHeightPx: nativeEvent.layoutMeasurement.height,
          },
        },
      );
    }
  });
  const onScroll = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onScroll"]>>(
    ({ nativeEvent }) => {
      if (props.fullscreenScrollOwnership.isCovered()) {
        return;
      }
      timelineViewportHeightRef.current = nativeEvent.layoutMeasurement.height;
      timelineContentHeightRef.current = nativeEvent.contentSize.height;
      props.scheduleUnreadAgentVisibilityCheck();
      if (props.threadSearchActive) {
        return;
      }
      lastTimelineOffsetYRef.current = nativeEvent.contentOffset.y;
      const distance = Math.max(
        0,
        nativeEvent.contentSize.height -
          nativeEvent.layoutMeasurement.height -
          nativeEvent.contentOffset.y,
      );
      scrollOffsetRef.current = distance;
      props.jumpVisibility.update(distance, props.historyViewport.containsLatest);
      const away =
        !props.historyViewport.containsLatest ||
        distance > timelineTailModeThreshold(nativeEvent.layoutMeasurement.height);
      const wasAway = awayFromLatestRef.current;
      if (awayFromLatestRef.current !== away) {
        awayFromLatestRef.current = away;
        props.setAwayFromLatest(away);
      }
      if (!away && wasAway) {
        props.persistTimelineAtEnd();
      }
    },
  );
  const onScrollEndDrag = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onScrollEndDrag"]>
  >(({ nativeEvent }) => {
    props.setTimelineGestureActive(false);
    if (props.fullscreenScrollOwnership.isCovered()) {
      return;
    }
    if (props.threadSearchActive) {
      return;
    }
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
          tags: { status: props.historyViewport.readStatus() },
          values: {
            contentHeightPx: nativeEvent.contentSize.height,
            distanceFromEndPx: Math.max(
              0,
              nativeEvent.contentSize.height -
                nativeEvent.layoutMeasurement.height -
                nativeEvent.contentOffset.y,
            ),
            durationMs:
              scrollGestureStartedAtRef.current === null
                ? 0
                : performance.now() - scrollGestureStartedAtRef.current,
            itemCount: props.displayedTimeline.length,
            offsetY: nativeEvent.contentOffset.y,
            viewportHeightPx: nativeEvent.layoutMeasurement.height,
          },
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
    if (props.fullscreenScrollOwnership.isCovered()) {
      return;
    }
    if (props.threadSearchActive) {
      return;
    }
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
          tags: { status: props.historyViewport.readStatus() },
          values: {
            contentHeightPx: nativeEvent.contentSize.height,
            distanceFromEndPx: Math.max(
              0,
              nativeEvent.contentSize.height -
                nativeEvent.layoutMeasurement.height -
                nativeEvent.contentOffset.y,
            ),
            durationMs:
              scrollGestureStartedAtRef.current === null
                ? 0
                : performance.now() - scrollGestureStartedAtRef.current,
            itemCount: props.displayedTimeline.length,
            offsetY: nativeEvent.contentOffset.y,
            viewportHeightPx: nativeEvent.layoutMeasurement.height,
          },
        },
      );
    }
    scrollGestureStartedAtRef.current = null;
  });
  return {
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
  };
}
