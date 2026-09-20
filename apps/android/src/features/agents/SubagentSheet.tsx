import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { Suspense, useState, useTransition, type ReactNode } from "react";
import { type LayoutChangeEvent, useWindowDimensions } from "react-native";

import { projectSubagentConversation, subagentsForThread } from "../../data/subagent-projection";
import { applyThreadSummaryMetadata } from "../../data/thread-chat-projection";
import {
  materializeThreadDetails,
  type ThreadDetailDatabase,
} from "../../data/thread-detail-database";
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
  parentThread,
  parentThreadId,
  renderThread,
  summaries,
  threadDetails,
}: {
  readonly connectionId: string;
  readonly initialThreadId?: string | null;
  readonly onClose: () => void;
  readonly parentThread: Thread | null;
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
        parentThread={parentThread}
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
        <SubagentConversationDetail
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

function SubagentConversationDetail({
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
  const detailRows =
    detailWindow === null
      ? []
      : [...detailWindow.turnRows, ...detailWindow.detailRows, ...detailWindow.liveRows];
  const materializedThread =
    materializeThreadDetails(detailRows, threadDetails.sessionId).find(
      (snapshot) => snapshot.connectionId === connectionId && snapshot.thread.id === threadId,
    )?.thread ?? null;
  const thread = applyThreadSummaryMetadata(materializedThread, summary);
  const conversation = thread === null ? null : projectSubagentConversation(thread, parentThread);
  if (conversation === null) {
    throw new Error(`Subagent conversation ${threadId} did not materialize from its ready window`);
  }
  return renderThread({
    compact,
    connectionId,
    ...(compact ? { onBack } : {}),
    onOpenSubagent,
    summary,
    thread: conversation.thread,
  });
}
