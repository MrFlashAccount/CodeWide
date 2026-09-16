export interface ForegroundReadModels {
  desiredThreadId: (connectionId: string) => string | undefined;
  refreshCatalog: (connectionId: string) => Promise<void>;
  refreshThread: (connectionId: string, threadId: string) => Promise<void>;
}

/** Foreground freshness is independent of whether the transport changed state. */
export async function refreshForegroundReadModels(
  connectionId: string,
  models: ForegroundReadModels,
): Promise<void> {
  const threadId = models.desiredThreadId(connectionId);
  const repairs = [models.refreshCatalog(connectionId)];
  if (threadId !== undefined) {
    repairs.push(models.refreshThread(connectionId, threadId));
  }
  // Both projections must settle before the owner releases its in-flight slot,
  // including when only one of them fails.
  const results = await Promise.allSettled(repairs);
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
}
