import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { materializeThreadDetails, type ThreadDetailDatabase } from "../data/thread-detail-database";
import { projectSubagentConversation, subagentsForThread } from "../data/subagent-projection";
import type { ThreadSummaryDatabase } from "../data/thread-summary-database";
import type { StoredThreadSummary } from "../data/thread-summary-types";
import type { ThreadWindow } from "../data/use-remote-workspace";
import { SubagentWorkspace } from "./SubagentWorkspace";

export type SubagentThreadView = {
  summary: StoredThreadSummary;
  thread: Thread;
  compact: boolean;
  onBack?(): void;
  onOpenSubagent(threadId: string): void;
};

export function SubagentSheet({
  connectionId,
  parentThreadId,
  parentThread,
  summaries,
  summaryDatabase,
  threadDetails,
  onReadThread,
  initialThreadId = null,
  onRefresh,
  renderThread,
  onClose,
}: {
  connectionId: string;
  parentThreadId: string;
  parentThread: Thread | null;
  summaries: readonly StoredThreadSummary[];
  summaryDatabase: ThreadSummaryDatabase | null;
  threadDetails: ThreadDetailDatabase | null;
  onReadThread(connectionId: string, threadId: string): Promise<ThreadWindow | null>;
  initialThreadId?: string | null;
  onRefresh?(): Promise<void>;
  renderThread(view: SubagentThreadView): ReactNode;
  onClose(): void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadedThread, setLoadedThread] = useState<{ id: string; thread: Thread } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openedInitialThreadRef = useRef(false);
  const summaryQuery = useLiveQuery(
    (query) => summaryDatabase === null
      ? undefined
      : query
          .from({ row: summaryDatabase.collection })
          .where(({ row }) => eq(row.connectionId, connectionId)),
    [connectionId, summaryDatabase],
  );
  const liveSummaries = summaryDatabase === null ? summaries : summaryQuery.data ?? summaries;
  const subagents = subagentsForThread(liveSummaries, parentThreadId);
  const selected = subagents.find((summary) => summary.remoteThreadId === selectedId) ?? null;
  const detailQuery = useLiveQuery(
    (query) => threadDetails === null || selectedId === null
      ? undefined
      : query
          .from({ row: threadDetails.collection })
          .where(({ row }) => and(
            eq(row.connectionId, connectionId),
            eq(row.remoteThreadId, selectedId),
          )),
    [connectionId, selectedId, threadDetails],
  );
  const materializedThread = threadDetails === null || selectedId === null
    ? null
    : materializeThreadDetails(detailQuery.data ?? [], threadDetails.sessionId)
        .find((snapshot) => snapshot.connectionId === connectionId && snapshot.thread.id === selectedId)?.thread ?? null;
  const thread = materializedThread ?? (loadedThread?.id === selectedId ? loadedThread.thread : null);
  const conversation = thread === null ? null : projectSubagentConversation(thread, parentThread);

  useEffect(() => {
    if (onRefresh === undefined) return;
    void onRefresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not refresh subagents");
    });
  }, [onRefresh]);

  const resetSelection = () => {
    setSelectedId(null);
    setLoadingId(null);
    setLoadedThread(null);
    setError(null);
  };
  const close = () => {
    resetSelection();
    onClose();
  };
  const openById = useCallback((threadId: string) => {
    setSelectedId(threadId);
    setLoadingId(threadId);
    setLoadedThread(null);
    setError(null);
    void onReadThread(connectionId, threadId)
      .then((window) => {
        if (window !== null) setLoadedThread({ id: threadId, thread: window.thread });
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load subagent"))
      .finally(() => setLoadingId((current) => current === threadId ? null : current));
  }, [connectionId, onReadThread]);
  const open = (summary: StoredThreadSummary) => openById(summary.remoteThreadId);

  useEffect(() => {
    if (initialThreadId === null || openedInitialThreadRef.current) return;
    openedInitialThreadRef.current = true;
    openById(initialThreadId);
  }, [initialThreadId, openById]);

  return (
    <SubagentWorkspace
      subagents={subagents}
      selected={selected}
      loading={selected !== null && thread === null && loadingId === selected.remoteThreadId}
      error={error}
      onSelect={open}
      onBack={resetSelection}
      onClose={close}
      renderDetail={(compact) => selected === null || conversation === null ? null : renderThread({
        summary: selected,
        thread: conversation.thread,
        compact,
        ...(compact ? { onBack: resetSelection } : {}),
        onOpenSubagent: openById,
      })}
    />
  );
}
