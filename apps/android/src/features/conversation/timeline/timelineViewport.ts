import { useRef, useState } from "react";
import { View } from "react-native";
import type { ThreadTimelineListRef } from "../../../rendering/ThreadTimelineList";
import { useConversationRef, useConversationState } from "../../../ui/use-conversation-scope";

export function useTimelineViewportState(composerScope: string) {
  const scrollOffsetRef = useConversationRef(composerScope, () => 0);

  const timelineViewportHeightRef = useConversationRef(composerScope, () => 0);

  const timelineContentHeightRef = useConversationRef(composerScope, () => 0);

  const timelineViewportRef = useRef<View | null>(null);

  const lastTimelineOffsetYRef = useConversationRef<number | null>(composerScope, () => null);

  const scrollGestureStartedAtRef = useConversationRef<number | null>(composerScope, () => null);

  // A bounded range replacement can make LegendList briefly report the
  // opposite edge while MVCP restores the retained item. Keep the first edge
  // reached by a gesture authoritative until the next drag; the list still
  // decides when to load, but one gesture cannot page forward and immediately
  // page backward to the range it just evicted.
  const paginationEdgeLockRef = useConversationRef<"older" | "newer" | null>(
    composerScope,
    () => null,
  );

  const paginationTrimTimerRef = useConversationRef<ReturnType<typeof setTimeout> | null>(
    composerScope,
    () => null,
  );

  const timelineRef = useRef<ThreadTimelineListRef>(null);

  const [bottomChromeHeight, setBottomChromeHeight] = useState(0);

  const [timelineDidLoad, setTimelineDidLoad] = useConversationState(composerScope, () => false);

  const [timelineGestureActive, setTimelineGestureActive] = useConversationState(
    composerScope,
    () => false,
  );
  return {
    scrollOffsetRef,
    timelineViewportHeightRef,
    timelineContentHeightRef,
    timelineViewportRef,
    lastTimelineOffsetYRef,
    scrollGestureStartedAtRef,
    paginationEdgeLockRef,
    paginationTrimTimerRef,
    timelineRef,
    bottomChromeHeight,
    timelineDidLoad,
    timelineGestureActive,
    setBottomChromeHeight,
    setTimelineDidLoad,
    setTimelineGestureActive,
  };
}

import { recordThreadHistoryTelemetry } from "../../../data/thread-history-telemetry";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import { useEvent } from "../../../react/useEvent";
import { createFullscreenScrollOwnership } from "../../../ui/fullscreen-scroll-ownership";
import { timelineItemKey } from "./timelineProjection";
import type { TimelineItem } from "./timelineTypes";
export function usePaginationTrim({
  paginationTrimTimerRef,
  paginationEdgeLockRef,
  fullscreenScrollOwnership,
  historyViewport,
}: Pick<
  ReturnType<typeof useTimelineViewportState>,
  "paginationTrimTimerRef" | "paginationEdgeLockRef"
> & {
  fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>;
  historyViewport: ThreadHistoryViewport;
}) {
  const cancelScheduledPaginationTrim = useEvent(() => {
    if (paginationTrimTimerRef.current === null) return;
    clearTimeout(paginationTrimTimerRef.current);
    paginationTrimTimerRef.current = null;
  });

  const trimPaginationWindow = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) return;
    cancelScheduledPaginationTrim();
    const direction = paginationEdgeLockRef.current;
    paginationEdgeLockRef.current = null;
    if (direction !== null) void historyViewport.trimAfterGesture(direction);
  });

  const schedulePaginationWindowTrim = useEvent(() => {
    cancelScheduledPaginationTrim();
    // Momentum begins immediately after drag end. Give that callback one frame
    // to cancel the trim; otherwise a slow drag settles without waiting for a
    // momentum event that will never arrive.
    paginationTrimTimerRef.current = setTimeout(trimPaginationWindow, 32);
  });
  return { cancelScheduledPaginationTrim, trimPaginationWindow, schedulePaginationWindowTrim };
}

export function useTimelineViewportActions({
  scrollOffsetRef,
  lastTimelineOffsetYRef,
  paginationEdgeLockRef,
  timelineViewportHeightRef,
  timelineContentHeightRef,
  firstVisibleHistoryAnchorRef,
  firstVisibleHistoryAnchorKeyRef,
  firstVisibleHistoryAnchorStatusRef,
  fullscreenScrollOwnership,
  historyViewport,
  draftConnectionId,
  draftThreadId,
  timeline,
  displayedTimeline,
  threadSearchActive,
}: Pick<
  ReturnType<typeof useTimelineViewportState>,
  | "scrollOffsetRef"
  | "lastTimelineOffsetYRef"
  | "paginationEdgeLockRef"
  | "timelineViewportHeightRef"
  | "timelineContentHeightRef"
> & {
  firstVisibleHistoryAnchorRef: import("react").RefObject<string | null>;
  firstVisibleHistoryAnchorKeyRef: import("react").RefObject<string | null>;
  firstVisibleHistoryAnchorStatusRef: import("react").RefObject<
    import("@codewide/codex-protocol/v0.147.0/v2").Turn["status"] | null
  >;
} & {
  fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>;
  historyViewport: ThreadHistoryViewport;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  timeline: TimelineItem[];
  displayedTimeline: TimelineItem[];
  threadSearchActive: boolean;
}) {
  const reportHistoryViewport = useEvent(() => {
    if (threadSearchActive || fullscreenScrollOwnership.isCovered()) return;
    void historyViewport
      .reportViewport(timelineViewportHeightRef.current, timelineContentHeightRef.current)
      .catch(() => undefined);
  });
  const onTimelineFirstVisibleItemChanged = useEvent(
    ({ index, item }: { index: number; item: TimelineItem; key: string }) => {
      if (fullscreenScrollOwnership.isCovered()) return;
      let anchor = item.kind === "turn" ? item : null;
      for (let next = index + 1; anchor === null && next < timeline.length; next += 1) {
        const candidate = timeline[next];
        if (candidate?.kind === "turn") anchor = candidate;
      }
      firstVisibleHistoryAnchorRef.current = anchor?.id ?? null;
      firstVisibleHistoryAnchorKeyRef.current = anchor === null ? null : timelineItemKey(anchor);
      firstVisibleHistoryAnchorStatusRef.current = anchor?.turn.status ?? null;
      reportHistoryViewport();
    },
  );

  const loadOlderAtTimelineStart = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) return;
    const oppositeEdge = paginationEdgeLockRef.current === "newer";
    if (!oppositeEdge) paginationEdgeLockRef.current = "older";
    if (draftConnectionId !== null && draftThreadId !== null) {
      recordThreadHistoryTelemetry(draftConnectionId, draftThreadId, "chat.scroll.edge_reached", {
        ...(firstVisibleHistoryAnchorRef.current === null
          ? {}
          : { turnId: firstVisibleHistoryAnchorRef.current }),
        values: {
          itemCount: displayedTimeline.length,
          offsetY: lastTimelineOffsetYRef.current ?? 0,
          distanceFromEndPx: scrollOffsetRef.current,
        },
        tags: {
          direction: "older",
          outcome: threadSearchActive
            ? "ignored_search"
            : oppositeEdge
              ? "ignored_opposite_edge"
              : "requested",
          status: historyViewport.readStatus(),
        },
      });
    }
    if (threadSearchActive || oppositeEdge) return;
    void historyViewport.loadOlder().catch(() => undefined);
  });

  const loadNewerAtTimelineEnd = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) return;
    const oppositeEdge = paginationEdgeLockRef.current === "older";
    if (!oppositeEdge) paginationEdgeLockRef.current = "newer";
    if (draftConnectionId !== null && draftThreadId !== null) {
      recordThreadHistoryTelemetry(draftConnectionId, draftThreadId, "chat.scroll.edge_reached", {
        ...(firstVisibleHistoryAnchorRef.current === null
          ? {}
          : { turnId: firstVisibleHistoryAnchorRef.current }),
        values: {
          itemCount: displayedTimeline.length,
          offsetY: lastTimelineOffsetYRef.current ?? 0,
          distanceFromEndPx: scrollOffsetRef.current,
        },
        tags: {
          direction: "newer",
          outcome: threadSearchActive
            ? "ignored_search"
            : oppositeEdge
              ? "ignored_opposite_edge"
              : "requested",
          status: historyViewport.readStatus(),
        },
      });
    }
    if (threadSearchActive || oppositeEdge) return;
    void historyViewport.loadNewer().catch(() => undefined);
  });
  return {
    onTimelineFirstVisibleItemChanged,
    loadOlderAtTimelineStart,
    loadNewerAtTimelineEnd,
    reportHistoryViewport,
  };
}

export function useConversationPaneGeometry() {
  const [narrowConversationPane, setNarrowConversationPane] = useState(false);

  const [conversationPaneHeight, setConversationPaneHeight] = useState(0);
  return {
    narrowConversationPane,
    setNarrowConversationPane,
    conversationPaneHeight,
    setConversationPaneHeight,
  };
}
