import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import type {
  CommandCorrelation,
  CommandCorrelationState,
  CommandCorrelationStore,
} from "../../application/commandCorrelation";
import { savedServerId } from "../../domain/ids";
import { getV2SqliteDatabase } from "./v2Database.native";

const TABLE = "codewide_v2_command_correlations";

export function createCommandCorrelationStore(): CommandCorrelationStore {
  return createCommandCorrelationStoreWithDatabase(getV2SqliteDatabase());
}

export function createCommandCorrelationStoreWithDatabase(
  database: SqliteDatabase,
): CommandCorrelationStore {
  let prepared: Promise<void> | null = null;
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
          "correlation_id TEXT PRIMARY KEY NOT NULL, operation_id TEXT NOT NULL, " +
          "saved_server_id TEXT NOT NULL, surface TEXT NOT NULL, thread_id TEXT, " +
          "state TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)",
      );
      await executor.execute(
        `CREATE INDEX IF NOT EXISTS ${TABLE}_scope ON ${TABLE}` +
          "(saved_server_id, surface, thread_id, state)",
      );
    });
    await prepared;
  };
  const read = async (
    executor: SqliteExecutor,
    correlationId: string,
  ): Promise<CommandCorrelation | null> => {
    const rows = extractRows(
      await executor.execute(`SELECT * FROM ${TABLE} WHERE correlation_id = ? LIMIT 1`, [
        correlationId,
      ]),
    );
    return parseRecord(rows[0]);
  };
  return {
    async begin(record) {
      await prepare();
      await database.transaction(async (executor) => {
        const existing = await read(executor, record.correlationId);
        if (existing !== null) {
          if (!sameIdentity(existing, record)) {
            throw new Error("Command correlation identity is immutable");
          }
          return;
        }
        await executor.execute(
          `INSERT INTO ${TABLE}(` +
            "correlation_id, operation_id, saved_server_id, surface, thread_id, state, " +
            "created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            record.correlationId,
            record.operationId,
            record.savedServerId,
            record.surface,
            record.threadId,
            record.state,
            record.createdAtMs,
            record.updatedAtMs,
          ],
        );
      });
    },
    async deleteSavedServer(id) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [id]);
      });
    },
    async get(correlationId) {
      await prepare();
      return database.transaction(async (executor) => read(executor, correlationId));
    },
    async listUnsettled(scope) {
      await prepare();
      return database.transaction(async (executor) => {
        const rows = extractRows(
          await executor.execute(
            `SELECT * FROM ${TABLE} WHERE saved_server_id = ? AND surface = ? ` +
              "AND ((thread_id IS NULL AND ? IS NULL) OR thread_id = ?) " +
              "AND state IN ('allocating', 'durable') ORDER BY created_at_ms ASC",
            [scope.savedServerId, scope.surface, scope.threadId, scope.threadId],
          ),
        );
        return rows
          .map(parseRecord)
          .filter((record): record is CommandCorrelation => record !== null);
      });
    },
    async markDurable(correlationId, updatedAtMs = Date.now()) {
      await update(database, prepare, correlationId, "durable", updatedAtMs);
    },
    async settle(correlationId, state, updatedAtMs = Date.now()) {
      await update(database, prepare, correlationId, state, updatedAtMs);
    },
  };
}

async function update(
  database: SqliteDatabase,
  prepare: () => Promise<void>,
  correlationId: string,
  state: CommandCorrelationState,
  updatedAtMs: number,
): Promise<void> {
  await prepare();
  await database.transaction(async (executor) => {
    if (!(await readPresent(executor, correlationId))) {
      throw new Error("Unknown command correlation");
    }
    await executor.execute(
      `UPDATE ${TABLE} SET state = ?, updated_at_ms = ? WHERE correlation_id = ?`,
      [state, updatedAtMs, correlationId],
    );
  });
}

async function readPresent(executor: SqliteExecutor, correlationId: string): Promise<boolean> {
  return (
    extractRows(
      await executor.execute(`SELECT 1 AS present FROM ${TABLE} WHERE correlation_id = ? LIMIT 1`, [
        correlationId,
      ]),
    ).length > 0
  );
}

function parseRecord(row: Record<string, SqliteValue> | undefined): CommandCorrelation | null {
  if (row === undefined) return null;
  const correlationId = row.correlation_id;
  const operationId = row.operation_id;
  const server = row.saved_server_id;
  const surface = row.surface;
  const threadId = row.thread_id;
  const state = row.state;
  const createdAtMs = row.created_at_ms;
  const updatedAtMs = row.updated_at_ms;
  if (
    typeof correlationId !== "string" ||
    typeof operationId !== "string" ||
    typeof server !== "string" ||
    (surface !== "newThread" && surface !== "threadComposer") ||
    (threadId !== null && typeof threadId !== "string") ||
    !isState(state) ||
    typeof createdAtMs !== "number" ||
    typeof updatedAtMs !== "number"
  )
    return null;
  return {
    correlationId,
    operationId,
    savedServerId: savedServerId(server),
    surface,
    threadId,
    state,
    createdAtMs,
    updatedAtMs,
  };
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) return result as readonly Record<string, SqliteValue>[];
  if (typeof result !== "object" || result === null) return [];
  const rows = Reflect.get(result, "rows");
  return Array.isArray(rows) ? (rows as readonly Record<string, SqliteValue>[]) : [];
}

function sameIdentity(left: CommandCorrelation, right: CommandCorrelation): boolean {
  return (
    left.operationId === right.operationId &&
    left.savedServerId === right.savedServerId &&
    left.surface === right.surface &&
    left.threadId === right.threadId
  );
}

function isState(value: SqliteValue | undefined): value is CommandCorrelationState {
  return (
    typeof value === "string" &&
    ["allocating", "durable", "completed", "failed", "indeterminate", "notCreated"].includes(value)
  );
}
