import { Suspense, type ReactNode } from "react";

import { projectThreadChatWindow } from "../../data/thread-chat-projection";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
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
  // Main and subagent conversations must share one sealed/live merge contract.
  // A second materialization path makes mutable active-head behavior diverge.
  const thread =
    detailWindow === null
      ? null
      : projectThreadChatWindow(threadDetails, detailWindow, connectionId, threadId, false, summary)
          .remoteThread;
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
