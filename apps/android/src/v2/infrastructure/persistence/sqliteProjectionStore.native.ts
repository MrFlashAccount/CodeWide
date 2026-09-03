import {
  buildV2Projection,
  compareV2Watermarks,
  reduceV2Projection,
  retainV2ProjectionOutsideCoverage,
  type V2Projection,
  type V2ProjectionChange,
  type V2ProjectionStore,
  type V2SnapshotFrame,
  type V2U64,
} from "@codewide/sync-client/v2";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import { getV2SqliteDatabase } from "./v2Database.native";
import { parsePersistedProjection } from "./persistedStateValidation";

const TABLE = "codewide_sync_v2_projection_v2_by_saved_server";
const ACTIVE_TABLE = "codewide_sync_v2_active_v2_by_saved_server";
const PREVIOUS_TABLE = "codewide_sync_v2_projection_by_saved_server";
const PREVIOUS_ACTIVE_TABLE = "codewide_sync_v2_active_by_saved_server";
const UNAPPROVED_CONTEXT_TABLE = "codewide_sync_v2_projection_by_context";
const UNAPPROVED_CONTEXT_ACTIVE_TABLE = "codewide_sync_v2_active_by_context";
const LEGACY_TABLE = "codewide_sync_v2_projection_generations";
const LEGACY_ACTIVE_TABLE = "codewide_sync_v2_active_generation";

class CommitAbandoned extends Error {}

/** Android crash-atomic V2 publication, partitioned by stable saved-server id. */
export function createNativeSyncV2ProjectionStore(): V2ProjectionStore {
  return createNativeSyncV2ProjectionStoreWithDatabase(getV2SqliteDatabase());
}

/** @testOnly Injects an isolated database into persistence regression tests. */
export function createNativeSyncV2ProjectionStoreWithDatabase(
  database: SqliteDatabase,
): V2ProjectionStore {
  let prepared: Promise<void> | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const publish = (savedServerId: string): void => {
    for (const listener of listeners.get(savedServerId) ?? []) {
      try {
        listener();
      } catch {
        // Durable publication cannot be undone by an observer failure.
      }
    }
  };
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (saved_server_id TEXT NOT NULL, generation_id TEXT NOT NULL, epoch_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(saved_server_id, generation_id))`,
      );
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${ACTIVE_TABLE} (saved_server_id TEXT PRIMARY KEY NOT NULL, generation_id TEXT NOT NULL)`,
      );
      await executor.execute(`DROP TABLE IF EXISTS ${PREVIOUS_ACTIVE_TABLE}`);
      await executor.execute(`DROP TABLE IF EXISTS ${PREVIOUS_TABLE}`);
      await executor.execute(`DROP TABLE IF EXISTS ${UNAPPROVED_CONTEXT_ACTIVE_TABLE}`);
      await executor.execute(`DROP TABLE IF EXISTS ${UNAPPROVED_CONTEXT_TABLE}`);
      await executor.execute(`DROP TABLE IF EXISTS ${LEGACY_ACTIVE_TABLE}`);
      await executor.execute(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
    });
    return prepared;
  };

  const readActive = async (
    executor: SqliteExecutor,
    savedServerId: string,
  ): Promise<V2Projection | null> => {
    const rows = extractRows(
      await executor.execute(
        `SELECT generation.generation_id, generation.payload FROM ${ACTIVE_TABLE} active JOIN ${TABLE} generation ON generation.saved_server_id = active.saved_server_id AND generation.generation_id = active.generation_id WHERE active.saved_server_id = ? LIMIT 1`,
        [savedServerId],
      ),
    );
    const row = rows[0];
    if (row === undefined) return null;
    const projection = parsePersistedProjection(row.payload);
    if (projection !== null) return projection;
    await quarantineProjection(executor, savedServerId, row.generation_id);
    return null;
  };

  const readRetained = async (
    executor: SqliteExecutor,
    savedServerId: string,
  ): Promise<V2Projection | null> => {
    const rows = extractRows(
      await executor.execute(
        `SELECT generation_id, payload FROM ${TABLE} WHERE saved_server_id = ? LIMIT 1`,
        [savedServerId],
      ),
    );
    const row = rows[0];
    if (row === undefined) return null;
    const projection = parsePersistedProjection(row.payload);
    if (projection !== null) return projection;
    await quarantineProjection(executor, savedServerId, row.generation_id);
    return null;
  };

  const replaceActive = async (
    executor: SqliteExecutor,
    savedServerId: string,
    projection: V2Projection,
    signal?: AbortSignal,
  ): Promise<void> => {
    assertNotAborted(signal);
    await executor.execute(
      `INSERT INTO ${TABLE}(saved_server_id, generation_id, epoch_id, payload) VALUES (?, ?, ?, ?) ON CONFLICT(saved_server_id, generation_id) DO UPDATE SET epoch_id = excluded.epoch_id, payload = excluded.payload`,
      [savedServerId, projection.generationId, projection.epochId, JSON.stringify(projection)],
    );
    assertNotAborted(signal);
    await executor.execute(
      `INSERT INTO ${ACTIVE_TABLE}(saved_server_id, generation_id) VALUES (?, ?) ON CONFLICT(saved_server_id) DO UPDATE SET generation_id = excluded.generation_id`,
      [savedServerId, projection.generationId],
    );
    assertNotAborted(signal);
    await executor.execute(
      `DELETE FROM ${TABLE} WHERE saved_server_id = ? AND generation_id != ?`,
      [savedServerId, projection.generationId],
    );
    assertNotAborted(signal);
  };

  return {
    async abandonEpoch(savedServerId, epochId) {
      await prepare();
      await database.transaction(async (executor) => {
        const current = await readActive(executor, savedServerId);
        if (current === null || current.epochId !== epochId) return;
        const retained = retainV2ProjectionOutsideCoverage(current);
        await executor.execute(
          `UPDATE ${TABLE} SET payload = ? WHERE saved_server_id = ? AND generation_id = ?`,
          [JSON.stringify(retained), savedServerId, current.generationId],
        );
        await executor.execute(`DELETE FROM ${ACTIVE_TABLE} WHERE saved_server_id = ?`, [
          savedServerId,
        ]);
      });
      publish(savedServerId);
    },
    async active(savedServerId) {
      await prepare();
      return database.transaction(async (executor) => readActive(executor, savedServerId));
    },
    async applyChange(savedServerId, epochId, watermark: V2U64, change: V2ProjectionChange) {
      await prepare();
      const applied = await database.transaction(async (executor) => {
        const current = await readActive(executor, savedServerId);
        // Returning lets a corrupt row's quarantine commit before the public operation fails.
        // Throwing inside this transaction would roll the quarantine deletion back as well.
        if (current === null) return false;
        if (current.epochId !== epochId)
          throw new Error("Sync V2 change does not belong to the active native generation");
        if (compareV2Watermarks(watermark, current.watermark) <= 0)
          throw new Error("Sync V2 native watermark did not advance");
        await replaceActive(
          executor,
          savedServerId,
          reduceV2Projection(current, watermark, change),
        );
        return true;
      });
      if (!applied)
        throw new Error("Sync V2 change does not belong to the active native generation");
      publish(savedServerId);
    },
    async commitSnapshot(savedServerId, snapshot: V2SnapshotFrame, signal?: AbortSignal) {
      await prepare();
      try {
        const committed = await database.transaction(async (executor) => {
          assertNotAborted(signal);
          const projection = buildV2Projection(
            await readRetained(executor, savedServerId),
            snapshot,
          );
          await replaceActive(executor, savedServerId, projection, signal);
          return projection;
        });
        publish(savedServerId);
        return committed;
      } catch (cause: unknown) {
        if (cause instanceof CommitAbandoned) return null;
        throw cause;
      }
    },
    async deleteSavedServer(savedServerId) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${ACTIVE_TABLE} WHERE saved_server_id = ?`, [
          savedServerId,
        ]);
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [savedServerId]);
      });
      publish(savedServerId);
    },
    async hasSavedServerData(savedServerId) {
      await prepare();
      return database.transaction(async (executor) => {
        return (await readRetained(executor, savedServerId)) !== null;
      });
    },
    async retained(savedServerId) {
      await prepare();
      return database.transaction(async (executor) => readRetained(executor, savedServerId));
    },
    subscribe(savedServerId, listener) {
      let partition = listeners.get(savedServerId);
      if (partition === undefined) {
        partition = new Set();
        listeners.set(savedServerId, partition);
      }
      partition.add(listener);
      return () => {
        partition.delete(listener);
        if (partition.size === 0) listeners.delete(savedServerId);
      };
    },
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new CommitAbandoned();
  }
}

async function quarantineProjection(
  executor: SqliteExecutor,
  savedServerId: string,
  generationId: SqliteValue | undefined,
): Promise<void> {
  await executor.execute(`DELETE FROM ${ACTIVE_TABLE} WHERE saved_server_id = ?`, [savedServerId]);
  if (typeof generationId !== "string") return;
  await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ? AND generation_id = ?`, [
    savedServerId,
    generationId,
  ]);
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) {
    return result as readonly Record<string, SqliteValue>[];
  }
  if (typeof result !== "object" || result === null) {
    return [];
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as readonly Record<string, SqliteValue>[]) : [];
}
