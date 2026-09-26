import { useLayoutEffect } from "react";
import type { TimelineScrollPolicy } from "../../../data/timelineScrollDiagnosticContract";
import { TimelineScrollDiagnostics } from "../../../data/timelineScrollDiagnostics";
import { useConversationRef } from "../../../ui/use-conversation-scope";
import type { useTimelineResponsePositioning } from "./timelineResponsePositioning";
import type { TimelineViewportProps } from "./TimelineViewportContract";

/** Binds content-free viewport policy to one activation-owned diagnostic recorder. */
export function useTimelineScrollDiagnostics(
  props: TimelineViewportProps,
): TimelineScrollDiagnostics {
  return useConversationRef(
    props.composerScope,
    () => new TimelineScrollDiagnostics(props.draftConnectionId, props.draftThreadId),
  ).current;
}

/** Records committed policy only; observation never schedules data loading or positioning. */
export function useTimelineScrollPolicy(
  diagnostics: TimelineScrollDiagnostics,
  props: TimelineViewportProps,
  state: {
    readonly anchor: { readonly index: number; readonly key: string } | null;
    readonly initialScrollAtEnd: boolean;
    readonly responseRequest: ReturnType<typeof useTimelineResponsePositioning>["request"];
    readonly rowCount: number;
  },
): void {
  useLayoutEffect(() => {
    const policy: TimelineScrollPolicy = {
      anchorIndex: state.anchor === null ? null : state.anchor.index,
      anchorReason: state.responseRequest === null ? "none" : state.responseRequest.reason,
      anchorTurnId: state.responseRequest === null ? null : state.responseRequest.turnId,
      awayFromLatest: props.awayFromLatest,
      containsBeginning: props.historyViewport.containsBeginning,
      containsLatest: props.historyViewport.containsLatest,
      fullscreenCovered: props.fullscreenCovered,
      initialScrollAtEnd: state.initialScrollAtEnd,
      jumpRequestId: props.timelineJumpRequest?.requestId ?? null,
      rowCount: state.rowCount,
      scrollEnabled: !props.inlineQueueExpanded,
      searchActive: props.threadSearchActive,
      timelinePositioned: props.timelinePositioned,
    };
    diagnostics.record({ kind: "policy", policy });
  }, [diagnostics, props, state]);
}
