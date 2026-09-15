/** V1 historyAnchor owner, extracted without changing interaction or resource lifetime. */

export const LATEST_TIMELINE_THRESHOLD_PX = 2;

export const sessionConversationHistoryAnchors = new Map<
  string,
  { turnId: string; viewportOffsetPx: number | null }
>();

import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadUiStateRow } from "../../../data/thread-ui-state-types";
import { useConversationRef, useConversationState } from "../../../ui/use-conversation-scope";
import { SearchConversationWindow } from "../../search/search-conversation-window";

export function useHistoryAnchorState(
  composerScope: string,
  composerState: ThreadUiStateRow | null,
  searchWindow: SearchConversationWindow | null,
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

  const firstVisibleHistoryAnchorKeyRef = useConversationRef<string | null>(
    composerScope,
    () => null,
  );

  const firstVisibleHistoryAnchorStatusRef = useConversationRef<
    Thread["turns"][number]["status"] | null
  >(composerScope, () => null);

  const awayFromLatestRef = useConversationRef(composerScope, () => false);

  // A saved anchor is only a bootstrap input for this mounted conversation.
  // Reading the mutable session/SQLite value on every render lets later
  // pagination change initialScrollIndex while LegendList is preserving its
  // own visible item, so two independent owners can move the viewport.
  const [initialHistoryRestore] = useConversationState(composerScope, () => {
    const sessionAnchor = sessionConversationHistoryAnchors.get(composerScope);
    return {
      turnId: sessionAnchor?.turnId ?? composerState?.historyAnchorTurnId ?? null,
      viewportOffsetPx:
        sessionAnchor?.viewportOffsetPx ?? composerState?.historyAnchorOffsetPx ?? 0,
    };
  });

  const initialRestoreAnchorTurnId =
    searchWindow?.target.hit.turnId ?? initialHistoryRestore.turnId;

  const [awayFromLatest, setAwayFromLatest] = useConversationState(composerScope, () => false);

  const mountedConversationScopeRef = useConversationRef(composerScope, () => ({
    scope: composerScope,
    connectionId: draftConnectionId,
    threadId: draftThreadId,
    saveScrollOffset,
  }));

  const [pendingLatestJump, setPendingLatestJump] = useConversationState<{
    sourceSearchWindow: SearchConversationWindow | null;
  } | null>(composerScope, () => null);
  return {
    scrollSaveTimerRef,
    firstVisibleHistoryAnchorRef,
    firstVisibleHistoryAnchorKeyRef,
    firstVisibleHistoryAnchorStatusRef,
    awayFromLatestRef,
    initialHistoryRestore,
    initialRestoreAnchorTurnId,
    awayFromLatest,
    mountedConversationScopeRef,
    pendingLatestJump,
    setAwayFromLatest,
    setPendingLatestJump,
  };
}

import { isPersistableHistoryAnchor } from "../../../data/thread-history-anchor";
import {
  markThreadNavigationStage,
  recordThreadNavigationVisualEvent,
} from "../../../data/thread-navigation-metrics";
import type { ThreadHistoryViewport } from "../../../data/use-thread-history-controller";
import { useEvent } from "../../../react/useEvent";
import type { TimelineInitialPosition } from "../../../rendering/ThreadTimelineList";
import { createFullscreenScrollOwnership } from "../../../ui/fullscreen-scroll-ownership";
import type { ConversationOwner } from "../../../ui/use-conversation-owner";
import { useConversationCleanup } from "../../../ui/use-conversation-scope";
import { useTimelineSearchState } from "./timelineSearch";
import type { TimelineItem } from "./timelineTypes";
import { useTimelineViewportState } from "./timelineViewport";
import { useUnreadReceiptState } from "./unreadReceipt";
export function useHistoryAnchorActions({
  awayFromLatestRef,
  setAwayFromLatest,
  firstVisibleHistoryAnchorRef,
  firstVisibleHistoryAnchorStatusRef,
  firstVisibleHistoryAnchorKeyRef,
  scrollSaveTimerRef,
  pendingLatestJump,
  setPendingLatestJump,
  timelineContentHeightRef,
  timelineViewportHeightRef,
  setTimelineDidLoad,
  timelineRef,
  scrollOffsetRef,
  timelineInitialPosition,
  draftConnectionId,
  draftThreadId,
  timeline,
  currentTurnId,
  composerScope,
  saveScrollOffset,
  latestUnreadReceiptKey,
  acknowledgeUnreadReceipt,
  searchWindow,
  timelineModelReady,
  historyViewport,
  conversationOwner,
  fullscreenScrollOwnership,
}: Pick<
  ReturnType<typeof useHistoryAnchorState>,
  | "awayFromLatestRef"
  | "setAwayFromLatest"
  | "firstVisibleHistoryAnchorRef"
  | "firstVisibleHistoryAnchorStatusRef"
  | "firstVisibleHistoryAnchorKeyRef"
  | "scrollSaveTimerRef"
  | "pendingLatestJump"
  | "setPendingLatestJump"
> &
  Pick<
    ReturnType<typeof useTimelineViewportState>,
    | "timelineContentHeightRef"
    | "timelineViewportHeightRef"
    | "setTimelineDidLoad"
    | "timelineRef"
    | "scrollOffsetRef"
  > & {
    timelineInitialPosition: TimelineInitialPosition;
    draftConnectionId: string | null;
    draftThreadId: string | null;
    timeline: TimelineItem[];
    currentTurnId: string | null;
    composerScope: string;
    saveScrollOffset: Parameters<typeof useHistoryAnchorState>[5];
    latestUnreadReceiptKey: string | null;
    acknowledgeUnreadReceipt: (receiptKey: string) => void;
    searchWindow: SearchConversationWindow | null;
    timelineModelReady: boolean;
    historyViewport: ThreadHistoryViewport;
    conversationOwner: ConversationOwner;
    fullscreenScrollOwnership: ReturnType<typeof createFullscreenScrollOwnership>;
  }) {
  const commitInitialTimelineLoad = useEvent(() => {
    const restoredToAnchor = timelineInitialPosition.kind === "item";
    awayFromLatestRef.current = restoredToAnchor;
    setAwayFromLatest(restoredToAnchor);
    if (draftConnectionId !== null && draftThreadId !== null) {
      const values = {
        itemCount: timeline.length,
        contentHeightPx: timelineContentHeightRef.current,
        viewportHeightPx: timelineViewportHeightRef.current,
      };
      markThreadNavigationStage(draftConnectionId, draftThreadId, "timeline_positioned", {
        values,
        tags: { position: restoredToAnchor ? "anchor" : "end" },
      });
      recordThreadNavigationVisualEvent(
        draftConnectionId,
        draftThreadId,
        "timeline_position_applied",
        {
          values,
          tags: { position: restoredToAnchor ? "anchor" : "end" },
        },
      );
    }
    setTimelineDidLoad(true);
  });

  const currentHistoryAnchor = useEvent(
    (): { turnId: string | null; viewportOffsetPx: number | null } => {
      const turnId = firstVisibleHistoryAnchorRef.current;
      if (
        !isPersistableHistoryAnchor({
          atEnd: !awayFromLatestRef.current,
          anchorTurnId: turnId,
          anchorTurnStatus: firstVisibleHistoryAnchorStatusRef.current,
          activeTurnId: currentTurnId,
        })
      )
        return { turnId: null, viewportOffsetPx: null };
      const itemKey = turnId === null ? null : firstVisibleHistoryAnchorKeyRef.current;
      return {
        turnId,
        viewportOffsetPx:
          itemKey === null ? null : (timelineRef.current?.getItemViewportOffset(itemKey) ?? null),
      };
    },
  );

  const persistTimelineOffset = useEvent((offset: number) => {
    scrollOffsetRef.current = offset;
    const historyAnchor = currentHistoryAnchor();
    if (historyAnchor.turnId === null) sessionConversationHistoryAnchors.delete(composerScope);
    else
      sessionConversationHistoryAnchors.set(composerScope, {
        turnId: historyAnchor.turnId,
        viewportOffsetPx: historyAnchor.viewportOffsetPx,
      });
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (saveScrollOffset === undefined || draftConnectionId === null || draftThreadId === null)
      return;
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null;
      void saveScrollOffset(
        draftConnectionId,
        draftThreadId,
        offset,
        historyAnchor.turnId,
        historyAnchor.viewportOffsetPx,
      ).catch(() => undefined);
    }, 250);
  });

  const persistTimelineAtEnd = useEvent(() => {
    scrollOffsetRef.current = 0;
    sessionConversationHistoryAnchors.delete(composerScope);
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
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
    if (latestUnreadReceiptKey !== null) acknowledgeUnreadReceipt(latestUnreadReceiptKey);
  });

  const mayFinishLatestJump = useEvent(
    (source: SearchConversationWindow | null) => searchWindow === null || searchWindow === source,
  );

  const completeLatestJump = useEvent(() => {
    if (pendingLatestJump === null) return;
    if (!mayFinishLatestJump(pendingLatestJump.sourceSearchWindow)) {
      setPendingLatestJump(null);
      return;
    }
    if (searchWindow !== null || !timelineModelReady || !historyViewport.containsLatest) return;
    setPendingLatestJump(null);
    requestAnimationFrame(() => {
      if (
        !conversationOwner.isCurrent() ||
        fullscreenScrollOwnership.isCovered() ||
        !mayFinishLatestJump(pendingLatestJump.sourceSearchWindow)
      )
        return;
      void timelineRef.current?.scrollToEnd({ animated: false });
    });
  });

  const jumpTimelineToLatest = useEvent(() => {
    const sourceSearchWindow = searchWindow;
    void historyViewport
      .loadLatest()
      .then(() => {
        if (!conversationOwner.isCurrent() || !mayFinishLatestJump(sourceSearchWindow)) return;
        setPendingLatestJump({ sourceSearchWindow });
      })
      .catch(() => undefined);
  });
  return {
    commitInitialTimelineLoad,
    persistTimelineOffset,
    persistTimelineAtEnd,
    completeLatestJump,
    jumpTimelineToLatest,
  };
}

export function useTimelineCleanup({
  scrollSaveTimerRef,
  mountedConversationScopeRef,
  scrollOffsetRef,
  paginationTrimTimerRef,
  unreadVisibilityFrameRef,
  latestUnreadAgentRef,
  timelineIndexRetryTimerRef,
  fullscreenOverlay,
  composerScope,
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
    fullscreenOverlay: { dismissScope(scope: string): void };
    composerScope: string;
  }) {
  const clearTimelineRuntime = () => {
    if (scrollSaveTimerRef.current !== null) clearTimeout(scrollSaveTimerRef.current);
    if (timelineIndexRetryTimerRef.current !== null)
      clearTimeout(timelineIndexRetryTimerRef.current);
    if (unreadVisibilityFrameRef.current !== null)
      cancelAnimationFrame(unreadVisibilityFrameRef.current);
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
      const savedAnchor = sessionConversationHistoryAnchors.get(current.scope);
      const historyAnchor = {
        turnId: savedAnchor?.turnId ?? null,
        viewportOffsetPx: savedAnchor?.viewportOffsetPx ?? null,
      };
      void current
        .saveScrollOffset(
          current.connectionId,
          current.threadId,
          scrollOffsetRef.current,
          historyAnchor.turnId,
          historyAnchor.viewportOffsetPx,
        )
        .catch(() => undefined);
    }
    fullscreenOverlay.dismissScope(current.scope);
  };
  useConversationCleanup(composerScope, () => {
    if (paginationTrimTimerRef.current !== null) clearTimeout(paginationTrimTimerRef.current);
    cleanUpTimeline();
  });
}
