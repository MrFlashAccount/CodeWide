import { useEvent } from "../../../react/useEvent";
import { useConversationState } from "../../../ui/use-conversation-scope";
import type { TimelineRow } from "./timelineRows";
import { TimelineResponseStart } from "./timelineResponseStart";

type TimelineResponseLifecycle = {
  readonly phase: "settled" | "streaming";
  readonly turnId: string;
};

type TimelineResponsePositioning = {
  readonly clearResponseStartRequest: () => void;
  readonly request: TimelineResponseStart | null;
};

type ResponseObservation = {
  readonly enabled: boolean;
  readonly lifecycle: TimelineResponseLifecycle | null;
  readonly request: TimelineResponseStart | null;
  readonly unreadTurnId: string | null;
};

/** Owns the one-shot semantic request to reveal the start of a completed agent response. */
export function useTimelineResponsePositioning({
  awayFromLatest,
  composerScope,
  enabled,
  latestUnreadAgentTurnId,
  rows,
  timelinePositioned,
}: {
  awayFromLatest: boolean;
  composerScope: string;
  enabled: boolean;
  latestUnreadAgentTurnId: string | null;
  rows: readonly TimelineRow[];
  timelinePositioned: boolean;
}): TimelineResponsePositioning {
  const lifecycle = latestResponseLifecycle(rows);
  const [observed, setObserved] = useConversationState<ResponseObservation>(composerScope, () => ({
    enabled,
    lifecycle,
    request: initialUnreadRequest(enabled, lifecycle, latestUnreadAgentTurnId),
    unreadTurnId: latestUnreadAgentTurnId,
  }));
  const clearResponseStartRequest = useEvent(() => {
    observed.request?.cancel();
    setObserved((previous) => ({ ...previous, request: null }));
  });
  let request = observed.request;
  if (
    observed.enabled !== enabled ||
    !sameResponseLifecycle(observed.lifecycle, lifecycle) ||
    observed.unreadTurnId !== latestUnreadAgentTurnId
  ) {
    const completedTurnId = responseCompletedWhileFollowing({
      awayFromLatest,
      current: lifecycle,
      previous: observed.lifecycle,
    });
    const unreadTurnId = unreadResponseBecameAvailable({
      awayFromLatest,
      previousUnreadTurnId: observed.unreadTurnId,
      timelinePositioned,
      unreadTurnId: latestUnreadAgentTurnId,
    });
    if (!enabled || isStreamingResponse(lifecycle)) {
      request = null;
    } else if (completedTurnId !== null) {
      request = new TimelineResponseStart("completedResponse", completedTurnId);
    } else if (unreadTurnId !== null) {
      request = new TimelineResponseStart("initialUnread", unreadTurnId);
    }
    // Adjust only this component's state before its children commit. No scroll or mutable
    // external owner is updated during render; readiness performs the one imperative action.
    setObserved({ enabled, lifecycle, request, unreadTurnId: latestUnreadAgentTurnId });
  }

  return { clearResponseStartRequest, request };
}

function initialUnreadRequest(
  enabled: boolean,
  lifecycle: TimelineResponseLifecycle | null,
  unreadTurnId: string | null,
): TimelineResponseStart | null {
  return enabled && !isStreamingResponse(lifecycle) && unreadTurnId !== null
    ? new TimelineResponseStart("initialUnread", unreadTurnId)
    : null;
}

function isStreamingResponse(lifecycle: TimelineResponseLifecycle | null): boolean {
  return lifecycle?.phase === "streaming";
}

function sameResponseLifecycle(
  previous: TimelineResponseLifecycle | null,
  current: TimelineResponseLifecycle | null,
): boolean {
  return previous?.phase === current?.phase && previous?.turnId === current?.turnId;
}

function responseCompletedWhileFollowing({
  awayFromLatest,
  current,
  previous,
}: {
  awayFromLatest: boolean;
  current: TimelineResponseLifecycle | null;
  previous: TimelineResponseLifecycle | null;
}): string | null {
  return !awayFromLatest &&
    previous?.phase === "streaming" &&
    current?.phase === "settled" &&
    previous.turnId === current.turnId
    ? current.turnId
    : null;
}

function unreadResponseBecameAvailable({
  awayFromLatest,
  previousUnreadTurnId,
  timelinePositioned,
  unreadTurnId,
}: {
  awayFromLatest: boolean;
  previousUnreadTurnId: string | null;
  timelinePositioned: boolean;
  unreadTurnId: string | null;
}): string | null {
  return unreadTurnId !== null &&
    previousUnreadTurnId !== unreadTurnId &&
    (!timelinePositioned || !awayFromLatest)
    ? unreadTurnId
    : null;
}

function latestResponseLifecycle(rows: readonly TimelineRow[]): TimelineResponseLifecycle | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "turnSlice" && (row.placement === "start" || row.placement === "single")) {
      return {
        phase: row.item.turn.status === "inProgress" ? "streaming" : "settled",
        turnId: row.item.id,
      };
    }
  }
  return null;
}
