import { recordTiming } from "../../../data/operational-metrics";
import {
  markThreadNavigationStage,
  recordThreadNavigationVisualEvent,
} from "../../../data/thread-navigation-metrics";
import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListProps } from "../../../rendering/ThreadTimelineList";
import { useRef } from "react";
import type { TimelineItem } from "./timelineTypes";
import type { TimelineViewportProps } from "./TimelineViewportContract";

/** Synchronizes existing viewport lifetime callbacks without owning history state. */
export function useTimelineMeasurementBindings(
  props: TimelineViewportProps,
  onGeometryChanged: () => void,
  prepareInitialReveal: () => Promise<void>,
) {
  const { timelineContentHeightRef, timelineViewportHeightRef } = props;
  const readinessRef = useRef<
    | { readonly scope: string; readonly status: "committed" | "preparing" }
    | { readonly status: "idle" }
  >({ status: "idle" });
  const onLoad = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onLoad"]>>(
    ({ elapsedTimeInMs }) => {
      recordTiming("timeline_first_draw_ms", elapsedTimeInMs);
      if (props.draftConnectionId !== null && props.draftThreadId !== null) {
        recordThreadNavigationVisualEvent(
          props.draftConnectionId,
          props.draftThreadId,
          "timeline_first_draw",
          {
            tags: { status: props.historyViewport.readStatus() },
            values: {
              itemCount: props.displayedTimeline.length,
              nativeListDrawMs: elapsedTimeInMs,
            },
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
              itemCount: props.displayedTimeline.length,
              nativeListDrawMs: elapsedTimeInMs,
            },
          },
        );
      }
    },
  );
  const onReady = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onReady"]>>(() => {
    const readiness = readinessRef.current;
    if (readiness.status !== "idle" && readiness.scope === props.composerScope) {
      return;
    }
    readinessRef.current = { scope: props.composerScope, status: "preparing" };
    const scope = props.composerScope;
    const commitReadyTimeline = () => {
      const current = readinessRef.current;
      if (current.status !== "preparing" || current.scope !== scope) {
        return;
      }
      readinessRef.current = { scope, status: "committed" };
      props.commitInitialTimelineLoad();
    };
    void prepareInitialReveal().then(commitReadyTimeline, commitReadyTimeline);
  });
  const onLayout = useEvent<NonNullable<ThreadTimelineListProps<TimelineItem>["onLayout"]>>(
    ({ nativeEvent }) => {
      timelineViewportHeightRef.current = nativeEvent.layout.height;
      onGeometryChanged();
      props.reportHistoryViewport();
      props.scheduleUnreadAgentVisibilityCheck();
    },
  );
  const onContentSizeChange = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineItem>["onContentSizeChange"]>
  >((_width, height) => {
    timelineContentHeightRef.current = height;
    onGeometryChanged();
    props.reportHistoryViewport();
    if (props.draftConnectionId !== null && props.draftThreadId !== null) {
      recordThreadNavigationVisualEvent(
        props.draftConnectionId,
        props.draftThreadId,
        "timeline_content_size_changed",
        {
          tags: {
            positioned: props.timelinePositioned ? "true" : "false",
            status: props.historyViewport.readStatus(),
          },
          values: {
            heightPx: height,
            itemCount: props.displayedTimeline.length,
            viewportHeightPx: timelineViewportHeightRef.current,
          },
        },
      );
    }
    props.scheduleUnreadAgentVisibilityCheck();
  });
  return { onContentSizeChange, onLayout, onLoad, onReady };
}
