import { useLayoutEffect } from "react";
import { useEvent } from "../../../react/useEvent";
import { useConversationRef, useConversationState } from "../../../ui/use-conversation-scope";
import type { TimelineRow } from "./timelineRows";

type TimelineResponseStartRequest = {
  readonly reason: "completedResponse" | "initialUnread";
  readonly turnId: string;
};

type TimelineResponseLifecycle = {
  readonly phase: "settled" | "streaming";
  readonly turnId: string;
};

type TimelineResponsePositioning = {
  readonly clearResponseStartRequest: () => void;
  readonly request: TimelineResponseStartRequest | null;
};

/** Owns the one-shot semantic request to reveal the start of a completed agent response. */
export function useTimelineResponsePositioning({
  awayFromLatestRef,
  composerScope,
  enabled,
  latestUnreadAgentTurnId,
  rows,
  timelinePositioned,
}: {
  awayFromLatestRef: { current: boolean };
  composerScope: string;
  enabled: boolean;
  latestUnreadAgentTurnId: string | null;
  rows: readonly TimelineRow[];
  timelinePositioned: boolean;
}): TimelineResponsePositioning {
  const [request, setRequest] = useConversationState<TimelineResponseStartRequest | null>(
    composerScope,
    () =>
      enabled && latestUnreadAgentTurnId !== null
        ? { reason: "initialUnread", turnId: latestUnreadAgentTurnId }
        : null,
  );
  const previousLifecycleRef = useConversationRef<TimelineResponseLifecycle | null>(
    composerScope,
    () => latestResponseLifecycle(rows),
  );
  const previousUnreadTurnIdRef = useConversationRef<string | null>(
    composerScope,
    () => latestUnreadAgentTurnId,
  );
  const clearResponseStartRequest = useEvent(() => {
    setRequest(null);
  });

  useLayoutEffect(() => {
    const previousLifecycle = previousLifecycleRef.current;
    const currentLifecycle = latestResponseLifecycle(rows);
    const completedTurnId = responseCompletedWhileFollowing({
      awayFromLatest: awayFromLatestRef.current,
      current: currentLifecycle,
      previous: previousLifecycle,
    });
    const unreadTurnId = unreadResponseBecameAvailable({
      awayFromLatest: awayFromLatestRef.current,
      previousUnreadTurnId: previousUnreadTurnIdRef.current,
      timelinePositioned,
      unreadTurnId: latestUnreadAgentTurnId,
    });

    previousLifecycleRef.current = currentLifecycle;
    previousUnreadTurnIdRef.current = latestUnreadAgentTurnId;

    if (!enabled) {
      if (request !== null) {
        setRequest(null);
      }
      return;
    }
    if (currentLifecycle?.phase === "streaming") {
      if (request !== null) {
        setRequest(null);
      }
      return;
    }
    if (completedTurnId !== null) {
      setRequest({ reason: "completedResponse", turnId: completedTurnId });
      return;
    }
    if (unreadTurnId !== null) {
      setRequest({ reason: "initialUnread", turnId: unreadTurnId });
    }
  }, [
    awayFromLatestRef,
    enabled,
    latestUnreadAgentTurnId,
    previousLifecycleRef,
    previousUnreadTurnIdRef,
    request,
    rows,
    setRequest,
    timelinePositioned,
  ]);

  return { clearResponseStartRequest, request };
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
