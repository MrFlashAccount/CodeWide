import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

import type { StoredThreadSummary } from "./thread-summary-types";

type MetadataProjectionCacheEntry = {
  summary: StoredThreadSummary;
  value: Thread;
};

const metadataProjectionCache = new WeakMap<Thread, MetadataProjectionCacheEntry>();

/** Presentation metadata may enrich a loaded chat, but lifecycle belongs to
 * the authoritative detail projection and is never copied from the list row. */
export function applyThreadSummaryMetadata(
  thread: Thread,
  summary: StoredThreadSummary | null,
): Thread;
export function applyThreadSummaryMetadata(
  thread: Thread | null,
  summary: StoredThreadSummary | null,
): Thread | null;
export function applyThreadSummaryMetadata(
  thread: Thread | null,
  summary: StoredThreadSummary | null,
): Thread | null {
  if (thread === null || summary === null || summary.remoteThreadId !== thread.id) {
    return thread;
  }
  if (threadMetadataMatchesSummary(thread, summary)) {
    return thread;
  }
  const cached = metadataProjectionCache.get(thread);
  if (
    cached !== undefined &&
    (cached.summary === summary || threadMetadataMatchesSummary(cached.value, summary))
  ) {
    return cached.value;
  }
  const value: Thread = {
    ...thread,
    agentNickname: summary.agentNickname ?? null,
    agentRole: summary.agentRole ?? null,
    cwd: summary.cwd,
    name: summary.name,
    parentThreadId: summary.parentThreadId,
    preview: summary.preview,
    recencyAt: summary.recencyAt,
    updatedAt: summary.updatedAt,
  };
  metadataProjectionCache.set(thread, { summary, value });
  return value;
}

function threadMetadataMatchesSummary(thread: Thread, summary: StoredThreadSummary): boolean {
  return (
    thread.name === summary.name &&
    thread.preview === summary.preview &&
    thread.cwd === summary.cwd &&
    thread.updatedAt === summary.updatedAt &&
    thread.recencyAt === summary.recencyAt &&
    thread.parentThreadId === summary.parentThreadId &&
    thread.agentNickname === (summary.agentNickname ?? null) &&
    thread.agentRole === (summary.agentRole ?? null)
  );
}
