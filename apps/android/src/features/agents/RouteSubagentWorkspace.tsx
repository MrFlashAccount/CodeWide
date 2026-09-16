import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { Suspense, type ReactNode } from "react";

import { projectSubagentConversation, subagentsForThread } from "../../data/subagent-projection";
import { applyThreadSummaryMetadata } from "../../data/thread-chat-projection";
import {
  materializeThreadDetails,
  type ThreadDetailDatabase,
} from "../../data/thread-detail-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useThreadChatWindow } from "../../data/use-thread-chat-window";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import { SubagentPendingDetail } from "./SubagentPendingDetail";
import { SubagentWorkspace } from "./SubagentWorkspace";
import { RouteUnavailable } from "../../components/navigation/RouteUnavailable";
import type { SubagentThreadView } from "./subagentConversationContract";
import {
  resolveSubagentRouteSelection,
  type SubagentRouteSelection,
} from "./subagentRouteSelection";

/** Keeps the selected subagent in Router while retaining the existing responsive workspace. */
export function RouteSubagentWorkspace({
  connectionId,
  onBack,
  onClose,
  onSelect,
  parentThread,
  parentThreadId,
  renderThread,
  selection,
  summaries,
  threadDetails,
}: {
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onSelect: (threadId: string) => void;
  readonly parentThread: Thread | null;
  readonly parentThreadId: string;
  readonly renderThread: (view: SubagentThreadView) => ReactNode;
  readonly selection: SubagentRouteSelection;
  readonly summaries: readonly StoredThreadSummary[];
  readonly threadDetails: ThreadDetailDatabase;
}): React.JSX.Element {
  const subagents = subagentsForThread(summaries, parentThreadId);
  const resolvedSelection = resolveSubagentRouteSelection(subagents, selection);
  if (resolvedSelection.status === "unavailable") {
    return (
      <RouteUnavailable
        message="This subagent link is invalid or no longer available."
        onBack={onBack}
        title="Subagent unavailable"
      />
    );
  }
  const selected = resolvedSelection.status === "selected" ? resolvedSelection.summary : null;
  return (
    <SubagentWorkspace
      onBack={onBack}
      onClose={onClose}
      onSelect={(summary) => {
        onSelect(summary.remoteThreadId);
      }}
      renderDetail={(compact) =>
        selected === null ? null : (
          <RouteSubagentDetailBoundary
            compact={compact}
            connectionId={connectionId}
            onBack={onBack}
            onClose={onClose}
            onOpenSubagent={onSelect}
            parentThread={parentThread}
            renderThread={renderThread}
            summary={selected}
            threadDetails={threadDetails}
          />
        )
      }
      selected={selected}
      subagents={subagents}
    />
  );
}

function RouteSubagentDetailBoundary({
  compact,
  connectionId,
  onBack,
  onClose,
  onOpenSubagent,
  parentThread,
  renderThread,
  summary,
  threadDetails,
}: {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
  readonly parentThread: Thread | null;
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
      <Suspense
        // WHY: Suspense requires its pending UI through the fallback element prop.
        // oxlint-disable-next-line react-doctor/jsx-no-jsx-as-prop
        fallback={fallback}
      >
        <RouteSubagentDetail
          compact={compact}
          connectionId={connectionId}
          onBack={onBack}
          onOpenSubagent={onOpenSubagent}
          parentThread={parentThread}
          renderThread={renderThread}
          summary={summary}
          threadDetails={threadDetails}
        />
      </Suspense>
    </RecoverableRenderBoundary>
  );
}

function RouteSubagentDetail({
  compact,
  connectionId,
  onBack,
  onOpenSubagent,
  parentThread,
  renderThread,
  summary,
  threadDetails,
}: {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
  readonly parentThread: Thread | null;
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
  const rows =
    detailWindow === null
      ? []
      : [...detailWindow.turnRows, ...detailWindow.detailRows, ...detailWindow.liveRows];
  const materialized =
    materializeThreadDetails(rows, threadDetails.sessionId).find(
      (snapshot) => snapshot.connectionId === connectionId && snapshot.thread.id === threadId,
    )?.thread ?? null;
  const thread = applyThreadSummaryMetadata(materialized, summary);
  const conversation = thread === null ? null : projectSubagentConversation(thread, parentThread);
  if (conversation === null) {
    throw new Error(`Subagent conversation ${threadId} did not materialize from its ready window`);
  }
  return renderThread({
    compact,
    connectionId,
    summary,
    thread: conversation.thread,
    ...(compact ? { onBack } : {}),
    onOpenSubagent,
  });
}
