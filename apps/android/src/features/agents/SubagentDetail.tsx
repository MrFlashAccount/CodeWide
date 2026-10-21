import { Suspense, type ReactNode } from "react";

import { applyThreadSummaryMetadata } from "../../data/thread-chat-projection";
import {
  materializeThreadDetails,
  type ThreadDetailDatabase,
} from "../../data/thread-detail-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useThreadChatWindow } from "../../data/use-thread-chat-window";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import { SubagentPendingDetail } from "./SubagentPendingDetail";
import type { SubagentThreadView } from "./subagentConversationContract";

/** Owns loading and recovery for one selected read-only child conversation. */
export function SubagentDetail({
  compact,
  connectionId,
  onBack,
  onClose,
  onOpenSubagent,
  parentBreadcrumb,
  renderThread,
  summary,
  threadDetails,
}: {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
  readonly parentBreadcrumb: string | null;
  readonly renderThread: (view: SubagentThreadView) => ReactNode;
  readonly summary: StoredThreadSummary;
  readonly threadDetails: ThreadDetailDatabase;
}): React.JSX.Element {
  const fallback = (
    <SubagentPendingDetail
      compact={compact}
      error={null}
      loading
      onBack={onBack}
      onClose={onClose}
      parentBreadcrumb={parentBreadcrumb}
      summary={summary}
    />
  );
  return (
    <RecoverableRenderBoundary
      context={`Connection: ${connectionId}\nThread: ${summary.remoteThreadId}`}
      label="Subagent conversation"
      onDismiss={onBack}
      resetKey={`${connectionId}:${summary.remoteThreadId}`}
      scope="surface"
    >
      <Suspense fallback={fallback}>
        <SubagentConversationDetail
          compact={compact}
          connectionId={connectionId}
          onBack={onBack}
          onOpenSubagent={onOpenSubagent}
          parentBreadcrumb={parentBreadcrumb}
          renderThread={renderThread}
          summary={summary}
          threadDetails={threadDetails}
        />
      </Suspense>
    </RecoverableRenderBoundary>
  );
}

function SubagentConversationDetail({
  compact,
  connectionId,
  onBack,
  onOpenSubagent,
  parentBreadcrumb,
  renderThread,
  summary,
  threadDetails,
}: {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
  readonly parentBreadcrumb: string | null;
  readonly renderThread: (view: SubagentThreadView) => ReactNode;
  readonly summary: StoredThreadSummary;
  readonly threadDetails: ThreadDetailDatabase;
}): ReactNode {
  const threadId = summary.remoteThreadId;
  const detailWindow = useThreadChatWindow(threadDetails, {
    anchorTurnId: null,
    connectionId,
    threadId,
  });
  const detailRows =
    detailWindow === null
      ? []
      : [...detailWindow.turnRows, ...detailWindow.detailRows, ...detailWindow.liveRows];
  const materializedThread =
    materializeThreadDetails(detailRows, threadDetails.sessionId).find(
      (snapshot) => snapshot.connectionId === connectionId && snapshot.thread.id === threadId,
    )?.thread ?? null;
  // The provider adapter serves the subagent thread as its own content: it is
  // rendered as it arrives.
  const thread = applyThreadSummaryMetadata(materializedThread, summary);
  if (thread === null) {
    throw new Error(`Subagent conversation ${threadId} did not materialize from its ready window`);
  }
  return renderThread({
    compact,
    connectionId,
    ...(compact ? { onBack } : {}),
    onOpenSubagent,
    parentBreadcrumb,
    summary,
    thread,
  });
}
