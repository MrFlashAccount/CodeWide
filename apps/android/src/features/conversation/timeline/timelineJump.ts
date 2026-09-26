import { useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { View } from "react-native";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import { TimelineScrollDiagnostics } from "../../../data/timelineScrollDiagnostics";
import type { TimelineScrollObservation } from "../../../data/timelineScrollDiagnosticContract";
import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListRef } from "../../../rendering/ThreadTimelineList";
import { visibleHeightWithinViewport } from "../../../rendering/unread-visibility";
import type { createFullscreenScrollOwnership } from "../../../ui/fullscreen-scroll-ownership";
import type { ConversationOwner } from "../../../ui/use-conversation-owner";
import { useConversationRef, useConversationState } from "../../../ui/use-conversation-scope";
import type { SearchConversationWindow } from "../../search/search-conversation-window";
import { TIMELINE_END_SETTLEMENT_EPSILON_PX } from "./historyAnchor";
import { timelineItemKey } from "./timelineProjection";
import type { TimelineItem } from "./timelineTypes";

const MAX_SCROLL_SETTLEMENT_ATTEMPTS = 3;

type PendingTimelineJump =
  | { readonly requestId: number; readonly status: "loading" }
  | { readonly requestId: number; readonly status: "ready" };

export type TimelineJumpRequest = {
  readonly requestId: number;
  readonly unreadItemKey: string | null;
};

type TimelineJumpStateBinding = {
  pendingTimelineJump: PendingTimelineJump | null;
  setPendingTimelineJump: Dispatch<SetStateAction<PendingTimelineJump | null>>;
  timelineJumpInFlightRef: { current: boolean };
  timelineJumpRequestIdRef: { current: number };
};

type TimelineJumpActionsBinding = {
  completeTimelineJump: (requestId: number) => void;
  jumpTimelineToLatest: () => void;
  timelineJumpRequest: TimelineJumpRequest | null;
};

type UnreadViewportPosition = "above" | "below" | "unavailable" | "visible";

type TimelineJumpExecution = {
  complete: () => void;
  getAgent: () => View | null;
  getDistanceFromEnd: () => number;
  getList: () => ThreadTimelineListRef | null;
  getViewport: () => View | null;
  isActive: () => boolean;
  reachedEnd: () => void;
  unreadItemKey: string | null;
};

/** Owns one admitted jump activation across range loading and list settlement. */
export function useTimelineJumpState(composerScope: string): TimelineJumpStateBinding {
  const [pendingTimelineJump, setPendingTimelineJump] =
    useConversationState<PendingTimelineJump | null>(composerScope, () => null);
  const timelineJumpInFlightRef = useConversationRef(composerScope, () => false);
  const timelineJumpRequestIdRef = useConversationRef(composerScope, () => 0);
  return {
    pendingTimelineJump,
    setPendingTimelineJump,
    timelineJumpInFlightRef,
    timelineJumpRequestIdRef,
  };
}

export function useTimelineJumpActions({
  conversationOwner,
  draftConnectionId,
  draftThreadId,
  fullscreenScrollOwnership,
  historyViewport,
  latestUnreadAgentTurnId,
  pendingTimelineJump,
  searchWindow,
  setPendingTimelineJump,
  timeline,
  timelineJumpInFlightRef,
  timelineJumpRequestIdRef,
  timelineModelReady,
}: TimelineJumpStateBinding & {
  conversationOwner: ConversationOwner;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>;
  historyViewport: ThreadHistoryViewport;
  latestUnreadAgentTurnId: string | null;
  searchWindow: SearchConversationWindow | null;
  timeline: readonly TimelineItem[];
  timelineModelReady: boolean;
}): TimelineJumpActionsBinding {
  const completeTimelineJump = useEvent((requestId: number) => {
    timelineJumpInFlightRef.current = false;
    setPendingTimelineJump((current) => (current?.requestId === requestId ? null : current));
  });

  const mayFinishTimelineJump = useEvent(
    (source: SearchConversationWindow | null) => searchWindow === null || searchWindow === source,
  );

  const jumpTimelineToLatest = useEvent(() => {
    // This request keeps its original diagnostic identity after an asynchronous range load,
    // even if useEvent now points the button at another conversation.
    const diagnostics = new TimelineScrollDiagnostics(draftConnectionId, draftThreadId);
    const covered = fullscreenScrollOwnership.isCovered();
    const inFlight = timelineJumpInFlightRef.current;
    const pending = pendingTimelineJump !== null;
    const recordJump = (
      phase: Extract<TimelineScrollObservation, { kind: "jump" }>["phase"],
      requestId: number,
    ) => {
      diagnostics.record({ covered, inFlight, kind: "jump", pending, phase, requestId });
    };
    if (
      pendingTimelineJump !== null ||
      timelineJumpInFlightRef.current ||
      fullscreenScrollOwnership.isCovered()
    ) {
      recordJump("blocked", timelineJumpRequestIdRef.current);
      return;
    }
    timelineJumpInFlightRef.current = true;
    timelineJumpRequestIdRef.current += 1;
    const requestId = timelineJumpRequestIdRef.current;
    recordJump("requested", requestId);
    const sourceSearchWindow = searchWindow;
    setPendingTimelineJump({ requestId, status: "loading" });
    void historyViewport
      .loadLatest()
      .then(() => {
        if (!conversationOwner.isCurrent() || !mayFinishTimelineJump(sourceSearchWindow)) {
          recordJump("cancelled", requestId);
          completeTimelineJump(requestId);
          return;
        }
        recordJump("range-ready", requestId);
        setPendingTimelineJump((current) =>
          current?.requestId === requestId && current.status === "loading"
            ? { requestId, status: "ready" }
            : current,
        );
      })
      .catch(() => {
        recordJump("failed", requestId);
        completeTimelineJump(requestId);
      });
  });

  const timelineJumpRequest = projectTimelineJumpRequest({
    containsLatest: historyViewport.containsLatest,
    latestUnreadAgentTurnId,
    pendingTimelineJump,
    searchWindow,
    timeline,
    timelineModelReady,
  });
  return { completeTimelineJump, jumpTimelineToLatest, timelineJumpRequest };
}

function projectTimelineJumpRequest({
  containsLatest,
  latestUnreadAgentTurnId,
  pendingTimelineJump,
  searchWindow,
  timeline,
  timelineModelReady,
}: {
  containsLatest: boolean;
  latestUnreadAgentTurnId: string | null;
  pendingTimelineJump: PendingTimelineJump | null;
  searchWindow: SearchConversationWindow | null;
  timeline: readonly TimelineItem[];
  timelineModelReady: boolean;
}): TimelineJumpRequest | null {
  if (
    pendingTimelineJump?.status !== "ready" ||
    searchWindow !== null ||
    !timelineModelReady ||
    !containsLatest
  ) {
    return null;
  }
  const unreadItem =
    latestUnreadAgentTurnId === null
      ? undefined
      : timeline.find((item) => item.kind === "turn" && item.id === latestUnreadAgentTurnId);
  return {
    requestId: pendingTimelineJump.requestId,
    unreadItemKey: unreadItem === undefined ? null : timelineItemKey(unreadItem),
  };
}

export function useTimelineJumpExecution({
  completeTimelineJump,
  diagnostics,
  fullscreenCovered,
  latestUnreadAgentRef,
  persistTimelineAtEnd,
  scrollOffsetRef,
  timelineJumpRequest,
  timelineRef,
  timelineViewportRef,
}: {
  completeTimelineJump: (requestId: number) => void;
  diagnostics: TimelineScrollDiagnostics;
  fullscreenCovered: boolean;
  latestUnreadAgentRef: RefObject<View | null>;
  persistTimelineAtEnd: () => void;
  scrollOffsetRef: RefObject<number>;
  timelineJumpRequest: TimelineJumpRequest | null;
  timelineRef: RefObject<ThreadTimelineListRef | null>;
  timelineViewportRef: RefObject<View | null>;
}): void {
  const requestId = timelineJumpRequest?.requestId ?? null;
  const unreadItemKey = timelineJumpRequest?.unreadItemKey ?? null;
  useLayoutEffect(() => {
    if (requestId === null || fullscreenCovered) {
      return undefined;
    }
    let active = true;
    executeTimelineJump({
      complete: () => {
        diagnostics.record({
          covered: fullscreenCovered,
          inFlight: true,
          kind: "jump",
          pending: true,
          phase: "completed",
          requestId,
        });
        completeTimelineJump(requestId);
      },
      getAgent: () => latestUnreadAgentRef.current,
      getDistanceFromEnd: () => scrollOffsetRef.current,
      getList: () => timelineRef.current,
      getViewport: () => timelineViewportRef.current,
      isActive: () => active,
      reachedEnd: persistTimelineAtEnd,
      unreadItemKey,
    }).catch(() => {
      if (active) {
        completeTimelineJump(requestId);
      }
    });
    return () => {
      active = false;
    };
  }, [
    completeTimelineJump,
    diagnostics,
    fullscreenCovered,
    latestUnreadAgentRef,
    persistTimelineAtEnd,
    requestId,
    scrollOffsetRef,
    timelineRef,
    timelineViewportRef,
    unreadItemKey,
  ]);
}

async function executeTimelineJump(execution: TimelineJumpExecution): Promise<void> {
  await settleTimelineLayout();
  if (!execution.isActive()) {
    return;
  }
  const list = execution.getList();
  if (list === null) {
    execution.complete();
    return;
  }
  const destination = await resolveTimelineJumpDestination(execution, list);
  if (destination === "unread") {
    await scrollToUnread(execution, list);
  } else {
    await scrollToAbsoluteEnd(execution, list);
  }
  if (execution.isActive()) {
    execution.complete();
  }
}

async function resolveTimelineJumpDestination(
  execution: TimelineJumpExecution,
  list: ThreadTimelineListRef,
): Promise<"end" | "unread"> {
  const unreadItemKey = execution.unreadItemKey;
  if (unreadItemKey === null) {
    return "end";
  }
  const position = await measureUnreadAgentPosition(execution.getViewport(), execution.getAgent());
  if (position === "below") {
    return "unread";
  }
  if (position !== "unavailable") {
    return "end";
  }
  const itemOffset = list.getItemViewportOffset(unreadItemKey);
  return itemOffset === null || itemOffset >= 0 ? "unread" : "end";
}

async function scrollToUnread(
  execution: TimelineJumpExecution,
  list: ThreadTimelineListRef,
): Promise<void> {
  const unreadItemKey = execution.unreadItemKey;
  if (unreadItemKey === null) {
    return;
  }
  for (let attempt = 0; attempt < MAX_SCROLL_SETTLEMENT_ATTEMPTS; attempt += 1) {
    if (!execution.isActive()) {
      return;
    }
    const unreadIndex = list.indexForItemKey(unreadItemKey);
    if (unreadIndex !== null) {
      await list
        .scrollToIndex({ animated: false, index: unreadIndex, viewPosition: 1 }, "jump-unread")
        .catch(() => undefined);
    }
    await settleTimelineLayout();
    const position = await measureUnreadAgentPosition(
      execution.getViewport(),
      execution.getAgent(),
    );
    if (position === "visible") {
      return;
    }
  }
}

async function scrollToAbsoluteEnd(
  execution: TimelineJumpExecution,
  list: ThreadTimelineListRef,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_SCROLL_SETTLEMENT_ATTEMPTS; attempt += 1) {
    if (!execution.isActive()) {
      return;
    }
    await list.scrollToEnd({ animated: false }, "jump-end").catch(() => undefined);
    await settleTimelineLayout();
    if (execution.getDistanceFromEnd() <= TIMELINE_END_SETTLEMENT_EPSILON_PX) {
      execution.reachedEnd();
      return;
    }
  }
}

async function measureUnreadAgentPosition(
  viewport: View | null,
  agent: View | null,
): Promise<UnreadViewportPosition> {
  if (viewport === null || agent === null) {
    return "unavailable";
  }
  return new Promise((resolve) => {
    viewport.measureInWindow((...viewportFrame) => {
      const [, viewportY, , viewportHeight] = viewportFrame;
      agent.measureInWindow((...agentFrame) => {
        const [, agentY, , agentHeight] = agentFrame;
        if (visibleHeightWithinViewport(agentY, agentHeight, viewportY, viewportHeight) > 0) {
          resolve("visible");
          return;
        }
        resolve(agentY + agentHeight <= viewportY ? "above" : "below");
      });
    });
  });
}

async function settleTimelineLayout(): Promise<void> {
  await nextAnimationFrame();
  await nextAnimationFrame();
}

async function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}
