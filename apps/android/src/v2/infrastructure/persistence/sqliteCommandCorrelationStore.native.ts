import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import type {
  CommandCorrelation,
  CommandCorrelationScope,
  CommandCorrelationState,
  CommandCorrelationStore,
} from "../../application/commandCorrelation";
import {
  CommandCorrelationScopeBlockedError,
  isCommandCorrelation,
  isCommandCorrelationScope,
} from "../../application/commandCorrelation";
import { savedServerId } from "../../domain/ids";
import { getV2SqliteDatabase } from "./v2Database.native";

const TABLE = "codewide_v2_command_correlations";
const QUARANTINE_TABLE = "codewide_v2_command_correlation_quarantine";
const BLOCKED = Symbol("blocked-command-correlation-scope");

export function createCommandCorrelationStore(): CommandCorrelationStore {
  return createCommandCorrelationStoreWithDatabase(getV2SqliteDatabase());
}

/** @testOnly Injects an isolated database into persistence regression tests. */
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
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${QUARANTINE_TABLE} (` +
          "scope_key TEXT PRIMARY KEY NOT NULL, saved_server_id TEXT NOT NULL, " +
          "surface TEXT NOT NULL, thread_id TEXT, correlation_id TEXT NOT NULL, " +
          "reason TEXT NOT NULL, quarantined_at_ms INTEGER NOT NULL)",
      );
    });
    await prepared;
  };
  const read = async (
    executor: SqliteExecutor,
    correlationId: string,
    fallbackScope?: CommandCorrelationScope,
  ): Promise<CommandCorrelation | null | typeof BLOCKED> => {
    const rows = extractRows(
      await executor.execute(`SELECT * FROM ${TABLE} WHERE correlation_id = ? LIMIT 1`, [
        correlationId,
      ]),
    );
    const row = rows[0];
    if (row === undefined) return null;
    const parsed = parseRecord(row);
    if (parsed !== null) return parsed;
    const scope = parseScope(row) ?? fallbackScope;
    if (scope !== undefined) await quarantine(executor, row, scope);
    return BLOCKED;
  };
  return {
    async begin(record) {
      if (!isCommandCorrelation(record)) throw new Error("Command correlation is invalid");
      await prepare();
      const claimed = await database.transaction(async (executor) => {
        if (await hasQuarantine(executor, record)) return BLOCKED;
        const existing = await read(executor, record.correlationId, record);
        if (existing === BLOCKED) return BLOCKED;
        if (existing !== null) {
          if (!sameIdentity(existing, record)) {
            throw new Error("Command correlation identity is immutable");
          }
          return existing;
        }
        const candidates = await readScope(executor, record);
        if (candidates === BLOCKED) return BLOCKED;
        const blocking = candidates.filter((candidate) => isBlocking(candidate.state));
        if (blocking.length > 1) {
          await quarantineScope(executor, record, "duplicate_blocking_rows", record.correlationId);
          return BLOCKED;
        }
        const current = blocking[0];
        if (current !== undefined) return current;
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
        return record;
      });
      if (claimed === BLOCKED) throw new CommandCorrelationScopeBlockedError();
      return claimed;
    },
    async deleteSavedServer(id) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [id]);
        await executor.execute(`DELETE FROM ${QUARANTINE_TABLE} WHERE saved_server_id = ?`, [id]);
      });
    },
    async get(correlationId) {
      await prepare();
      const record = await database.transaction(async (executor) => read(executor, correlationId));
      if (record === BLOCKED) throw new CommandCorrelationScopeBlockedError();
      return record;
    },
    async listUnsettled(scope) {
      if (!isCommandCorrelationScope(scope))
        throw new Error("Command correlation scope is invalid");
      await prepare();
      const records = await database.transaction(async (executor) => {
        if (await hasQuarantine(executor, scope)) return BLOCKED;
        const scoped = await readScope(executor, scope);
        if (scoped === BLOCKED) return BLOCKED;
        return scoped.filter((record) => isUnsettled(record.state));
      });
      if (records === BLOCKED) throw new CommandCorrelationScopeBlockedError();
      return records;
    },
    async markDurable(correlationId, updatedAtMs = Date.now()) {
      await update(database, prepare, correlationId, "durable", updatedAtMs, true);
    },
    async release(correlationId, updatedAtMs = Date.now()) {
      await update(database, prepare, correlationId, "durableReleased", updatedAtMs);
    },
    async releaseScope(scope, updatedAtMs = Date.now()) {
      if (!isCommandCorrelationScope(scope))
        throw new Error("Command correlation scope is invalid");
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(
          `UPDATE ${TABLE} SET state = 'durableReleased', updated_at_ms = ? ` +
            "WHERE saved_server_id = ? AND surface = ? " +
            "AND ((thread_id IS NULL AND ? IS NULL) OR thread_id = ?) " +
            "AND state IN ('allocating', 'durable')",
          [updatedAtMs, scope.savedServerId, scope.surface, scope.threadId, scope.threadId],
        );
        await executor.execute(`DELETE FROM ${QUARANTINE_TABLE} WHERE scope_key = ?`, [
          scopeKey(scope),
        ]);
      });
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
  preserveReleased = false,
): Promise<void> {
  await prepare();
  const outcome = await database.transaction(async (executor) => {
    const record = await readCorrelation(executor, correlationId);
    if (record === BLOCKED) return BLOCKED;
    if (record === null) throw new Error("Unknown command correlation");
    if (preserveReleased) {
      await executor.execute(
        `UPDATE ${TABLE} SET state = ?, updated_at_ms = ? ` +
          "WHERE correlation_id = ? AND state != 'durableReleased'",
        [state, updatedAtMs, correlationId],
      );
    } else {
      await executor.execute(
        `UPDATE ${TABLE} SET state = ?, updated_at_ms = ? WHERE correlation_id = ?`,
        [state, updatedAtMs, correlationId],
      );
    }
    return null;
  });
  if (outcome === BLOCKED) throw new CommandCorrelationScopeBlockedError();
}

async function readCorrelation(
  executor: SqliteExecutor,
  correlationId: string,
): Promise<CommandCorrelation | null | typeof BLOCKED> {
  const rows = extractRows(
    await executor.execute(`SELECT * FROM ${TABLE} WHERE correlation_id = ? LIMIT 1`, [
      correlationId,
    ]),
  );
  const row = rows[0];
  if (row === undefined) return null;
  const parsed = parseRecord(row);
  if (parsed !== null) return parsed;
  const scope = parseScope(row);
  if (scope !== null) await quarantine(executor, row, scope);
  return BLOCKED;
}

function parseRecord(row: Record<string, SqliteValue> | undefined): CommandCorrelation | null {
  if (row === undefined) return null;
  const server = row.saved_server_id;
  if (typeof server !== "string") return null;
  try {
    const candidate: unknown = {
      correlationId: row.correlation_id,
      operationId: row.operation_id,
      savedServerId: savedServerId(server),
      surface: row.surface,
      threadId: row.thread_id,
      state: row.state,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
    };
    return isCommandCorrelation(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function readScope(
  executor: SqliteExecutor,
  scope: CommandCorrelationScope,
): Promise<CommandCorrelation[] | typeof BLOCKED> {
  const rows = extractRows(
    await executor.execute(
      `SELECT * FROM ${TABLE} WHERE saved_server_id = ? AND surface = ? ` +
        "AND ((thread_id IS NULL AND ? IS NULL) OR thread_id = ?) ORDER BY created_at_ms ASC",
      [scope.savedServerId, scope.surface, scope.threadId, scope.threadId],
    ),
  );
  const result: CommandCorrelation[] = [];
  for (const row of rows) {
    const record = parseRecord(row);
    if (record !== null) {
      result.push(record);
      continue;
    }
    await quarantine(executor, row, scope);
    return BLOCKED;
  }
  return result;
}

async function hasQuarantine(
  executor: SqliteExecutor,
  scope: CommandCorrelationScope,
): Promise<boolean> {
  const rows = extractRows(
    await executor.execute(
      `SELECT 1 AS present FROM ${QUARANTINE_TABLE} WHERE scope_key = ? LIMIT 1`,
      [scopeKey(scope)],
    ),
  );
  return rows.length > 0;
}

async function quarantine(
  executor: SqliteExecutor,
  row: Record<string, SqliteValue>,
  scope: CommandCorrelationScope,
): Promise<void> {
  const correlationId =
    typeof row.correlation_id === "string" ? row.correlation_id : "invalid-correlation";
  await quarantineScope(executor, scope, "invalid_record", correlationId);
  if (typeof row.correlation_id === "string") {
    await executor.execute(`DELETE FROM ${TABLE} WHERE correlation_id = ?`, [row.correlation_id]);
  }
}

async function quarantineScope(
  executor: SqliteExecutor,
  scope: CommandCorrelationScope,
  reason: "duplicate_blocking_rows" | "invalid_record",
  correlationId: string,
): Promise<void> {
  await executor.execute(
    `INSERT INTO ${QUARANTINE_TABLE}(` +
      "scope_key, saved_server_id, surface, thread_id, correlation_id, reason, quarantined_at_ms) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_key) DO UPDATE SET " +
      "correlation_id = excluded.correlation_id, reason = excluded.reason, " +
      "quarantined_at_ms = excluded.quarantined_at_ms",
    [
      scopeKey(scope),
      scope.savedServerId,
      scope.surface,
      scope.threadId,
      correlationId,
      reason,
      Date.now(),
    ],
  );
}

function parseScope(row: Record<string, SqliteValue>): CommandCorrelationScope | null {
  const server = row.saved_server_id;
  if (typeof server !== "string") return null;
  try {
    const candidate: unknown = {
      savedServerId: savedServerId(server),
      surface: row.surface,
      threadId: row.thread_id,
    };
    return isCommandCorrelationScope(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function scopeKey(scope: CommandCorrelationScope): string {
  return `${JSON.stringify(scope.savedServerId)}:${JSON.stringify(scope.surface)}:${JSON.stringify(scope.threadId)}`;
}

function isUnsettled(state: CommandCorrelationState): boolean {
  return state === "allocating" || state === "durable" || state === "durableReleased";
}

function isBlocking(state: CommandCorrelationState): boolean {
  return state === "allocating" || state === "durable";
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
