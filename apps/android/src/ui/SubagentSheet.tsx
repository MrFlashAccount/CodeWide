import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { Suspense, useState, useTransition, type ReactNode } from "react";

import { materializeThreadDetails, type ThreadDetailDatabase } from "../data/thread-detail-database";
import { applyThreadSummaryMetadata } from "../data/thread-chat-projection";
import { projectSubagentConversation, subagentsForThread } from "../data/subagent-projection";
import type { StoredThreadSummary } from "../data/thread-summary-types";
import { useThreadChatWindow } from "../data/use-thread-chat-window";
import { useEvent } from "../react/useEvent";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";
import { SubagentPendingDetail, SubagentWorkspace } from "./SubagentWorkspace";

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
  threadDetails,
  initialThreadId = null,
  renderThread,
  onClose,
}: {
  connectionId: string;
  parentThreadId: string;
  parentThread: Thread | null;
  summaries: readonly StoredThreadSummary[];
  threadDetails: ThreadDetailDatabase;
  initialThreadId?: string | null;
  renderThread(view: SubagentThreadView): ReactNode;
  onClose(): void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [, startSubagentTransition] = useTransition();
  const subagents = subagentsForThread(summaries, parentThreadId);
  const selected = subagents.find((summary) => summary.remoteThreadId === selectedId) ?? null;

  const resetSelection = () => {
    startSubagentTransition(() => setSelectedId(null));
  };
  const close = () => {
    resetSelection();
    onClose();
  };
  const openById = useEvent((threadId: string) => {
    startSubagentTransition(() => setSelectedId(threadId));
  });
  const open = (summary: StoredThreadSummary) => openById(summary.remoteThreadId);

  return (
    <SubagentWorkspace
      subagents={subagents}
      selected={selected}
      onSelect={open}
      onBack={resetSelection}
      onClose={close}
      renderDetail={(compact) => selected === null ? null : (
        <RecoverableRenderBoundary
          scope="surface"
          label="Subagent conversation"
          context={`Connection: ${connectionId}\nThread: ${selected.remoteThreadId}`}
          resetKey={`${connectionId}:${selected.remoteThreadId}`}
          onDismiss={resetSelection}
        >
          <Suspense fallback={(
            <SubagentPendingDetail
              summary={selected}
              compact={compact}
              loading
              error={null}
              onBack={resetSelection}
              onClose={close}
            />
          )}>
            <SubagentConversationDetail
              connectionId={connectionId}
              parentThread={parentThread}
              summary={selected}
              compact={compact}
              threadDetails={threadDetails}
              onBack={resetSelection}
              onOpenSubagent={openById}
              renderThread={renderThread}
            />
          </Suspense>
        </RecoverableRenderBoundary>
      )}
    />
  );
}

function SubagentConversationDetail({
  connectionId,
  parentThread,
  summary,
  compact,
  threadDetails,
  onBack,
  onOpenSubagent,
  renderThread,
}: {
  connectionId: string;
  parentThread: Thread | null;
  summary: StoredThreadSummary;
  compact: boolean;
  threadDetails: ThreadDetailDatabase;
  onBack(): void;
  onOpenSubagent(threadId: string): void;
  renderThread(view: SubagentThreadView): ReactNode;
}) {
  const threadId = summary.remoteThreadId;
  const detailWindow = useThreadChatWindow(threadDetails, {
    connectionId,
    threadId,
    anchorTurnId: null,
  });
  const detailRows = detailWindow === null
    ? []
    : [...detailWindow.turnRows, ...detailWindow.detailRows, ...detailWindow.liveRows];
  const materializedThread = materializeThreadDetails(detailRows, threadDetails.sessionId)
    .find((snapshot) => snapshot.connectionId === connectionId && snapshot.thread.id === threadId)?.thread ?? null;
  const thread = applyThreadSummaryMetadata(materializedThread, summary);
  const conversation = thread === null ? null : projectSubagentConversation(thread, parentThread);
  if (conversation === null) {
    throw new Error(`Subagent conversation ${threadId} did not materialize from its ready window`);
  }
  return renderThread({
    summary,
    thread: conversation.thread,
    compact,
    ...(compact ? { onBack } : {}),
    onOpenSubagent,
  });
}
