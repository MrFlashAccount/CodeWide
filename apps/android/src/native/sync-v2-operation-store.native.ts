import {
  applyOperationUpdate,
  fingerprintV2Command,
  V2_OPERATION_RECEIPT_MAX_AGE_MS,
  type V2Command,
  type V2OperationStore,
  type V2PersistedOperation,
} from "@codewide/sync-client";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import { getUiCacheSqliteDatabase } from "../data/ui-cache-persistence.native";

const TABLE = "codewide_sync_v2_operations_by_saved_server";
const UNAPPROVED_CONTEXT_TABLE = "codewide_sync_v2_operations_by_context";
const LEGACY_TABLE = "codewide_sync_v2_operations";

/** Durable operation identities partitioned by stable saved-server id. */
export function createNativeSyncV2OperationStore(): V2OperationStore {
  return createNativeSyncV2OperationStoreWithDatabase(getUiCacheSqliteDatabase());
}

export function createNativeSyncV2OperationStoreWithDatabase(database: SqliteDatabase): V2OperationStore {
  let prepared: Promise<void> | null = null;
  const prepare = (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (saved_server_id TEXT NOT NULL, operation_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(saved_server_id, operation_id))`);
      await executor.execute(`DROP TABLE IF EXISTS ${UNAPPROVED_CONTEXT_TABLE}`);
      await executor.execute(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
    });
    return prepared;
  };
  const read = async (executor: SqliteExecutor, savedServerId: string, operationId: string): Promise<V2PersistedOperation | null> => {
    const rows = extractRows(await executor.execute(`SELECT payload FROM ${TABLE} WHERE saved_server_id = ? AND operation_id = ? LIMIT 1`, [savedServerId, operationId]));
    return parseOperation(rows[0]?.payload);
  };
  const readAll = async (executor: SqliteExecutor, savedServerId: string): Promise<V2PersistedOperation[]> => {
    const rows = extractRows(await executor.execute(`SELECT payload FROM ${TABLE} WHERE saved_server_id = ?`, [savedServerId]));
    return rows.map((row) => parseOperation(row.payload)).filter((value): value is V2PersistedOperation => value !== null);
  };
  const write = async (executor: SqliteExecutor, savedServerId: string, operation: V2PersistedOperation): Promise<void> => {
    await executor.execute(
      `INSERT INTO ${TABLE}(saved_server_id, operation_id, payload) VALUES (?, ?, ?) ON CONFLICT(saved_server_id, operation_id) DO UPDATE SET payload = excluded.payload`,
      [savedServerId, operation.operationId, JSON.stringify(operation)],
    );
  };
  const pruneInTransaction = async (executor: SqliteExecutor, savedServerId: string, nowMs: number): Promise<void> => {
    for (const operation of await readAll(executor, savedServerId)) {
      if (nowMs - retentionStart(operation) < V2_OPERATION_RECEIPT_MAX_AGE_MS) continue;
      await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ? AND operation_id = ?`, [savedServerId, operation.operationId]);
    }
  };
  return {
    async create(savedServerId, operationId: string, command: V2Command, nowMs = Date.now()) {
      await prepare();
      return await database.transaction(async (executor) => {
        await pruneInTransaction(executor, savedServerId, nowMs);
        const fingerprint = fingerprintV2Command(command);
        const existing = await read(executor, savedServerId, operationId);
        if (existing !== null) {
          if (existing.commandFingerprint !== fingerprint) throw new Error("Sync V2 operation id is already bound to a different canonical command");
          return existing;
        }
        const operation: V2PersistedOperation = {
          operationId,
          command: structuredClone(command),
          commandKind: command.kind,
          commandFingerprint: fingerprint,
          state: "created",
          terminalClass: null,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          acceptedAt: null,
        };
        await write(executor, savedServerId, operation);
        return operation;
      });
    },
    async get(savedServerId, operationId: string) {
      await prepare();
      return await database.transaction(async (executor) => await read(executor, savedServerId, operationId));
    },
    async transition(savedServerId, operationId, expected, update, nowMs = Date.now()) {
      await prepare();
      return await database.transaction(async (executor) => {
        const current = await read(executor, savedServerId, operationId);
        if (current === null) throw new Error("Unknown Sync V2 operation id");
        if (!expected.includes(current.state)) throw new Error(`Sync V2 operation transition rejected from ${current.state}`);
        const next = applyOperationUpdate(current, update, nowMs);
        await write(executor, savedServerId, next);
        return next;
      });
    },
    async recoverable(savedServerId, nowMs = Date.now()) {
      await prepare();
      return await database.transaction(async (executor) => {
        await pruneInTransaction(executor, savedServerId, nowMs);
        return (await readAll(executor, savedServerId)).filter((operation) => operation.state === "sent" && operation.command !== null);
      });
    },
    async prune(savedServerId, nowMs = Date.now()) {
      await prepare();
      await database.transaction(async (executor) => await pruneInTransaction(executor, savedServerId, nowMs));
    },
    async deleteSavedServer(savedServerId) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [savedServerId]);
      });
    },
    async hasSavedServerData(savedServerId) {
      await prepare();
      return await database.transaction(async (executor) => {
        return extractRows(await executor.execute(`SELECT 1 AS present FROM ${TABLE} WHERE saved_server_id = ? LIMIT 1`, [savedServerId])).length > 0;
      });
    },
  };
}

function retentionStart(operation: V2PersistedOperation): number {
  if (operation.acceptedAt === null) return operation.createdAtMs;
  const accepted = Date.parse(operation.acceptedAt);
  return Number.isNaN(accepted) ? operation.createdAtMs : accepted;
}

function parseOperation(payload: SqliteValue | undefined): V2PersistedOperation | null {
  return typeof payload === "string" ? JSON.parse(payload) as V2PersistedOperation : null;
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) return result as readonly Record<string, SqliteValue>[];
  if (typeof result !== "object" || result === null) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as readonly Record<string, SqliteValue>[] : [];
}
