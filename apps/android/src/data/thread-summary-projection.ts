import type { Thread, ThreadItem, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { threadProjectionPatchFromEvent, type ThreadProjectionPatchV1 } from "@codewide/sync-client";

import { normalizeThreadStatus, type StoredThreadSummary } from "./thread-summary-types";
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
  // The fast global source-kind snapshot is not authoritative for older
  // spawned descendants. Those rows are repaired by a scoped ancestor query
  // and must survive later reconnect snapshots; explicit thread/deleted events
  // still remove them through the normal event projection.
  return summary.provisionalThread != null || summary.parentThreadId != null;
}

export function projectThreadSummarySnapshot(
  connectionId: string,
  thread: Thread,
  archived: boolean,
  previous?: StoredThreadSummary,
): StoredThreadSummary {
  const isSubagent = thread.parentThreadId != null;
  const previewThread = isSubagent ? { ...thread, turns: subagentOwnTurns(thread) } : thread;
  const snapshotPreview = previewThread.turns.length > 0
    ? latestThreadMessagePreview(previewThread)
    : "";
  const listedPreview = plainThreadPreview(thread.preview);
  return {
    connectionId,
    remoteThreadId: thread.id,
    parentThreadId: thread.parentThreadId ?? null,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    name: thread.name,
    // The companion contract deliberately projects the newest canonical
    // conversation message into `preview`. A detailed snapshot with turns is
    // still more authoritative than the list projection.
    preview: isSubagent
      ? snapshotPreview || listedPreview || ((previous?.latestActivityCursor ?? 0) > 0 ? previous?.preview ?? "" : "")
      : snapshotPreview || listedPreview || previous?.preview || "",
    cwd: thread.cwd,
    gitOriginUrl: thread.gitInfo?.originUrl ?? previous?.gitOriginUrl ?? null,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt,
    status: normalizeThreadStatus(thread.status),
    pinned: previous?.pinned ?? false,
    archived,
    pendingRequestCount: previous?.pendingRequestCount ?? 0,
    latestActivityCursor: previous?.latestActivityCursor ?? 0,
    lastSeenCursor: previous?.lastSeenCursor ?? 0,
    unread: previous?.unread ?? 0,
    // A list snapshot means the thread is now materialized by the companion.
    // Keeping an older thread/started shell here makes the conversation screen
    // skip thread/resume forever and renders that empty shell instead.
    provisionalThread: null,
    deleteCommandId: previous?.deleteCommandId ?? null,
  };
}

export function projectThreadSummaryEvent(
  connectionId: string,
  payload: Record<string, unknown>,
  previousFor: (threadId: string) => StoredThreadSummary | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000),
  cursor = 0,
): ThreadSummaryMutation | null {
  const patch = threadProjectionPatchFromEvent(payload);
  if (patch !== null) {
    if (isHighFrequencySummaryPatch(patch.operation.kind)) return null;
    return projectThreadSummaryPatch(connectionId, patch, previousFor, nowSeconds, cursor);
  }
  const method = payload.method;
  const params = object(payload.params);
  if (typeof method !== "string" || params === null) return null;
  if (isHighFrequencySummaryMethod(method)) return null;
  if (method === "thread/started") {
    const thread = object(params.thread) as Thread | null;
    if (thread === null || typeof thread.id !== "string" || thread.ephemeral) return null;
    const previous = previousFor(thread.id);
    return {
      key: threadSummaryKey(connectionId, thread.id),
      value: {
        ...projectThreadSummarySnapshot(connectionId, thread, false, previous),
        provisionalThread: thread,
      },
    };
  }
  const threadId = typeof params.threadId === "string" ? params.threadId : null;
  if (threadId === null) return null;
  const key = threadSummaryKey(connectionId, threadId);
  if (method === "thread/deleted") return { key, value: null };
  const previous = previousFor(threadId);
  if (previous === undefined) return null;
  const next: StoredThreadSummary = { ...previous };
  if (method === "thread/name/updated") next.name = typeof params.threadName === "string" ? params.threadName : null;
  else if (method === "thread/status/changed" && object(params.status) !== null) next.status = normalizeThreadStatus(params.status);
  else if (method === "thread/archived" || method === "thread/unarchived") next.archived = method === "thread/archived";
  else {
    const preview = previewFromEvent(method, params);
    if (preview !== null) next.preview = preview;
    if (!isThreadActivity(method)) return null;
    next.provisionalThread = null;
    next.updatedAt = Math.max(next.updatedAt, nowSeconds);
    next.latestActivityCursor = Math.max(next.latestActivityCursor, cursor);
    // `updatedAt` tracks all activity for cache reconciliation. `recencyAt`
    // tracks conversation messages only, so tool progress, reasoning, token
    // usage and partial agent items cannot reorder the Recent list.
    if (isConversationMessage(method, params)) {
      next.recencyAt = Math.max(next.recencyAt ?? 0, nowSeconds);
    }
    // Only a completed turn with a final agent bubble may light the unread
    // indicator; later bookkeeping must not relight it.
    if (isFinalAgentResponse(method, params)) {
      next.unread = next.latestActivityCursor > next.lastSeenCursor ? 1 : 0;
    }
  }
  return { key, value: next };
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

function isHighFrequencySummaryMethod(method: string): boolean {
  return method === "item/agentMessage/delta"
    || method === "item/plan/delta"
    || method === "item/commandExecution/outputDelta"
    || method === "item/fileChange/patchUpdated"
    || method === "item/mcpToolCall/progress"
    || method === "thread/tokenUsage/updated"
    || method === "turn/diff/updated"
    || method === "turn/plan/updated"
    || method === "item/reasoning/summaryPartAdded"
    || method === "item/reasoning/summaryTextDelta"
    || method === "item/reasoning/textDelta";
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
    const thread = object(operation.thread) as Thread | null;
    if (thread === null || typeof thread.id !== "string" || thread.ephemeral) return null;
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
  if (operation.kind === "threadDeleted") return { key, value: null };
  const previous = previousFor(patch.threadId);
  if (previous === undefined) return null;
  const next: StoredThreadSummary = { ...previous };
  if (operation.kind === "threadName") next.name = typeof operation.threadName === "string" ? operation.threadName : null;
  else if (operation.kind === "threadStatus" && object(operation.status) !== null) next.status = normalizeThreadStatus(operation.status);
  else if (operation.kind === "threadArchived") next.archived = operation.archived === true;
  else {
    const summary = object(operation.summary);
    if (summary === null || summary.activity !== true) return null;
    if (typeof summary.previewText === "string") {
      const preview = plainThreadPreview(summary.previewText);
      if (preview !== "") next.preview = preview;
    }
    next.provisionalThread = null;
    next.updatedAt = Math.max(next.updatedAt, nowSeconds);
    next.latestActivityCursor = Math.max(next.latestActivityCursor, cursor);
    if (summary.conversationMessage === true) next.recencyAt = Math.max(next.recencyAt ?? 0, nowSeconds);
    if (summary.finalAgentResponse === true) next.unread = next.latestActivityCursor > next.lastSeenCursor ? 1 : 0;
  }
  return { key, value: next };
}

function previewFromEvent(method: string, params: Record<string, unknown>): string | null {
  if (method === "turn/started" || method === "turn/completed") {
    const turn = object(params.turn) as Turn | null;
    return turn === null ? null : previewFromItems(turn.items, method === "turn/completed");
  }
  if (method === "item/started" || method === "item/completed") {
    const item = object(params.item) as ThreadItem | null;
    // A phased final answer replaces progress only at turn/completed. Until
    // then the list subtitle and the open bubble must keep showing the latest
    // commentary update.
    return item === null || (item.type === "agentMessage" && item.phase === "final_answer")
      ? null
      : previewFromItems([item]);
  }
  return null;
}

function previewFromItems(items: ThreadItem[], preferFinal = false): string | null {
  if (preferFinal) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.type !== "agentMessage" || item.phase !== "final_answer") continue;
      const text = plainThreadPreview(item.text);
      if (text !== "") return text;
    }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "agentMessage") {
      const text = plainThreadPreview(item.text);
      if (text !== "") return text;
      continue;
    }
    if (item?.type === "userMessage") {
      const text = item.content.flatMap((part) => part.type === "text" ? [part.text] : []).join(" ");
      return plainThreadPreview(text) || null;
    }
  }
  return null;
}

function isThreadActivity(method: string): boolean {
  return method.startsWith("turn/") || method.startsWith("item/") || method === "thread/tokenUsage/updated";
}

function isFinalAgentResponse(method: string, params: Record<string, unknown>): boolean {
  if (method !== "turn/completed") return false;
  const turn = object(params.turn) as Turn | null;
  if (turn === null) return false;
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.type === "agentMessage" && item.text.trim() !== "") return true;
  }
  return false;
}

function isConversationMessage(method: string, params: Record<string, unknown>): boolean {
  if (isFinalAgentResponse(method, params)) return true;
  if (method === "turn/started" || method === "turn/completed") {
    const turn = object(params.turn) as Turn | null;
    return turn?.items.some((item) => item.type === "userMessage") ?? false;
  }
  if (method === "item/started" || method === "item/completed") {
    const item = object(params.item) as ThreadItem | null;
    return item?.type === "userMessage";
  }
  return false;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
