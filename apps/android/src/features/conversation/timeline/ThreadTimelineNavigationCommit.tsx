/** V1 ThreadTimelineNavigationCommit owner, extracted without changing interaction or resource lifetime. */
import { useRef, type ReactNode } from "react";
import {
  activeThreadNavigationIdFor,
  finalizeThreadNavigationProfile,
  markThreadNavigationStage,
} from "../../../data/thread-navigation-metrics";
import { type ThreadHistoryState } from "../../../data/thread-pagination";
import { endNavigationFrameTrace } from "../../../native/performance-metrics";
import { EveryCommitProbe } from "../../../ui/CommitProbe";

export function ThreadTimelineNavigationCommit({
  connectionId,
  threadId,
  modelReady,
  visible,
  itemCount,
  turnCount,
  loadStatus,
  restoreAnchorTurnId,
  children,
}: {
  connectionId: string | null;
  threadId: string | null;
  modelReady: boolean;
  visible: boolean;
  itemCount: number;
  turnCount: number;
  loadStatus: ThreadHistoryState["status"];
  restoreAnchorTurnId: string | null;
  children: ReactNode;
}) {
  const scopeReportedRef = useRef(false);
  const modelReportedRef = useRef(false);
  const visibleReportedRef = useRef(false);
  const navigationIdRef = useRef<string | null>(null);
  const nextFrameRef = useRef<number | null>(null);
  const nextFrameReportedRef = useRef(false);
  const onCommit = () => {
    if (connectionId === null || threadId === null) return;
    const activeNavigationId = activeThreadNavigationIdFor(connectionId, threadId);
    if (activeNavigationId === null) return;
    if (navigationIdRef.current !== activeNavigationId) {
      if (nextFrameRef.current !== null) cancelAnimationFrame(nextFrameRef.current);
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
          values: { itemCount, turnCount },
          tags: { loadStatus },
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
          values: { itemCount },
          tags: { timeline: itemCount === 0 ? "empty" : "populated" },
        },
        navigationId,
      );
    }
    if (!visible || nextFrameReportedRef.current || nextFrameRef.current !== null) return;
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
        void endNavigationFrameTrace(completed.id).then((frames) =>
          finalizeThreadNavigationProfile(completed, frames),
        );
      }
    });
    return () => {
      if (nextFrameRef.current !== null) cancelAnimationFrame(nextFrameRef.current);
      nextFrameRef.current = null;
    };
  };
  return (
    <>
      {children}
      <EveryCommitProbe onCommit={onCommit} />
    </>
  );
}
