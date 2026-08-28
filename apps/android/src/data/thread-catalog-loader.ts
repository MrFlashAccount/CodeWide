import type { ThreadListResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";

const THREAD_CATALOG_PAGE_SIZE = 100;

/** Loads one complete root-thread catalog before the caller replaces SQLite. */
export async function loadThreadCatalog(session: RpcClient): Promise<SyncSnapshotThread[]> {
  const loadPartition = async (archived: boolean): Promise<SyncSnapshotThread[]> => {
    const snapshots: SyncSnapshotThread[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const response: ThreadListResponse = await session.rpc<ThreadListResponse>("thread/list", {
        archived,
        cursor,
        limit: THREAD_CATALOG_PAGE_SIZE,
        sortKey: "updated_at",
        sortDirection: "desc",
        modelProviders: [],
        // Sidebar hydration must stay on Codex's queryable metadata path.
        // JSONL scan-and-repair is a separate maintenance operation and must
        // never block the interactive catalog request.
        useStateDbOnly: true,
      });
      snapshots.push(...response.data
        .filter((thread) => !thread.ephemeral && thread.parentThreadId == null)
        .map((thread) => ({ thread, archived })));
      cursor = response.nextCursor;
      if (cursor !== null && seenCursors.has(cursor)) throw new Error("thread/list returned a repeated catalog cursor");
      if (cursor !== null) seenCursors.add(cursor);
    } while (cursor !== null);
    return snapshots;
  };

  const [active, archived] = await Promise.all([
    loadPartition(false),
    loadPartition(true),
  ]);
  return [...active, ...archived];
}
