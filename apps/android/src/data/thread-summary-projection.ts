import { threadPinFromSnapshot } from "./threadPinState";
import {
  closesAsyncQuestions,
  isFinalQuestionTurnMessage,
  currentAsyncQuestions,
  hasAsyncQuestions,
} from "./questionLifecycle";
import { readThreadAgent } from "./threadAgent";
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
  threadSummaryProjectionCursor,
  type QuestionOpportunity,
  type StoredThreadSummary,
} from "./thread-summary-types";
import { latestThreadMessagePreview, plainThreadPreview } from "./thread-cache";

function isClosedTurnStart(
  operation: ThreadProjectionPatchV1["operation"],
  summary: StoredThreadSummary,
): boolean {
  if (operation.kind !== "turnStarted") {
    return false;
  }
  const turnId = unknownRecord(operation.turn)?.id;
  return typeof turnId === "string" && turnId === summary.closedQuestionTurnId;
}

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
  // Pinned roots also live outside the bounded recent snapshot and are
  // reconciled by the separate complete Companion pin membership.
  return (
    (summary.pinned && (summary.pinCursor ?? 0) > 0) ||
    isThread(summary.provisionalThread) ||
    typeof summary.parentThreadId === "string"
  );
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
  // A subagent thread arrives as its own content: its provider adapter leaves
  // out what the agent inherited, so its preview is read as any thread's.
  const snapshotPreview = thread.turns.length > 0 ? latestThreadMessagePreview(thread) : "";
  const listedPreview = plainThreadPreview(thread.preview);
  const pin = threadPinFromSnapshot(thread);
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
    // The provider is fixed per thread; a snapshot without the descriptor keeps the last one.
    codewideAgent: readThreadAgent(thread) ?? previous?.codewideAgent ?? null,
    cwd: thread.cwd,
    firstUnreadAgentTurnId: previous?.firstUnreadAgentTurnId ?? null,
    // Derived from the child rows, which a root snapshot does not carry.
    ...(previous?.activeSubagents === undefined
      ? {}
      : { activeSubagents: previous.activeSubagents }),
    gitOriginUrl: thread.gitInfo?.originUrl ?? previous?.gitOriginUrl ?? null,
    lastSeenCursor: previous?.lastSeenCursor ?? 0,
    latestActivityCursor: previous?.latestActivityCursor ?? 0,
    pendingQuestion:
      thread.turns.length > 0
        ? questionOpportunity(thread.turns)
        : thread.status.type === "active" && thread.updatedAt === previous?.updatedAt
          ? (previous.pendingQuestion ?? null)
          : null,
    pendingRequestCount: previous?.pendingRequestCount ?? 0,
    pinCursor: Math.max(previous?.pinCursor ?? 0, pin.cursor),
    pinned: (previous?.pinCursor ?? 0) > pin.cursor ? (previous?.pinned ?? false) : pin.pinned,
    preview: selectPreview(snapshotPreview, listedPreview, previous?.preview),
    projectionCursor: previous === undefined ? 0 : threadSummaryProjectionCursor(previous),
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

/** A replayed cursor the row already applied is idempotent. */
function cursorApplied(previous: StoredThreadSummary | undefined, cursor: number): boolean {
  return cursor > 0 && previous !== undefined && cursor <= threadSummaryProjectionCursor(previous);
}

/** Applies one ordered journal event to the summary's device-owned fields. */
export function projectThreadSummaryEvent(
  connectionId: string,
  payload: Record<string, unknown>,
  previousFor: (threadId: string) => StoredThreadSummary | undefined,
  cursor = 0,
): ThreadSummaryMutation | null {
  const patch = threadProjectionPatchFromEvent(payload);
  if (patch === null || isTopicOnlySummaryPatch(patch.operation.kind)) {
    return null;
  }
  if (cursorApplied(previousFor(patch.threadId), cursor)) {
    return null;
  }
  const mutation = projectThreadSummaryPatch(connectionId, patch, previousFor, cursor);
  if (mutation !== null && mutation.value !== null) {
    mutation.value.projectionCursor = Math.max(
      threadSummaryProjectionCursor(mutation.value),
      cursor,
    );
  }
  return mutation;
}

/**
 * Device mirror of contract/v1.json `syncInterest.threadTopicKinds`: Companion
 * delivers these patch kinds only for threads in the socket's interest set.
 */
export const INTEREST_TOPIC_PATCHES: ReadonlySet<string> = new Set([
  "itemTextDelta",
  "reasoningDelta",
  "reasoningPart",
  "turnPlan",
  "turnDiff",
  "fileChanges",
  "mcpProgress",
  "tokenUsage",
  "threadProgress",
  "itemUpsert",
]);

/**
 * `itemUpsert` is topic-gated only for item types outside `catalogItemTypes`;
 * the catalog types (messages, sub-agent calls, compaction) reach every socket
 * and carry the async-question and unread evidence the summary owns.
 */
function isTopicOnlySummaryPatch(kind: string): boolean {
  return kind !== "itemUpsert" && INTEREST_TOPIC_PATCHES.has(kind);
}

const DEVICE_SUMMARY_PATCHES: ReadonlySet<string> = new Set([
  "turnStarted",
  "turnCompleted",
  "itemUpsert",
]);

/**
 * Whether an event for a thread without a row would change device-owned
 * fields once that row arrives; such events wait in the pending overlay.
 */
export function threadSummaryEventAffectsDevice(payload: Record<string, unknown>): boolean {
  const patch = threadProjectionPatchFromEvent(payload);
  if (patch === null || isTopicOnlySummaryPatch(patch.operation.kind)) {
    return false;
  }
  return (
    DEVICE_SUMMARY_PATCHES.has(patch.operation.kind) ||
    object(patch.operation.summary)?.activity === true
  );
}

/** Device-owned question attention a detailed thread read proves from its turns. */
export function threadSummaryTurnAttention(
  thread: Thread,
  previous: StoredThreadSummary,
): Pick<StoredThreadSummary, "closedQuestionTurnId" | "pendingQuestion"> {
  const latest = thread.turns.at(-1);
  if (latest === undefined) {
    return {
      closedQuestionTurnId: previous.closedQuestionTurnId ?? null,
      pendingQuestion: previous.pendingQuestion ?? null,
    };
  }
  return {
    closedQuestionTurnId: questionTurnClosed(latest)
      ? latest.id
      : (previous.closedQuestionTurnId ?? null),
    pendingQuestion: questionOpportunity(thread.turns),
  };
}

/**
 * Starts a provisional shell for a new thread. An existing row keeps its
 * server fields and only gains the shell, which the next server row with newer
 * activity retires.
 */
function projectStartedThread(
  connectionId: string,
  thread: Thread,
  previous: StoredThreadSummary | undefined,
): ThreadSummaryMutation | null {
  const key = threadSummaryKey(connectionId, thread.id);
  if (previous === undefined) {
    return {
      key,
      value: {
        ...projectThreadSummarySnapshot(connectionId, thread, false),
        provisionalThread: thread,
      },
    };
  }
  if (isThread(previous.provisionalThread) || thread.updatedAt < previous.updatedAt) {
    return null;
  }
  return { key, value: { ...previous, provisionalThread: thread } };
}

/** Moves unread and the first unread agent turn when the completed turn's answer arrived. */
function applyFinalAgentResponse(
  next: StoredThreadSummary,
  operation: ThreadProjectionPatchV1["operation"],
): void {
  const completedTurnId = object(operation.turn)?.id;
  const wasUnread = next.unread > 0;
  next.unread = next.unread > 0 || next.latestActivityCursor > next.lastSeenCursor ? 1 : 0;
  if (
    !wasUnread &&
    next.unread > 0 &&
    typeof completedTurnId === "string" &&
    completedTurnId !== ""
  ) {
    next.firstUnreadAgentTurnId = completedTurnId;
  }
}

/** A new turn, a closing item or the question turn's completion retires the open question. */
function retiresPendingQuestion(
  next: StoredThreadSummary,
  operation: ThreadProjectionPatchV1["operation"],
): boolean {
  return (
    operation.kind === "turnStarted" ||
    (operation.kind === "itemUpsert" && closesAsyncQuestions(operation.item)) ||
    (operation.kind === "turnCompleted" &&
      object(operation.turn)?.id === next.pendingQuestion?.turnId)
  );
}

function isAsyncQuestionItem(operation: ThreadProjectionPatchV1["operation"]): boolean {
  return operation.kind === "itemUpsert" && hasAsyncQuestions(operation.item);
}

/** Adds an async-question item of an open turn to the pending question. */
function recordAsyncQuestion(
  next: StoredThreadSummary,
  operation: ThreadProjectionPatchV1["operation"],
): void {
  const turnId = operation.turnId;
  const itemId = object(operation.item)?.id;
  if (
    !isAsyncQuestionItem(operation) ||
    typeof turnId !== "string" ||
    turnId === next.closedQuestionTurnId ||
    typeof itemId !== "string"
  ) {
    return;
  }
  const currentIds = next.pendingQuestion?.turnId === turnId ? next.pendingQuestion.itemIds : [];
  next.pendingQuestion = {
    itemIds: currentIds.includes(itemId) ? currentIds : [...currentIds, itemId],
    turnId,
  };
}

/** A completed turn or its final question message closes that turn's questions. */
function closeQuestionTurn(
  next: StoredThreadSummary,
  operation: ThreadProjectionPatchV1["operation"],
): void {
  const completedId = object(operation.turn)?.id;
  if (operation.kind === "turnCompleted" && typeof completedId === "string") {
    next.closedQuestionTurnId = completedId;
  }
  if (
    operation.kind === "itemUpsert" &&
    isFinalQuestionTurnMessage(operation.item) &&
    typeof operation.turnId === "string"
  ) {
    next.closedQuestionTurnId = operation.turnId;
  }
}

/** Retires or records async-question attention for one ordered patch. */
function applyQuestionAttention(
  next: StoredThreadSummary,
  operation: ThreadProjectionPatchV1["operation"],
): void {
  if (retiresPendingQuestion(next, operation)) {
    next.pendingQuestion = null;
  } else {
    recordAsyncQuestion(next, operation);
  }
  closeQuestionTurn(next, operation);
}

/** Applies one patch to the device fields of an existing row. */
function projectDevicePatch(
  operation: ThreadProjectionPatchV1["operation"],
  previous: StoredThreadSummary,
  at: { readonly cursor: number; readonly key: string },
): ThreadSummaryMutation | null {
  const { cursor, key } = at;
  const next: StoredThreadSummary = { ...previous };
  applyQuestionAttention(next, operation);
  const attentionChanged =
    next.pendingQuestion !== previous.pendingQuestion ||
    next.closedQuestionTurnId !== previous.closedQuestionTurnId;
  const summary = object(operation.summary);
  if (summary?.activity !== true) {
    return attentionChanged ? { key, value: next } : null;
  }
  next.latestActivityCursor = Math.max(next.latestActivityCursor, cursor);
  if (summary.finalAgentResponse === true) {
    applyFinalAgentResponse(next, operation);
  }
  return { key, value: next };
}

/**
 * Projects one ordered patch onto device-owned fields only: question
 * attention, unread state and the activity cursor. Server fields (status,
 * name, preview, recency, archive, pins) belong to Companion list rows; the
 * only row this creates is the provisional `thread/started` shell, and the only
 * removal is a `thread/deleted` membership change.
 */
function projectThreadSummaryPatch(
  connectionId: string,
  patch: ThreadProjectionPatchV1,
  previousFor: (threadId: string) => StoredThreadSummary | undefined,
  cursor: number,
): ThreadSummaryMutation | null {
  const operation = patch.operation;
  if (operation.kind === "threadStarted") {
    const thread = operation.thread;
    return isThread(thread)
      ? projectStartedThread(connectionId, thread, previousFor(thread.id))
      : null;
  }
  const key = threadSummaryKey(connectionId, patch.threadId);
  if (operation.kind === "threadDeleted") {
    return { key, value: null };
  }
  const previous = previousFor(patch.threadId);
  return previous === undefined || isClosedTurnStart(operation, previous)
    ? null
    : projectDevicePatch(operation, previous, { cursor, key });
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
