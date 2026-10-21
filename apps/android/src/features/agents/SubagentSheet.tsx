import { Suspense, useState, useTransition, type ReactNode } from "react";
import { type LayoutChangeEvent, useWindowDimensions } from "react-native";

import { subagentsForThread } from "../../data/subagent-projection";
import { projectThreadChatWindow } from "../../data/thread-chat-projection";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useThreadChatWindow } from "../../data/use-thread-chat-window";
import { useEvent } from "../../react/useEvent";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import { SubagentPendingDetail } from "./SubagentPendingDetail";
import {
  MASTER_DETAIL_BREAKPOINT,
  MASTER_MAX_WIDTH,
  MASTER_MIN_WIDTH,
  SubagentWorkspace,
} from "./SubagentWorkspace";
import type { SubagentThreadView } from "./subagentConversationContract";

const MASTER_WIDTH_RATIO = 0.32;

/** Preserves the original V1 master/detail selection and captured-catalog contract. */
export function SubagentSheet({
  connectionId,
  initialThreadId = null,
  onClose,
  parentThreadId,
  renderThread,
  summaries,
  threadDetails,
}: {
  readonly connectionId: string;
  readonly initialThreadId?: string | null;
  readonly onClose: () => void;
  readonly parentThreadId: string;
  readonly renderThread: (view: SubagentThreadView) => ReactNode;
  readonly summaries: readonly StoredThreadSummary[];
  readonly threadDetails: ThreadDetailDatabase;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [, startSubagentTransition] = useTransition();
  const window = useWindowDimensions();
  const width = measuredWidth > 0 ? measuredWidth : window.width;
  const compact = width < MASTER_DETAIL_BREAKPOINT;
  const masterWidth = compact
    ? width
    : Math.min(
        MASTER_MAX_WIDTH,
        Math.max(MASTER_MIN_WIDTH, Math.floor(width * MASTER_WIDTH_RATIO)),
      );
  const subagents = subagentsForThread(summaries, parentThreadId);
  const selected = subagents.find((summary) => summary.remoteThreadId === selectedId) ?? null;

  const resetSelection = (): void => {
    startSubagentTransition(() => {
      setSelectedId(null);
    });
  };
  const close = (): void => {
    resetSelection();
    onClose();
  };
  const openById = useEvent((threadId: string): void => {
    startSubagentTransition(() => {
      setSelectedId(threadId);
    });
  });
  const updateMeasuredWidth = useEvent((event: LayoutChangeEvent): void => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  });
  const detail =
    selected === null ? null : (
      <SubagentDetailBoundary
        compact={compact}
        connectionId={connectionId}
        onBack={resetSelection}
        onClose={close}
        onOpenSubagent={openById}
        renderThread={renderThread}
        summary={selected}
        threadDetails={threadDetails}
      />
    );

  return (
    <SubagentWorkspace
      compact={compact}
      masterWidth={masterWidth}
      onClose={close}
      onLayout={updateMeasuredWidth}
      onSelect={(summary) => {
        openById(summary.remoteThreadId);
      }}
      selected={selected}
      subagents={subagents}
    >
      {detail}
    </SubagentWorkspace>
  );
}

function SubagentDetailBoundary({
  compact,
  connectionId,
  onBack,
  onClose,
  onOpenSubagent,
  renderThread,
  summary,
  threadDetails,
}: {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
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
      <Suspense fallback={fallback}>
        <SubagentConversationDetail
          compact={compact}
          connectionId={connectionId}
          onBack={onBack}
          onOpenSubagent={onOpenSubagent}
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
  renderThread,
  summary,
  threadDetails,
}: {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
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
    summary,
    thread,
  });
}
