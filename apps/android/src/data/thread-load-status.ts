export type ThreadLoadStatus =
  | "idle"
  | "initial-loading"
  | "ready"
  | "background-updating"
  | "loading-history"
  | "background-retrying"
  | "initial-error";

/** Only these states may replace the conversation with its global loader. */
export function threadLoadBlocksPresentation(status: ThreadLoadStatus): boolean {
  return status === "idle" || status === "initial-loading";
}

/** A resident snapshot remains usable throughout every background operation. */
export function threadLoadHasResidentSnapshot(status: ThreadLoadStatus): boolean {
  return status === "ready"
    || status === "background-updating"
    || status === "loading-history"
    || status === "background-retrying";
}

export function threadLoadIsHistoryLoading(status: ThreadLoadStatus): boolean {
  return status === "loading-history";
}

/** Combines SQLite range and authoritative-refresh state into the one status
 * consumed by the conversation UI. A usable resident snapshot always wins
 * over another source's cold state, while its background work stays visible. */
export function mergeThreadLoadStatuses(...statuses: readonly ThreadLoadStatus[]): ThreadLoadStatus {
  const hasResidentSnapshot = statuses.some(threadLoadHasResidentSnapshot);
  if (hasResidentSnapshot) {
    if (statuses.includes("loading-history")) return "loading-history";
    if (statuses.includes("background-retrying") || statuses.includes("initial-error")) return "background-retrying";
    if (statuses.includes("background-updating") || statuses.includes("initial-loading") || statuses.includes("idle")) return "background-updating";
    return "ready";
  }
  if (statuses.includes("initial-error")) return "initial-error";
  if (statuses.includes("initial-loading")) return "initial-loading";
  return "idle";
}
