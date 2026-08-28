import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
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
  // The global interactive-thread snapshot does not contain descendants.
  // Those rows come from the Companion parent index and must survive later
  // reconnect snapshots; explicit thread/deleted events still remove them.
  return summary.provisionalThread != null || summary.parentThreadId != null;
}

export function threadSummaryDescendantKeys(
  rows: readonly StoredThreadSummary[],
  rootThreadId: string,
): Set<string> {
  const descendantIds = new Set([rootThreadId]);
  const keys = new Set<string>();
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const row of rows) {
      if (row.parentThreadId === null || !descendantIds.has(row.parentThreadId) || descendantIds.has(row.remoteThreadId)) continue;
      descendantIds.add(row.remoteThreadId);
      keys.add(threadSummaryKey(row.connectionId, row.remoteThreadId));
      discovered = true;
    }
  }
  return keys;
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
  if (patch === null || isHighFrequencySummaryPatch(patch.operation.kind)) return null;
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

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
