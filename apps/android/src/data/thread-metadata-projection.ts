import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { StoredThreadSummary } from "./thread-summary-types";

type MetadataProjectionCacheEntry = {
  summary: StoredThreadSummary;
  value: Thread;
};

const metadataProjectionCache = new WeakMap<Thread, MetadataProjectionCacheEntry>();

/** Metadata is a mutable event projection; sealed turn content is not. */
export function applyThreadSummaryMetadata(thread: Thread, summary: StoredThreadSummary | null): Thread;
export function applyThreadSummaryMetadata(thread: Thread | null, summary: StoredThreadSummary | null): Thread | null;
export function applyThreadSummaryMetadata(thread: Thread | null, summary: StoredThreadSummary | null): Thread | null {
  if (thread === null || summary === null || summary.remoteThreadId !== thread.id) return thread;
  if (threadMetadataMatchesSummary(thread, summary)) return thread;
  const cached = metadataProjectionCache.get(thread);
  if (cached !== undefined && (cached.summary === summary || threadMetadataMatchesSummary(cached.value, summary))) {
    return cached.value;
  }
  const value: Thread = {
    ...thread,
    name: summary.name,
    preview: summary.preview,
    cwd: summary.cwd,
    updatedAt: summary.updatedAt,
    recencyAt: summary.recencyAt,
    status: summary.status,
    parentThreadId: summary.parentThreadId,
    agentNickname: summary.agentNickname ?? null,
    agentRole: summary.agentRole ?? null,
  };
  metadataProjectionCache.set(thread, { summary, value });
  return value;
}

function threadMetadataMatchesSummary(thread: Thread, summary: StoredThreadSummary): boolean {
  return thread.name === summary.name
    && thread.preview === summary.preview
    && thread.cwd === summary.cwd
    && thread.updatedAt === summary.updatedAt
    && thread.recencyAt === summary.recencyAt
    && sameThreadStatus(thread.status, summary.status)
    && thread.parentThreadId === summary.parentThreadId
    && thread.agentNickname === (summary.agentNickname ?? null)
    && thread.agentRole === (summary.agentRole ?? null);
}

function sameThreadStatus(left: Thread["status"], right: Thread["status"]): boolean {
  if (left === right) return true;
  if (left.type !== right.type) return false;
  if (left.type !== "active" || right.type !== "active") return true;
  return left.activeFlags.length === right.activeFlags.length
    && left.activeFlags.every((flag, index) => flag === right.activeFlags[index]);
}
