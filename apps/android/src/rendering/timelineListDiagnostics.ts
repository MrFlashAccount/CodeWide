import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import { useEffect, type RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type {
  TimelineListGeometry,
  TimelineScrollGesture,
  TimelineScrollSource,
  TimelineScrollTarget,
} from "../data/timelineScrollDiagnosticContract";
import type { TimelineScrollDiagnostics } from "../data/timelineScrollDiagnostics";
import { useEvent } from "../react/useEvent";

/** Projects only numeric geometry and flags from the external list implementation. */
function timelineListGeometry(ref: RefObject<LegendListRef | null>): TimelineListGeometry | null {
  const state = ref.current?.getState();
  if (state === undefined) {
    return null;
  }
  return {
    contentHeightPx: finiteMeasurement(state.contentLength),
    firstIndex: finiteMeasurement(state.start),
    isAtEnd: typeof state.isAtEnd === "boolean" ? state.isAtEnd : null,
    lastIndex: finiteMeasurement(state.end),
    offsetY: finiteMeasurement(state.scroll),
    viewportHeightPx: finiteMeasurement(state.scrollLength),
    withinEndThreshold:
      typeof state.isWithinMaintainScrollAtEndThreshold === "boolean"
        ? state.isWithinMaintainScrollAtEndThreshold
        : null,
  };
}

function finiteMeasurement(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Retains the issuing recorder across awaits, including when another chat replaces the list. */
export async function observeTimelineScrollCommand(
  {
    diagnostics,
    ref,
    source,
    target,
  }: {
    readonly diagnostics: TimelineScrollDiagnostics | undefined;
    readonly ref: RefObject<LegendListRef | null>;
    readonly source: TimelineScrollSource;
    readonly target: TimelineScrollTarget;
  },
  execute: () => Promise<void>,
): Promise<void> {
  if (diagnostics === undefined) {
    await execute();
    return;
  }
  const issuingList = ref.current;
  const command = diagnostics.beginCommand(source, target, timelineListGeometry(ref));
  try {
    await execute();
  } catch (error) {
    diagnostics.finishCommand(
      command,
      "rejected",
      ref.current === issuingList ? timelineListGeometry(ref) : null,
    );
    // The caller retains the original error. Diagnostics omit arbitrary library error strings,
    // which may contain content; the bounded event records the failed command and its geometry.
    throw error;
  }
  diagnostics.finishCommand(
    command,
    "resolved",
    ref.current === issuingList ? timelineListGeometry(ref) : null,
  );
}

type DiagnosticHandlers<ItemT> = Pick<
  LegendListProps<ItemT>,
  | "onScroll"
  | "onScrollBeginDrag"
  | "onScrollEndDrag"
  | "onMomentumScrollBegin"
  | "onMomentumScrollEnd"
  | "onContentSizeChange"
  | "onLayout"
>;

/** Observes the existing JS scroll events without adding listeners across the native bridge. */
export function useTimelineListDiagnostics<ItemT>(
  diagnostics: TimelineScrollDiagnostics | undefined,
  ref: RefObject<LegendListRef | null>,
  props: DiagnosticHandlers<ItemT>,
): DiagnosticHandlers<ItemT> {
  const onScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    props.onScroll?.(event);
    const native = event.nativeEvent;
    if (
      diagnostics?.scroll(
        native.contentOffset.y,
        native.contentSize.height,
        native.layoutMeasurement.height,
      ) === true
    ) {
      diagnostics.listGeometry(timelineListGeometry(ref));
    }
  });
  const recordGesture = useEvent(
    (phase: TimelineScrollGesture, event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const native = event.nativeEvent;
      diagnostics?.gesture(phase, {
        contentHeightPx: native.contentSize.height,
        offsetY: native.contentOffset.y,
        viewportHeightPx: native.layoutMeasurement.height,
      });
      diagnostics?.listGeometry(timelineListGeometry(ref));
    },
  );
  const onScrollBeginDrag = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    recordGesture("drag-start", event);
    props.onScrollBeginDrag?.(event);
  });
  const onScrollEndDrag = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    recordGesture("drag-end", event);
    props.onScrollEndDrag?.(event);
  });
  const onMomentumScrollBegin = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    recordGesture("momentum-start", event);
    props.onMomentumScrollBegin?.(event);
  });
  const onMomentumScrollEnd = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    recordGesture("momentum-end", event);
    props.onMomentumScrollEnd?.(event);
  });
  const onLayout = useEvent<NonNullable<LegendListProps<ItemT>["onLayout"]>>((event) => {
    props.onLayout?.(event);
    diagnostics?.record({
      kind: "layout",
      sizePx: event.nativeEvent.layout.height,
      source: "viewport",
    });
    diagnostics?.listGeometry(timelineListGeometry(ref));
  });
  const onContentSizeChange = useEvent((width: number, height: number) => {
    props.onContentSizeChange?.(width, height);
    diagnostics?.record({ kind: "layout", sizePx: height, source: "content" });
    diagnostics?.listGeometry(timelineListGeometry(ref));
  });
  useEffect(() => {
    diagnostics?.record({ kind: "lifecycle", phase: "mounted" });
    return () => diagnostics?.record({ kind: "lifecycle", phase: "unmounted" });
  }, [diagnostics]);
  return {
    onContentSizeChange,
    onLayout,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
  };
}
