import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";
import { isThread } from "./thread-cursor-sync";
import type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
import { validPinCursor } from "./threadPinState";
import { unknownRecord } from "./unknownRecord";

type PinSnapshot = {
  readonly archivedThreadIds: readonly string[];
  readonly cursor: number;
  readonly threadIds: readonly string[];
};

type ThreadPinsCatalog = {
  readonly ensure: (connectionId: string, force?: boolean) => Promise<void>;
  readonly invalidate: (connectionId: string) => void;
};

type PinCatalogPorts = {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly getSummaries: () => ThreadSummaryDatabase | null;
};

function parseIds(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((id): id is string => typeof id === "string" && id.length > 0 && id.trim() === id)
  ) {
    throw new Error("Companion returned invalid pinned thread identities");
  }
  return value;
}

function parseSnapshot(value: unknown): PinSnapshot {
  const response = unknownRecord(value);
  if (response === null || !validPinCursor(response.cursor)) {
    throw new Error("Companion returned an invalid pin snapshot");
  }
  const threadIds = parseIds(response.threadIds);
  const archivedThreadIds = parseIds(response.archivedThreadIds);
  const pins = new Set(threadIds);
  if (archivedThreadIds.some((id) => !pins.has(id))) {
    throw new Error("Companion returned an invalid pinned archive");
  }
  return { archivedThreadIds, cursor: response.cursor, threadIds };
}

async function migratePins(
  session: RpcClient,
  connectionId: string,
  summaries: ThreadSummaryDatabase,
): Promise<void> {
  const threadIds = await summaries.loadPendingPinMigration(connectionId);
  if (threadIds.length === 0) {
    return;
  }
  const response = unknownRecord(
    await session.rpc<unknown>("companion/thread/pins/import", { threadIds }),
  );
  if (response === null || !validPinCursor(response.cursor)) {
    throw new Error("Companion returned an invalid pin import acknowledgement");
  }
  await summaries.acknowledgePinMigration(connectionId, threadIds);
}

async function refreshPins(
  session: RpcClient,
  connectionId: string,
  summaries: ThreadSummaryDatabase,
): Promise<void> {
  await migratePins(session, connectionId, summaries);
  const snapshot = parseSnapshot(await session.rpc<unknown>("companion/thread/pins/list", {}));
  const archived = new Set(snapshot.archivedThreadIds);
  const missing: SyncSnapshotThread[] = [];
  for (const id of snapshot.threadIds) {
    if ((await summaries.get(connectionId, id)) !== null) {
      continue;
    }
    const response = unknownRecord(
      await session.rpc<unknown>("thread/read", { includeTurns: false, threadId: id }),
    );
    if (!isThread(response?.thread) || response.thread.id !== id) {
      throw new Error("Companion returned invalid pinned thread metadata");
    }
    missing.push({ archived: archived.has(id), thread: response.thread });
  }
  await summaries.mergeSnapshots(connectionId, missing);
  await summaries.applyPinSnapshot(connectionId, snapshot);
}

/** Restores all server pins independently of the paginated recent catalog. */
export function createThreadPinsCatalog({
  getSession,
  getSummaries,
}: PinCatalogPorts): ThreadPinsCatalog {
  const dirty = new Set<string>();
  const loaded = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  const generations = new Map<string, number>();
  const generationFor = (connectionId: string): number => generations.get(connectionId) ?? 0;
  const markLoaded = (connectionId: string, generation: number): void => {
    if (generation === (generations.get(connectionId) ?? 0)) {
      loaded.add(connectionId);
    }
  };
  return {
    async ensure(connectionId: string, force = false): Promise<void> {
      const pending = inFlight.get(connectionId);
      if (pending !== undefined) {
        if (force) {
          dirty.add(connectionId);
        }
        return pending;
      }
      if (!force && loaded.has(connectionId)) {
        return;
      }
      const session = getSession(connectionId);
      const summaries = getSummaries();
      if (session === undefined || summaries === null) {
        return;
      }
      const generation = generationFor(connectionId);
      const operation = (async () => {
        do {
          dirty.delete(connectionId);
          await refreshPins(session, connectionId, summaries);
        } while (dirty.has(connectionId));
      })()
        .then(() => {
          markLoaded(connectionId, generation);
        })
        .finally(() => {
          if (inFlight.get(connectionId) === operation) {
            inFlight.delete(connectionId);
          }
        });
      inFlight.set(connectionId, operation);
      return operation;
    },
    invalidate(connectionId: string): void {
      dirty.add(connectionId);
      loaded.delete(connectionId);
      generations.set(connectionId, (generations.get(connectionId) ?? 0) + 1);
    },
  };
}
