import { reconcileActiveThreadCommands } from "./command-delivery";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { ThreadRemoteLoader } from "./thread-detail-database-contract";
import { shouldRepairThreadDetail } from "./thread-detail-refresh-policy";
import { createThreadSyncRuntime } from "./thread-sync-runtime";
/** Binds retained detail demand to the shared canonical read lanes. */
export function createThreadSyncRemoteLoader(
  details: ThreadDetailDatabase,
  sync: ReturnType<typeof createThreadSyncRuntime>,
): ThreadRemoteLoader {
  return {
    observe({ connectionId, threadId }) {
      void sync.observeThread(connectionId, threadId).catch((cause: unknown) => {
        console.warn("Could not attach retained thread observer", cause);
      });
    },
    async reconcilePending({ connectionId, threadId }) {
      await reconcileActiveThreadCommands(details, connectionId, threadId);
    },
    shouldRepairProjection({ connectionId, threadId }) {
      return shouldRepairThreadDetail(sync.desiredThreadId(connectionId), threadId);
    },
    async hydrateWindow({ request, cachedThread, requireAuthoritative, reason }) {
      await sync.readThread(
        request.connectionId,
        request.threadId,
        cachedThread,
        requireAuthoritative,
        reason !== "activation",
      );
    },
    async repairProjection({ connectionId, threadId }) {
      const repaired = await sync.repairThreadProjection(connectionId, threadId);
      if (repaired === null)
        throw new Error(`Authoritative projection repair returned no thread for ${threadId}`);
    },
    async loadOlder({ connectionId, threadId, cursor, historyEpoch }) {
      await sync.loadOlderTurns(connectionId, threadId, cursor, historyEpoch);
    },
    async loadNewer({ connectionId, threadId, afterTurnId, historyEpoch }) {
      return await sync.loadNewerTurns(connectionId, threadId, afterTurnId, historyEpoch);
    },
    async loadBefore({ connectionId, threadId, beforeTurnId, historyEpoch }) {
      return await sync.loadTurnsBefore(connectionId, threadId, beforeTurnId, historyEpoch);
    },
  };
}
