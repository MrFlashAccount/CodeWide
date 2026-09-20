import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";
import { parseArchivedCatalogCount } from "./catalog-summary-model";
import { isThread } from "./thread-cursor-sync";
import { unknownRecord } from "./unknownRecord";

export const THREAD_CATALOG_PAGE_SIZE = 36;

export interface ThreadCatalogPageRequest {
  archived: boolean;
  cursor: string | null;
  projectCwd?: string;
}

export interface ThreadCatalogPage {
  archivedCount?: number | null;
  nextCursor: string | null;
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
  const threads: SyncSnapshotThread[] = [];
  for (const candidate of response.data) {
    if (
      !isThread(candidate) ||
      typeof candidate.preview !== "string" ||
      typeof candidate.updatedAt !== "number" ||
      !Number.isFinite(candidate.updatedAt)
    ) {
      throw new Error("thread/list returned invalid thread metadata");
    }
    const thread = candidate;
    if (!thread.ephemeral && thread.parentThreadId === null) {
      threads.push({ archived: request.archived, thread });
    }
  }
  const archivedCount = parseArchivedCatalogCount(response.codewideCatalogSummary ?? null);
  return { archivedCount, nextCursor: response.nextCursor, threads };
}
