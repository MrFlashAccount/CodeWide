import { unknownRecord } from "./unknownRecord";
import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";
import { parseIndexedSubagents, subagentSnapshotThreads } from "./subagentIndexRows";

/** Journaled Companion event: the indexed subagents of `params.threadId` (a root) changed. */
const SUBAGENTS_INVALIDATED_METHOD = "companion/thread/subagents/invalidated";

/**
 * The root thread whose descendant index must be read again after this live event, or `null`.
 *
 * The Companion announces every indexed change (an agent appears, its running status or facts
 * change) with `companion/thread/subagents/invalidated` after its index is updated. Spawning calls
 * still request one immediate read so a Companion without that event lists the new agent.
 */
export function subagentRefreshRoot(payload: Record<string, unknown>): string | null {
  const params = unknownRecord(payload.params);
  if (params === null || typeof params.threadId !== "string") {
    return null;
  }
  const rootThreadId = params.threadId;
  if (payload.method === SUBAGENTS_INVALIDATED_METHOD) {
    return rootThreadId;
  }
  const item = unknownRecord(params.item);
  if (item === null || payload.method !== "item/completed") {
    return null;
  }
  // Codex: wait for completion, because item/started can race the new rollout header. The
  // Companion watcher advances the local metadata index independently of the UI invalidation
  // suppression window.
  if (item.type === "subAgentActivity") {
    return item.kind === "started" || item.kind === "interacted" ? rootThreadId : null;
  }
  // Claude: its agents are never announced as threads; the spawning call is a live signal.
  // CodeWide orchestration: the spawning call completes once the Companion has linked the agent.
  const spawning =
    (item.type === "collabAgentToolCall" && item.tool === "spawnAgent") ||
    (item.type === "dynamicToolCall" && item.tool === "codewide_spawn_agent");
  return spawning ? rootThreadId : null;
}

/** Load one descendant tree from the Companion's canonical parent index. */
export async function loadSubagentDescendants(
  session: RpcClient,
  rootThreadId: string,
): Promise<SyncSnapshotThread[]> {
  const response = await session.rpc<unknown>("companion/threadSubagents/read", {
    threadId: rootThreadId,
  });
  return subagentSnapshotThreads(parseIndexedSubagents(response), rootThreadId);
}
