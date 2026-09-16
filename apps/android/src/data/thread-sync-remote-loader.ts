import { appLogger } from "../observability/logger";
import { reconcileActiveThreadCommands } from "./command-delivery";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { ThreadRemoteLoader } from "./thread-detail-database-contract";
import { shouldRepairThreadDetail } from "./thread-detail-refresh-policy";
import type { createThreadSyncRuntime } from "./thread-sync-runtime";
/** Binds retained detail demand to the shared canonical read lanes. */
export function createThreadSyncRemoteLoader(
  details: ThreadDetailDatabase,
  sync: ReturnType<typeof createThreadSyncRuntime>,
): ThreadRemoteLoader {
  return {
    async hydrateWindow({ cachedThread, reason, request, requireAuthoritative }) {
      await sync.readThread(
        request.connectionId,
        request.threadId,
        cachedThread,
        requireAuthoritative,
        reason !== "activation",
      );
    },
    async loadBefore({ beforeTurnId, connectionId, historyEpoch, threadId }) {
      return sync.loadTurnsBefore(connectionId, threadId, beforeTurnId, historyEpoch);
    },
    async loadNewer({ afterTurnId, connectionId, historyEpoch, threadId }) {
      return sync.loadNewerTurns(connectionId, threadId, afterTurnId, historyEpoch);
    },
    async loadOlder({ connectionId, cursor, historyEpoch, threadId }) {
      await sync.loadOlderTurns(connectionId, threadId, cursor, historyEpoch);
    },
    observe({ connectionId, threadId }) {
      void sync.observeThread(connectionId, threadId).catch(() => {
        appLogger.warn({
          event: "thread.observer.attach_failed",
          fields: { connectionId, threadId },
        });
      });
    },
    async reconcilePending({ connectionId, threadId }) {
      await reconcileActiveThreadCommands(details, connectionId, threadId);
    },
    async repairProjection({ connectionId, threadId }) {
      const repaired = await sync.repairThreadProjection(connectionId, threadId);
      if (repaired === null) {
        throw new Error(`Authoritative projection repair returned no thread for ${threadId}`);
      }
    },
    shouldRepairProjection({ connectionId, threadId }) {
      return shouldRepairThreadDetail(sync.desiredThreadId(connectionId), threadId);
    },
  };
}
