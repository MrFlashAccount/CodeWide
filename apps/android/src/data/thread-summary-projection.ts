import {
  closesAsyncQuestions,
  isFinalQuestionTurnMessage,
  currentAsyncQuestions,
  hasAsyncQuestions,
} from "./questionLifecycle";
import { unknownRecord } from "./unknownRecord";
import { isThread } from "./thread-cursor-sync";
import { threadSummaryDescendants } from "./thread-summary-descendants";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  threadProjectionPatchFromEvent,
  type ThreadProjectionPatchV1,
} from "@codewide/sync-client";

import {
  normalizeThreadStatus,
  type QuestionOpportunity,
  type StoredThreadSummary,
} from "./thread-summary-types";
import { subagentOwnTurns } from "./subagent-projection";
import { latestThreadMessagePreview, plainThreadPreview } from "./thread-cache";

export type ThreadSummaryMutation = {
  key: string;
  value: StoredThreadSummary | null;
};

export function threadSummaryKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

export function retainThreadSummaryMissingFromSnapshot(summary: StoredThreadSummary): boolean {
  // The global interactive-thread snapshot does not contain descendants.
  // Those rows come from the Companion parent index and must survive later
  // reconnect snapshots; explicit thread/deleted events still remove them.
  return isThread(summary.provisionalThread) || typeof summary.parentThreadId === "string";
}

export function threadSummaryDescendantKeys(
  rows: readonly StoredThreadSummary[],
  rootThreadId: string,
): Set<string> {
  const keys = new Set<string>();
  for (const row of threadSummaryDescendants(rows, rootThreadId)) {
    keys.add(threadSummaryKey(row.connectionId, row.remoteThreadId));
  }
  return keys;
}

export function projectThreadSummarySnapshot(
  connectionId: string,
  thread: Thread,
  archived: boolean,
  previous?: StoredThreadSummary,
): StoredThreadSummary {
  const isSubagent = typeof thread.parentThreadId === "string";
  const previewThread = isSubagent ? { ...thread, turns: subagentOwnTurns(thread) } : thread;
  const snapshotPreview =
    previewThread.turns.length > 0 ? latestThreadMessagePreview(previewThread) : "";
  const listedPreview = plainThreadPreview(thread.preview);
  return {
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    connectionId,
    name: thread.name,
    parentThreadId: thread.parentThreadId ?? null,
    remoteThreadId: thread.id,
    // The companion contract deliberately projects the newest canonical
    // conversation message into `preview`. A detailed snapshot with turns is
    // still more authoritative than the list projection.
    archived,
    closedQuestionTurnId: questionTurnClosed(thread.turns.at(-1))
      ? (thread.turns.at(-1)?.id ?? previous?.closedQuestionTurnId ?? null)
      : (previous?.closedQuestionTurnId ?? null),
    cwd: thread.cwd,
    gitOriginUrl: thread.gitInfo?.originUrl ?? previous?.gitOriginUrl ?? null,
    lastSeenCursor: previous?.lastSeenCursor ?? 0,
    latestActivityCursor: previous?.latestActivityCursor ?? 0,
    pendingQuestion:
      thread.turns.length > 0
        ? questionOpportunity(previewThread.turns)
        : thread.status.type === "active" && thread.updatedAt === previous?.updatedAt
          ? (previous.pendingQuestion ?? null)
          : null,
    pendingRequestCount: previous?.pendingRequestCount ?? 0,
    pinned: previous?.pinned ?? false,
    preview: selectPreview(
      snapshotPreview,
      listedPreview,
      isSubagent && (previous?.latestActivityCursor ?? 0) <= 0 ? undefined : previous?.preview,
    ),
    recencyAt: thread.recencyAt,
    skippedQuestions: previous?.skippedQuestions ?? null,
    status: normalizeThreadStatus(thread.status),
    submittedQuestions: previous?.submittedQuestions ?? null,
    unread: previous?.unread ?? 0,
    updatedAt: thread.updatedAt,
    // A list snapshot means the thread is now materialized by the companion.
    // Keeping an older thread/started shell here makes the conversation screen
    // skip thread/resume forever and renders that empty shell instead.
    deleteCommandId: previous?.deleteCommandId ?? null,
    provisionalThread: null,
  };
}

function selectPreview(
  snapshotPreview: string | null | undefined,
  listedPreview: string,
  previousPreview: string | undefined,
): string {
  if (snapshotPreview !== null && snapshotPreview !== undefined && snapshotPreview !== "") {
    return snapshotPreview;
  }
  if (listedPreview !== "") {
    return listedPreview;
  }
  return previousPreview ?? "";
}

export function projectThreadSummaryEvent(
  connectionId: string,
  payload: Record<string, unknown>,
  previousFor: (threadId: string) => StoredThreadSummary | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  cursor = 0,
): ThreadSummaryMutation | null {
  const patch = threadProjectionPatchFromEvent(payload);
  if (patch === null || isHighFrequencySummaryPatch(patch.operation.kind)) {
    return null;
  }
  return projectThreadSummaryPatch(connectionId, patch, previousFor, nowSeconds, cursor);
}

const HIGH_FREQUENCY_SUMMARY_PATCHES = new Set([
  "itemTextDelta",
  "fileChanges",
  "mcpProgress",
  "tokenUsage",
  "turnDiff",
  "turnPlan",
  "reasoningPart",
  "reasoningDelta",
]);

function isHighFrequencySummaryPatch(kind: string): boolean {
  return HIGH_FREQUENCY_SUMMARY_PATCHES.has(kind);
}

function projectThreadSummaryPatch(
  connectionId: string,
  patch: ThreadProjectionPatchV1,
  previousFor: (threadId: string) => StoredThreadSummary | undefined,
  nowSeconds: number,
  cursor: number,
): ThreadSummaryMutation | null {
  const operation = patch.operation;
  if (operation.kind === "threadStarted") {
    const thread = operation.thread;
    if (!isThread(thread)) {
      return null;
    }
    const previous = previousFor(thread.id);
    return {
      key: threadSummaryKey(connectionId, thread.id),
      value: {
        ...projectThreadSummarySnapshot(connectionId, thread, false, previous),
        provisionalThread: thread,
      },
    };
  }
  const key = threadSummaryKey(connectionId, patch.threadId);
  if (operation.kind === "threadDeleted") {
    return { key, value: null };
  }
  const previous = previousFor(patch.threadId);
  if (previous === undefined) {
    return null;
  }
  const next: StoredThreadSummary = { ...previous };
  if (
    operation.kind === "turnStarted" ||
    (operation.kind === "itemUpsert" && closesAsyncQuestions(operation.item)) ||
    (operation.kind === "turnCompleted" &&
      object(operation.turn)?.id === previous.pendingQuestion?.turnId)
  ) {
    next.pendingQuestion = null;
  } else if (
    operation.kind === "itemUpsert" &&
    hasAsyncQuestions(operation.item) &&
    typeof operation.turnId === "string" &&
    operation.turnId !== next.closedQuestionTurnId
  ) {
    const itemId = object(operation.item)?.id;
    if (typeof itemId === "string") {
      const currentIds =
        next.pendingQuestion?.turnId === operation.turnId ? next.pendingQuestion.itemIds : [];
      next.pendingQuestion = {
        itemIds: currentIds.includes(itemId) ? currentIds : [...currentIds, itemId],
        turnId: operation.turnId,
      };
    }
  }
  if (operation.kind === "turnCompleted") {
    const completedId = object(operation.turn)?.id;
    if (typeof completedId === "string") {
      next.closedQuestionTurnId = completedId;
    }
  }
  if (
    operation.kind === "itemUpsert" &&
    isFinalQuestionTurnMessage(operation.item) &&
    typeof operation.turnId === "string"
  ) {
    next.closedQuestionTurnId = operation.turnId;
  }
  const attentionChanged =
    next.pendingQuestion !== previous.pendingQuestion ||
    next.closedQuestionTurnId !== previous.closedQuestionTurnId;
  if (operation.kind === "threadName") {
    next.name = typeof operation.threadName === "string" ? operation.threadName : null;
  } else if (operation.kind === "threadStatus" && object(operation.status) !== null) {
    next.status = normalizeThreadStatus(operation.status);
  } else if (operation.kind === "threadArchived") {
    next.archived = operation.archived === true;
  } else {
    const lifecycleChanged = operation.kind === "turnStarted" || operation.kind === "turnCompleted";
    if (operation.kind === "turnStarted" && next.status.type !== "active") {
      next.status = { activeFlags: [], type: "active" };
    } else if (operation.kind === "turnCompleted") {
      next.status = { type: "idle" };
    }
    const summary = object(operation.summary);
    if (summary === null || summary.activity !== true) {
      return lifecycleChanged || attentionChanged ? { key, value: next } : null;
    }
    if (typeof summary.previewText === "string") {
      const preview = plainThreadPreview(summary.previewText);
      if (preview !== "") {
        next.preview = preview;
      }
    }
    next.provisionalThread = null;
    next.updatedAt = Math.max(next.updatedAt, nowSeconds);
    next.latestActivityCursor = Math.max(next.latestActivityCursor, cursor);
    if (
      typeof summary.recencyAt === "number" &&
      Number.isSafeInteger(summary.recencyAt) &&
      summary.recencyAt >= 0
    ) {
      next.recencyAt = Math.max(next.recencyAt ?? 0, summary.recencyAt);
    }
    if (summary.finalAgentResponse === true) {
      next.unread = next.latestActivityCursor > next.lastSeenCursor ? 1 : 0;
    }
  }
  return { key, value: next };
}

function object(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}

function questionOpportunity(turns: Thread["turns"]): QuestionOpportunity | null {
  const questions = currentAsyncQuestions(turns);
  const latest = questions.at(-1);
  return latest === undefined
    ? null
    : {
        itemIds: questions.map(({ item }) => item.id),
        turnId: latest.turnId,
      };
}

function questionTurnClosed(turn: Thread["turns"][number] | undefined): boolean {
  return (
    turn !== undefined &&
    (turn.status !== "inProgress" || turn.items.some(isFinalQuestionTurnMessage))
  );
}
