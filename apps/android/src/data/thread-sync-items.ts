import type { ThreadItemsListResponse, Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { RpcResponseError, type RpcClient } from "@codewide/sync-client";
import { recordTiming } from "./operational-metrics";
import type { ThreadSyncAuthority } from "./thread-sync-types";
import { parseThreadTurnsListPage } from "./thread-turns-list-page";
/** One pending full-activity read per qualified turn, including legacy server fallback. */
export function createThreadSyncItems({
  getDetails,
  getSession,
  rpcAfterAttach,
}: Pick<ThreadSyncAuthority, "getDetails" | "getSession" | "rpcAfterAttach">) {
  const turnItemsInFlight = new Map<string, Promise<Turn["items"]>>();
  const loadTurnItems = async (
    connectionId: string,
    threadId: string,
    turnId: string,
  ): Promise<Turn["items"]> => {
    const requestKey = `${connectionId}\u0000${threadId}\u0000${turnId}`;
    const pending = turnItemsInFlight.get(requestKey);
    if (pending !== undefined) {
      return pending;
    }
    const operation = (async (): Promise<Turn["items"]> => {
      const session = getSession(connectionId);
      if (session === undefined) {
        throw new Error("Connection is not enabled");
      }
      const startedAt = performance.now();
      let items: Turn["items"];
      try {
        items = [];
        let cursor: string | null = null;
        do {
          const page: ThreadItemsListResponse = await rpcAfterAttach<ThreadItemsListResponse>(
            session,
            "thread/items/list",
            {
              cursor,
              limit: 100,
              sortDirection: "asc",
              threadId,
              turnId,
            },
          );
          items.push(...page.data.map((entry) => entry.item));
          if (page.nextCursor !== null && page.nextCursor === cursor) {
            throw new Error("Server returned a repeated item cursor");
          }
          cursor = page.nextCursor;
        } while (cursor !== null);
      } catch (error) {
        // Hermes can observe an RPC error through a different bundled module
        // realm after OTA. Do not make the protocol fallback depend solely on
        // `instanceof`, otherwise the server's -32601 leaks into the Activity UI.
        if (rpcResponseErrorCode(error) !== -32_601) {
          throw error;
        }
        // Current Codex builds expose thread/items/list in the schema but reject
        // it at runtime. Hydrate the requested turn through paginated full turns
        // instead of rendering a permanently unavailable Activity section.
        items = await loadTurnItemsFromFullTurns(session, threadId, turnId);
      }
      recordTiming("turn_items_rpc_ms", performance.now() - startedAt);
      await getDetails()?.replaceTurnItems(connectionId, threadId, turnId, items);
      return items;
    })();
    turnItemsInFlight.set(requestKey, operation);
    try {
      return await operation;
    } finally {
      if (turnItemsInFlight.get(requestKey) === operation) {
        turnItemsInFlight.delete(requestKey);
      }
    }
  };
  async function loadTurnItemsFromFullTurns(
    session: RpcClient,
    threadId: string,
    turnId: string,
  ): Promise<Turn["items"]> {
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    let continuePaging = true;
    do {
      const page = parseThreadTurnsListPage(
        await rpcAfterAttach<unknown>(session, "thread/turns/list", {
          cursor,
          threadId,
          // This fallback exists for app-server builds that expose
          // thread/items/list in the schema but reject it at runtime. Never fetch a
          // whole history page with full tool output: one diff-heavy page can be
          // many megabytes and starve every other RPC on the shared socket.
          itemsView: "full",
          limit: 2,
          sortDirection: "desc",
        }),
        cursor,
      );
      const turn = page.turns.find((candidate) => candidate.id === turnId);
      if (turn !== undefined) {
        return turn.items;
      }
      if (page.nextCursor === null) {
        continuePaging = false;
        continue;
      }
      if (seenCursors.has(page.nextCursor)) {
        throw new Error("Server returned a repeated turn cursor");
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (continuePaging);
    throw new Error("Turn activity is no longer available");
  }

  function rpcResponseErrorCode(cause: unknown): number | null {
    if (cause instanceof RpcResponseError) {
      return cause.code;
    }
    if (cause === null || typeof cause !== "object" || !("code" in cause)) {
      return null;
    }
    const code = cause.code;
    return typeof code === "number" ? code : null;
  }
  return loadTurnItems;
}
