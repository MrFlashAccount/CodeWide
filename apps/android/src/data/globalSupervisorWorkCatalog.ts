import type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
import type { StoredThreadSummary } from "./thread-summary-types";

export const GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT = 100;
const WORK_CATALOG_VIEW_ID = "global-supervisor-work";
const WORK_CATALOG_REQUEST = {
  archivedLimit: 0,
  connectionId: null,
  recentLimit: GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT,
  selectedConnectionId: null,
  selectedThreadId: null,
  subagentConnectionId: null,
  subagentLimit: 0,
  viewId: WORK_CATALOG_VIEW_ID,
} as const;

function appendDistinctRows(
  target: StoredThreadSummary[],
  seen: Set<string>,
  source: readonly StoredThreadSummary[],
): void {
  for (const row of source) {
    const key = `${row.connectionId}\u0000${row.remoteThreadId}`;
    if (!seen.has(key)) {
      seen.add(key);
      target.push(row);
    }
    if (target.length >= GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT) {
      return;
    }
  }
}

/** Reads the event-maintained visible root catalog without starting remote polling. */
export async function readGlobalSupervisorWorkCatalog(
  database: ThreadSummaryDatabase,
): Promise<readonly StoredThreadSummary[]> {
  let snapshot = database.model.view$(WORK_CATALOG_REQUEST).peek();
  if (snapshot.phase !== "ready") {
    await database.loadView(WORK_CATALOG_REQUEST);
    snapshot = database.model.view$(WORK_CATALOG_REQUEST).peek();
  }
  const rows: StoredThreadSummary[] = [];
  const seen = new Set<string>();
  appendDistinctRows(rows, seen, snapshot.pinned);
  if (rows.length < GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT) {
    appendDistinctRows(rows, seen, snapshot.recent);
  }
  return rows;
}
