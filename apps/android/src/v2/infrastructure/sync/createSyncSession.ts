import {
  SyncV2Session,
  V2_PROTOCOL_LIMITS,
  type V2OperationStore,
  type V2ProjectionStore,
} from "@codewide/sync-client/v2";

import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter";

export async function createSyncSession(
  savedServerId: string,
  projectionStore: V2ProjectionStore,
  operationStore: V2OperationStore,
  currentThreadId: string | null = null,
): Promise<{ release(): Promise<void>; session: SyncV2Session }> {
  const connection = await acquireSharedConnectionLease(savedServerId);
  const session = new SyncV2Session({
    intent: {
      catalog: { activeLimit: 100, archivedLimit: 50 },
      currentThread:
        currentThreadId === null
          ? null
          : { threadId: currentThreadId, turnLimit: V2_PROTOCOL_LIMITS.turnWindowMax },
    },
    operationStore,
    projectionStore,
    savedServerId,
    transportLease: connection.syncTransport,
  });
  return {
    async release() {
      await session.dispose();
      await connection.lease.release();
    },
    session,
  };
}
