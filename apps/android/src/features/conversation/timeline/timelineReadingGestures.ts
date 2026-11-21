import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListProps } from "../../../rendering/ThreadTimelineList";
import type { TimelineViewportProps } from "./TimelineViewportContract";
import type { useThreadReadingPosition } from "./threadReadingPosition";
import { useTimelineGestureBindings } from "./timelineGestureBindings";
import type { TimelineRow } from "./timelineRows";

/** Samples the reading point when a manual gesture settles without measuring on scroll frames. */
export function useTimelineReadingGestures(
  props: TimelineViewportProps,
  input: {
    readonly clearResponseStartRequest: () => void;
    readonly reading: ReturnType<typeof useThreadReadingPosition>;
    readonly responseStartTopInset: number;
    readonly timelineRows: readonly TimelineRow[];
  },
): ReturnType<typeof useTimelineGestureBindings> {
  const { clearResponseStartRequest, reading } = input;
  const gestures = useTimelineGestureBindings(props);
  const captureReadingPosition = useEvent(() => {
    if (
      reading === null ||
      !reading.session.tracking ||
      props.threadSearchActive ||
      props.fullscreenScrollOwnership.isCovered()
    ) {
      return;
    }
    captureAtViewport(props, reading.session, input);
  });
  const onEndDrag = useEvent<NonNullable<ThreadTimelineListProps<TimelineRow>["onScrollEndDrag"]>>(
    (event) => {
      captureReadingPosition();
      gestures.onScrollEndDrag(event);
    },
  );
  const onEndMomentum = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineRow>["onMomentumScrollEnd"]>
  >((event) => {
    captureReadingPosition();
    gestures.onMomentumScrollEnd(event);
  });
  const onScrollBeginDrag = useEvent<
    NonNullable<ThreadTimelineListProps<TimelineRow>["onScrollBeginDrag"]>
  >((event) => {
    reading?.session.beginGesture();
    clearResponseStartRequest();
    gestures.onScrollBeginDrag(event);
  });
  return {
    ...gestures,
    onMomentumScrollEnd: onEndMomentum,
    onScrollBeginDrag,
    onScrollEndDrag: onEndDrag,
  };
}

function captureAtViewport(
  props: TimelineViewportProps,
  session: NonNullable<ReturnType<typeof useThreadReadingPosition>>["session"],
  input: { readonly responseStartTopInset: number; readonly timelineRows: readonly TimelineRow[] },
): void {
  const list = props.timelineRef.current;
  if (list === null) {
    return;
  }
  if (props.historyViewport.containsLatest && list.isWithinEndThreshold() === true) {
    session.atEnd();
    return;
  }
  const visible = list.readingRow?.(input.responseStartTopInset);
  if (visible !== null && visible !== undefined) {
    const row = input.timelineRows[visible.index];
    if (row !== undefined) {
      session.capture(row, visible.top);
    }
  }
}
