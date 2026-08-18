import type { ThreadListResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import {
  restoreSubagentParent,
  type RpcClient,
  type SyncSnapshotThread,
} from "@codewide/sync-client";

const SUBAGENT_PAGE_SIZE = 100;

export function subagentActivityRootThreadId(payload: Record<string, unknown>): string | null {
  // Wait for completion: item/started can race the descendant index before the
  // newly spawned child has been committed by app-server.
  if (payload.method !== "item/completed") return null;
  const params = record(payload.params);
  const item = record(params?.item);
  if (params === null || item?.type !== "subAgentActivity") return null;
  if (item.kind !== "started" && item.kind !== "interacted") return null;
  return typeof params.threadId === "string" ? params.threadId : null;
}

/**
 * Load the authoritative descendant tree for one visible root thread.
 *
 * The unscoped state-DB snapshot is intentionally fast, but older spawned
 * threads may be absent from its source-kind index. The app-server's
 * ancestor filter repairs rollout metadata and is therefore the correct
 * source for the per-thread Subagents affordance.
 */
export async function loadSubagentDescendants(
  session: RpcClient,
  rootThreadId: string,
): Promise<SyncSnapshotThread[]> {
  const loadPartition = async (archived: boolean): Promise<SyncSnapshotThread[]> => {
    const snapshots: SyncSnapshotThread[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const response: ThreadListResponse = await session.rpc<ThreadListResponse>("thread/list", {
        ancestorThreadId: rootThreadId,
        archived,
        cursor,
        limit: SUBAGENT_PAGE_SIZE,
        sortKey: "updated_at",
        sortDirection: "desc",
        useStateDbOnly: false,
      });
      snapshots.push(...response.data.map((thread) => ({
        thread: restoreSubagentParent(thread),
        archived,
      })));
      cursor = response.nextCursor;
      if (cursor !== null && seenCursors.has(cursor)) {
        throw new Error("thread/list returned a repeated subagent cursor");
      }
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

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
