/** V1 ThreadTimelineNavigationCommit owner, extracted without changing interaction or resource lifetime. */
import { useEffect, useRef, type ReactNode } from "react";
import {
  activeThreadNavigationIdFor,
  finalizeThreadNavigationProfile,
  markThreadNavigationStage,
} from "../../../data/thread-navigation-metrics";
import type { ThreadHistoryState } from "../../../data/thread-pagination";
import { endNavigationFrameTrace } from "../../../native/performance-metrics";
import { EveryCommitProbe } from "../../../ui/CommitProbe";

export function ThreadTimelineNavigationCommit({
  children,
  connectionId,
  itemCount,
  loadStatus,
  modelReady,
  restoreAnchorTurnId,
  threadId,
  turnCount,
  visible,
}: {
  children: ReactNode;
  connectionId: string | null;
  itemCount: number;
  loadStatus: ThreadHistoryState["status"];
  modelReady: boolean;
  restoreAnchorTurnId: string | null;
  threadId: string | null;
  turnCount: number;
  visible: boolean;
}) {
  const scopeReportedRef = useRef(false);
  const modelReportedRef = useRef(false);
  const visibleReportedRef = useRef(false);
  const navigationIdRef = useRef<string | null>(null);
  const nextFrameRef = useRef<number | null>(null);
  const nextFrameReportedRef = useRef(false);
  useEffect(
    () => () => {
      if (nextFrameRef.current !== null) {
        cancelAnimationFrame(nextFrameRef.current);
      }
      nextFrameRef.current = null;
    },
    [],
  );
  const onCommit = () => {
    if (connectionId === null || threadId === null) {
      return;
    }
    const activeNavigationId = activeThreadNavigationIdFor(connectionId, threadId);
    if (activeNavigationId === null) {
      return;
    }
    if (navigationIdRef.current !== activeNavigationId) {
      if (nextFrameRef.current !== null) {
        cancelAnimationFrame(nextFrameRef.current);
      }
      navigationIdRef.current = activeNavigationId;
      scopeReportedRef.current = false;
      modelReportedRef.current = false;
      visibleReportedRef.current = false;
      nextFrameReportedRef.current = false;
      nextFrameRef.current = null;
    }
    const navigationId = activeNavigationId;
    if (!scopeReportedRef.current) {
      scopeReportedRef.current = true;
      markThreadNavigationStage(
        connectionId,
        threadId,
        "scope_commit",
        {
          tags: { position: restoreAnchorTurnId === null ? "end" : "anchor" },
        },
        navigationId,
      );
    }
    if (modelReady && !modelReportedRef.current) {
      modelReportedRef.current = true;
      markThreadNavigationStage(
        connectionId,
        threadId,
        "timeline_model_ready",
        {
          tags: { loadStatus },
          values: { itemCount, turnCount },
        },
        navigationId,
      );
    }
    if (visible && !visibleReportedRef.current) {
      visibleReportedRef.current = true;
      markThreadNavigationStage(
        connectionId,
        threadId,
        "visible_commit",
        {
          tags: { timeline: itemCount === 0 ? "empty" : "populated" },
          values: { itemCount },
        },
        navigationId,
      );
    }
    if (!visible || nextFrameReportedRef.current || nextFrameRef.current !== null) {
      return;
    }
    nextFrameRef.current = requestAnimationFrame(() => {
      nextFrameRef.current = null;
      const completed = markThreadNavigationStage(
        connectionId,
        threadId,
        "next_frame",
        {
          values: { itemCount },
        },
        navigationId,
      );
      if (completed !== null) {
        nextFrameReportedRef.current = true;
        endNavigationFrameTrace(completed.id)
          .then((frames) => {
            finalizeThreadNavigationProfile(completed, frames);
          })
          .catch(() => undefined);
      }
    });
  };
  return (
    <>
      {children}
      <EveryCommitProbe onCommit={onCommit} />
    </>
  );
}
