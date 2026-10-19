import { catalogExcludedThreadIds } from "./threadCatalogMembership";
import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";
import { parseArchivedCatalogCount } from "./catalog-summary-model";
import { parseThreadListRow, type ThreadListRow } from "./threadListRow";
import { unknownRecord } from "./unknownRecord";

export const THREAD_CATALOG_PAGE_SIZE = 36;

export interface ThreadCatalogPageRequest {
  archived: boolean;
  cursor: string | null;
  projectCwd?: string;
}

export interface ThreadCatalogPage {
  archivedCount?: number | null;
  excludedThreadIds: readonly string[];
  nextCursor: string | null;
  /** Validated rows with their `codewideList` cursor, archive state and live activity. */
  rows: readonly ThreadListRow[];
  threads: SyncSnapshotThread[];
}

/** Reads one metadata page. Continuation belongs to explicit list demand. */
export async function loadThreadCatalogPage(
  session: RpcClient,
  request: ThreadCatalogPageRequest,
): Promise<ThreadCatalogPage> {
  const response = unknownRecord(
    await session.rpc<unknown>("thread/list", {
      archived: request.archived,
      cursor: request.cursor,
      limit: THREAD_CATALOG_PAGE_SIZE,
      modelProviders: [],
      sortDirection: "desc",
      sortKey: "recency_at",
      sourceKinds: ["cli", "vscode"],
      useStateDbOnly: true,
      ...(request.projectCwd === undefined ? {} : { cwd: request.projectCwd }),
    }),
  );
  if (
    response === null ||
    !Array.isArray(response.data) ||
    (response.nextCursor !== null && typeof response.nextCursor !== "string")
  ) {
    throw new Error("thread/list returned an invalid catalog page");
  }
  if (
    response.nextCursor !== null &&
    (response.nextCursor.length === 0 || response.nextCursor === request.cursor)
  ) {
    throw new Error("thread/list returned a repeated catalog cursor");
  }
  const rows: ThreadListRow[] = [];
  const threads: SyncSnapshotThread[] = [];
  for (const candidate of response.data) {
    const row = parseThreadListRow(candidate);
    if (row.status === "error") {
      throw new Error(`thread/list returned ${row.error}`);
    }
    rows.push(row.value);
    // The row's own archive state, not the request partition, is authoritative.
    threads.push({ archived: row.value.meta.archived, thread: row.value.thread });
  }
  const archivedCount = parseArchivedCatalogCount(response.codewideCatalogSummary ?? null);
  return {
    archivedCount,
    excludedThreadIds: catalogExcludedThreadIds(response.codewideCatalogSummary),
    nextCursor: response.nextCursor,
    rows,
    threads,
  };
}
