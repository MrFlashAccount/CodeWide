import type { ThreadListResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";
import { parseArchivedCatalogCount } from "./catalog-summary-model";

export const THREAD_CATALOG_PAGE_SIZE = 36;

export interface ThreadCatalogPageRequest {
  archived: boolean;
  cursor: string | null;
  projectCwd?: string;
}

export interface ThreadCatalogPage {
  archivedCount?: number | null;
  threads: SyncSnapshotThread[];
  nextCursor: string | null;
}

/** Reads one metadata page. Continuation belongs to explicit list demand. */
export async function loadThreadCatalogPage(
  session: RpcClient,
  request: ThreadCatalogPageRequest,
): Promise<ThreadCatalogPage> {
  const response = await session.rpc<ThreadListResponse>("thread/list", {
    archived: request.archived,
    cursor: request.cursor,
    limit: THREAD_CATALOG_PAGE_SIZE,
    sortKey: "updated_at",
    sortDirection: "desc",
    modelProviders: [],
    sourceKinds: ["cli", "vscode"],
    useStateDbOnly: true,
    ...(request.projectCwd === undefined ? {} : { cwd: request.projectCwd }),
  });
  if (
    response === null ||
    typeof response !== "object" ||
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
  for (const thread of response.data) {
    if (
      thread === null ||
      typeof thread !== "object" ||
      typeof thread.id !== "string" ||
      typeof thread.cwd !== "string" ||
      typeof thread.preview !== "string" ||
      !Number.isFinite(thread.updatedAt) ||
      !Array.isArray(thread.turns) ||
      thread.status === null ||
      typeof thread.status !== "object" ||
      typeof thread.status.type !== "string"
    ) {
      throw new Error("thread/list returned invalid thread metadata");
    }
    if (!thread.ephemeral && thread.parentThreadId == null)
      threads.push({ thread, archived: request.archived });
  }
  const archivedCount = parseArchivedCatalogCount(
    "codewideCatalogSummary" in response ? response.codewideCatalogSummary : null,
  );
  return { threads, nextCursor: response.nextCursor, archivedCount };
}
