/** V1 historyAnchor owner, extracted without changing interaction or resource lifetime. */

export const TIMELINE_END_SETTLEMENT_EPSILON_PX = 2;
export const TIMELINE_TAIL_MODE_THRESHOLD_RATIO = 0.02;

export function timelineTailModeThreshold(viewportHeightPx: number): number {
  return Math.max(0, viewportHeightPx) * TIMELINE_TAIL_MODE_THRESHOLD_RATIO;
}

import { useConversationRef, useConversationState } from "../../../ui/use-conversation-scope";

export function useHistoryAnchorState(
  composerScope: string,
  draftConnectionId: string | null,
  draftThreadId: string | null,
  saveScrollOffset:
    | ((
        connectionId: string,
        threadId: string,
        offset: number,
        anchorTurnId: string | null,
        anchorViewportOffsetPx: number | null,
      ) => Promise<void>)
    | undefined,
) {
  const scrollSaveTimerRef = useConversationRef<ReturnType<typeof setTimeout> | null>(
    composerScope,
    () => null,
  );

  const firstVisibleHistoryAnchorRef = useConversationRef<string | null>(composerScope, () => null);

  const awayFromLatestRef = useConversationRef(composerScope, () => false);

  const [awayFromLatest, setAwayFromLatest] = useConversationState(composerScope, () => false);

  const mountedConversationScopeRef = useConversationRef(composerScope, () => ({
    connectionId: draftConnectionId,
    saveScrollOffset,
    scope: composerScope,
    threadId: draftThreadId,
  }));

  return {
    awayFromLatest,
    awayFromLatestRef,
    firstVisibleHistoryAnchorRef,
    mountedConversationScopeRef,
    scrollSaveTimerRef,
    setAwayFromLatest,
  };
}

import {
  markThreadNavigationStage,
  recordThreadNavigationVisualEvent,
} from "../../../data/thread-navigation-metrics";
import { useEvent } from "../../../react/useEvent";
import { useConversationCleanup } from "../../../ui/use-conversation-scope";
import type { useTimelineSearchState } from "./timelineSearch";
import type { TimelineItem } from "./timelineTypes";
import type { useTimelineViewportState } from "./timelineViewport";
import type { useUnreadReceiptState } from "./unreadReceipt";
export function useHistoryAnchorActions({
  acknowledgeUnreadReceipt,
  awayFromLatestRef,
  draftConnectionId,
  draftThreadId,
  latestUnreadReceiptKey,
  saveScrollOffset,
  scrollOffsetRef,
  scrollSaveTimerRef,
  setAwayFromLatest,
  setTimelineDidLoad,
  timeline,
  timelineContentHeightRef,
  timelineViewportHeightRef,
}: Pick<
  ReturnType<typeof useHistoryAnchorState>,
  "awayFromLatestRef" | "setAwayFromLatest" | "scrollSaveTimerRef"
> &
  Pick<
    ReturnType<typeof useTimelineViewportState>,
    | "timelineContentHeightRef"
    | "timelineViewportHeightRef"
    | "setTimelineDidLoad"
    | "scrollOffsetRef"
  > & {
    acknowledgeUnreadReceipt: (receiptKey: string) => void;
    draftConnectionId: string | null;
    draftThreadId: string | null;
    latestUnreadReceiptKey: string | null;
    saveScrollOffset: Parameters<typeof useHistoryAnchorState>[3];
    timeline: TimelineItem[];
  }) {
  const commitInitialTimelineLoad = useEvent(() => {
    if (draftConnectionId !== null && draftThreadId !== null) {
      const values = {
        contentHeightPx: timelineContentHeightRef.current,
        itemCount: timeline.length,
        viewportHeightPx: timelineViewportHeightRef.current,
      };
      markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_positioned", {
        tags: { position: "end" },
        values,
      });
      recordThreadNavigationVisualEvent(
        draftConnectionId,
        draftThreadId,
        "timeline_position_applied",
        {
          tags: { position: "end" },
          values,
        },
      );
    }
    setTimelineDidLoad(true);
  });

  const persistTimelineOffset = useEvent((offset: number) => {
    scrollOffsetRef.current = offset;
    if (scrollSaveTimerRef.current !== null) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    if (saveScrollOffset === undefined || draftConnectionId === null || draftThreadId === null) {
      return;
    }
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null;
      void saveScrollOffset(draftConnectionId, draftThreadId, offset, null, null).catch(
        () => undefined,
      );
    }, 250);
  });

  const persistTimelineAtEnd = useEvent(() => {
    scrollOffsetRef.current = 0;
    if (scrollSaveTimerRef.current !== null) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    if (saveScrollOffset !== undefined && draftConnectionId !== null && draftThreadId !== null) {
      scrollSaveTimerRef.current = setTimeout(() => {
        scrollSaveTimerRef.current = null;
        void saveScrollOffset(draftConnectionId, draftThreadId, 0, null, null).catch(
          () => undefined,
        );
      }, 250);
    }
    awayFromLatestRef.current = false;
    setAwayFromLatest(false);
    if (latestUnreadReceiptKey !== null) {
      acknowledgeUnreadReceipt(latestUnreadReceiptKey);
    }
  });

  return {
    commitInitialTimelineLoad,
    persistTimelineAtEnd,
    persistTimelineOffset,
  };
}

export function useTimelineCleanup({
  composerScope,
  fullscreenOverlay,
  latestUnreadAgentRef,
  mountedConversationScopeRef,
  paginationTrimTimerRef,
  scrollOffsetRef,
  scrollSaveTimerRef,
  timelineIndexRetryTimerRef,
  unreadVisibilityFrameRef,
}: Pick<
  ReturnType<typeof useHistoryAnchorState>,
  "scrollSaveTimerRef" | "mountedConversationScopeRef"
> &
  Pick<ReturnType<typeof useTimelineViewportState>, "scrollOffsetRef" | "paginationTrimTimerRef"> &
  Pick<
    ReturnType<typeof useUnreadReceiptState>,
    "unreadVisibilityFrameRef" | "latestUnreadAgentRef"
  > &
  Pick<ReturnType<typeof useTimelineSearchState>, "timelineIndexRetryTimerRef"> & {
    composerScope: string;
    fullscreenOverlay: { dismissScope: (scope: string) => void };
  }) {
  const clearTimelineRuntime = () => {
    if (scrollSaveTimerRef.current !== null) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    if (timelineIndexRetryTimerRef.current !== null) {
      clearTimeout(timelineIndexRetryTimerRef.current);
    }
    if (unreadVisibilityFrameRef.current !== null) {
      cancelAnimationFrame(unreadVisibilityFrameRef.current);
    }
    scrollSaveTimerRef.current = null;
    timelineIndexRetryTimerRef.current = null;
    unreadVisibilityFrameRef.current = null;
    latestUnreadAgentRef.current = null;
  };

  const cleanUpTimeline = () => {
    clearTimelineRuntime();
    const current = mountedConversationScopeRef.current;
    if (
      current.saveScrollOffset !== undefined &&
      current.connectionId !== null &&
      current.threadId !== null
    ) {
      void current
        .saveScrollOffset(
          current.connectionId,
          current.threadId,
          scrollOffsetRef.current,
          null,
          null,
        )
        .catch(() => undefined);
    }
    fullscreenOverlay.dismissScope(current.scope);
  };
  useConversationCleanup(composerScope, () => {
    if (paginationTrimTimerRef.current !== null) {
      clearTimeout(paginationTrimTimerRef.current);
    }
    cleanUpTimeline();
  });
}
