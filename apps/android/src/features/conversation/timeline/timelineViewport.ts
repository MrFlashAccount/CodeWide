import { useRef, useState } from "react";
import type { View } from "react-native";
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
    bottomChromeHeight,
    lastTimelineOffsetYRef,
    paginationEdgeLockRef,
    paginationTrimTimerRef,
    scrollGestureStartedAtRef,
    scrollOffsetRef,
    setBottomChromeHeight,
    setTimelineDidLoad,
    setTimelineGestureActive,
    timelineContentHeightRef,
    timelineDidLoad,
    timelineGestureActive,
    timelineRef,
    timelineViewportHeightRef,
    timelineViewportRef,
  };
}

import { recordThreadHistoryTelemetry } from "../../../data/thread-history-telemetry";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import { useEvent } from "../../../react/useEvent";
import type { createFullscreenScrollOwnership } from "../../../ui/fullscreen-scroll-ownership";
import type { TimelineItem } from "./timelineTypes";
export function usePaginationTrim({
  fullscreenScrollOwnership,
  historyViewport,
  paginationEdgeLockRef,
  paginationTrimTimerRef,
}: Pick<
  ReturnType<typeof useTimelineViewportState>,
  "paginationTrimTimerRef" | "paginationEdgeLockRef"
> & {
  fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>;
  historyViewport: ThreadHistoryViewport;
}) {
  const cancelScheduledPaginationTrim = useEvent(() => {
    if (paginationTrimTimerRef.current === null) {
      return;
    }
    clearTimeout(paginationTrimTimerRef.current);
    paginationTrimTimerRef.current = null;
  });

  const trimPaginationWindow = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) {
      return;
    }
    cancelScheduledPaginationTrim();
    const direction = paginationEdgeLockRef.current;
    if (direction !== null) {
      historyViewport.trimAfterGesture(direction).catch(() => undefined);
    }
  });

  const schedulePaginationWindowTrim = useEvent(() => {
    cancelScheduledPaginationTrim();
    // Momentum begins immediately after drag end. Give that callback one frame
    // to cancel the trim; otherwise a slow drag settles without waiting for a
    // momentum event that will never arrive.
    paginationTrimTimerRef.current = setTimeout(trimPaginationWindow, 32);
  });
  return { cancelScheduledPaginationTrim, schedulePaginationWindowTrim, trimPaginationWindow };
}

export function useTimelineViewportActions({
  displayedTimeline,
  draftConnectionId,
  draftThreadId,
  firstVisibleHistoryAnchorRef,
  fullscreenScrollOwnership,
  historyViewport,
  lastTimelineOffsetYRef,
  paginationEdgeLockRef,
  scrollOffsetRef,
  threadSearchActive,
  timeline,
  timelineContentHeightRef,
  timelineViewportHeightRef,
}: Pick<
  ReturnType<typeof useTimelineViewportState>,
  | "scrollOffsetRef"
  | "lastTimelineOffsetYRef"
  | "paginationEdgeLockRef"
  | "timelineViewportHeightRef"
  | "timelineContentHeightRef"
> & {
  firstVisibleHistoryAnchorRef: import("react").RefObject<string | null>;
} & {
  displayedTimeline: TimelineItem[];
  draftConnectionId: string | null;
  draftThreadId: string | null;
  fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>;
  historyViewport: ThreadHistoryViewport;
  threadSearchActive: boolean;
  timeline: TimelineItem[];
}) {
  const reportHistoryViewport = useEvent(() => {
    if (threadSearchActive || fullscreenScrollOwnership.isCovered()) {
      return;
    }
    void historyViewport
      .reportViewport(timelineViewportHeightRef.current, timelineContentHeightRef.current)
      .catch(() => undefined);
  });
  const onTimelineFirstVisibleItemChanged = useEvent(
    ({ index, item }: { index: number; item: TimelineItem; key: string }) => {
      if (fullscreenScrollOwnership.isCovered()) {
        return;
      }
      let anchor = item.kind === "turn" ? item : null;
      for (let next = index + 1; anchor === null && next < timeline.length; next += 1) {
        const candidate = timeline[next];
        if (candidate?.kind === "turn") {
          anchor = candidate;
        }
      }
      firstVisibleHistoryAnchorRef.current = anchor?.id ?? null;
      reportHistoryViewport();
    },
  );

  const loadOlderAtTimelineStart = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) {
      return;
    }
    const oppositeEdge = paginationEdgeLockRef.current === "newer";
    if (!oppositeEdge) {
      paginationEdgeLockRef.current = "older";
    }
    if (draftConnectionId !== null && draftThreadId !== null) {
      recordThreadHistoryTelemetry(draftConnectionId, draftThreadId, "chat.scroll.edge_reached", {
        ...(firstVisibleHistoryAnchorRef.current === null
          ? {}
          : { turnId: firstVisibleHistoryAnchorRef.current }),
        tags: {
          direction: "older",
          outcome: threadSearchActive
            ? "ignored_search"
            : oppositeEdge
              ? "ignored_opposite_edge"
              : "requested",
          status: historyViewport.readStatus(),
        },
        values: {
          distanceFromEndPx: scrollOffsetRef.current,
          itemCount: displayedTimeline.length,
          offsetY: lastTimelineOffsetYRef.current ?? 0,
        },
      });
    }
    if (threadSearchActive || oppositeEdge) {
      return;
    }
    void historyViewport.loadOlder().catch(() => undefined);
  });

  const loadNewerAtTimelineEnd = useEvent(() => {
    if (fullscreenScrollOwnership.isCovered()) {
      return;
    }
    const oppositeEdge = paginationEdgeLockRef.current === "older";
    if (!oppositeEdge) {
      paginationEdgeLockRef.current = "newer";
    }
    if (draftConnectionId !== null && draftThreadId !== null) {
      recordThreadHistoryTelemetry(draftConnectionId, draftThreadId, "chat.scroll.edge_reached", {
        ...(firstVisibleHistoryAnchorRef.current === null
          ? {}
          : { turnId: firstVisibleHistoryAnchorRef.current }),
        tags: {
          direction: "newer",
          outcome: threadSearchActive
            ? "ignored_search"
            : oppositeEdge
              ? "ignored_opposite_edge"
              : "requested",
          status: historyViewport.readStatus(),
        },
        values: {
          distanceFromEndPx: scrollOffsetRef.current,
          itemCount: displayedTimeline.length,
          offsetY: lastTimelineOffsetYRef.current ?? 0,
        },
      });
    }
    if (threadSearchActive || oppositeEdge) {
      return;
    }
    void historyViewport.loadNewer().catch(() => undefined);
  });
  return {
    loadNewerAtTimelineEnd,
    loadOlderAtTimelineStart,
    onTimelineFirstVisibleItemChanged,
    reportHistoryViewport,
  };
}

export function useConversationPaneGeometry() {
  const [narrowConversationPane, setNarrowConversationPane] = useState(false);

  const [conversationPaneHeight, setConversationPaneHeight] = useState(0);
  return {
    conversationPaneHeight,
    narrowConversationPane,
    setConversationPaneHeight,
    setNarrowConversationPane,
  };
}
