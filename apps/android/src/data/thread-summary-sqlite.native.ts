import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import { appLogger } from "../observability/logger";
import { threadSummaryKey } from "./thread-summary-projection";
import type { ThreadSummaryViewRequest, LoadedThreadSummaryView } from "./thread-summary-model";
import { normalizeStoredThreadSummary, type StoredThreadSummary } from "./thread-summary-types";
import { sqliteRows } from "./sqliteResult";
import { unknownRecord } from "./unknownRecord";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

const TABLE = "codewide_thread_summaries";
const META_TABLE = "__tanstack_db_sqlite_meta";
const RUNTIME_ID = "thread-summaries-v2";
const SCHEMA_VERSION = 5;
const CHECKPOINT_DELAY_MS = 250;
const CHECKPOINT_ATTEMPTS = 3;

export type ThreadSummaryChange =
  | { type: "insert" | "update"; value: StoredThreadSummary }
  | { key: string; type: "delete" };

type PendingCheckpoint = {
  changes: Map<string, ThreadSummaryChange>;
  waiters: Array<{ reject: (cause: unknown) => void; resolve: () => void }>;
};

export type ThreadSummarySqlite = {
  begin: () => void;
  close: () => Promise<void>;
  commit: (options?: { durable?: boolean }) => Promise<void>;
  flush: () => Promise<void>;
  loadAll: () => Promise<StoredThreadSummary[]>;
  loadConnectionRows: (connectionId: string) => Promise<StoredThreadSummary[]>;
  loadRow: (connectionId: string, threadId: string) => Promise<StoredThreadSummary | null>;
  loadRows: (connectionId: string, threadIds: readonly string[]) => Promise<StoredThreadSummary[]>;
  loadUnread: () => Promise<StoredThreadSummary[]>;
  loadView: (request: ThreadSummaryViewRequest) => Promise<LoadedThreadSummaryView>;
  prepare: () => Promise<void>;
  write: (change: ThreadSummaryChange) => void;
};

/** Thread-list-specific SQLite boundary. Legend owns the resident list; this
 * adapter only persists summary mutations and atomically reads the requested
 * root/subagent ranges. */
export function createThreadSummarySqlite(): ThreadSummarySqlite {
  const database = getUiCacheSqliteDatabase();
  let prepared: Promise<void> | null = null;
  let currentChanges: Map<string, ThreadSummaryChange> | null = null;
  let pending: PendingCheckpoint | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let checkpointTail = Promise.resolve();
  let latestCheckpoint = Promise.resolve();
  let closed = false;

  const ensurePrepared = async (): Promise<void> => {
    if (prepared === null) {
      const attempt = prepareSchema(database).catch((error: unknown) => {
        if (prepared === attempt) {
          prepared = null;
        }
        throw error;
      });
      prepared = attempt;
    }
    return prepared;
  };

  const scheduleCheckpoint = (): void => {
    if (checkpointTimer !== null) {
      return;
    }
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null;
      void flushPending().catch((error: unknown) => {
        appLogger.warnCaught({ error: error, event: "thread_summary.sqlite_checkpoint.failed" });
      });
    }, CHECKPOINT_DELAY_MS);
  };

  const enqueueCheckpoint = async (changes: Map<string, ThreadSummaryChange>): Promise<void> => {
    pending ??= { changes: new Map(), waiters: [] };
    for (const [key, change] of changes) {
      pending.changes.set(key, change);
    }
    const checkpoint = new Promise<void>((resolve, reject) => {
      pending?.waiters.push({ reject, resolve });
    });
    scheduleCheckpoint();
    return checkpoint;
  };

  const flushPending = async (): Promise<void> => {
    if (checkpointTimer !== null) {
      clearTimeout(checkpointTimer);
    }
    checkpointTimer = null;
    const checkpoint = pending;
    pending = null;
    if (checkpoint === null) {
      return latestCheckpoint;
    }
    const operation = checkpointTail.then(async () => {
      await ensurePrepared();
      let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          await database.transaction(async (executor) => {
            for (const change of checkpoint.changes.values()) {
              await persistChange(executor, change);
            }
          });
          return;
        } catch (error) {
          if (attempt >= CHECKPOINT_ATTEMPTS) {
            throw error;
          }
          await delay(25 * attempt);
        }
      }
    });
    latestCheckpoint = operation;
    checkpointTail = operation.catch(() => undefined);
    void operation.then(
      () => {
        checkpoint.waiters.forEach(({ resolve }) => {
          resolve();
        });
      },
      (error: unknown) => {
        pending ??= { changes: new Map(), waiters: [] };
        for (const [key, change] of checkpoint.changes) {
          if (!pending.changes.has(key)) {
            pending.changes.set(key, change);
          }
        }
        checkpoint.waiters.forEach(({ reject }) => {
          reject(error);
        });
        scheduleCheckpoint();
      },
    );
    return operation;
  };

  const read = async <T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> => {
    if (closed) {
      throw new Error("Thread summary SQLite adapter is closed");
    }
    await ensurePrepared();
    await flushPending();
    return database.transaction(operation);
  };

  const readRows = async (
    sql: string,
    params: readonly SqliteValue[] = [],
  ): Promise<StoredThreadSummary[]> => read(async (executor) => executeRows(executor, sql, params));

  return {
    begin() {
      if (currentChanges !== null) {
        throw new Error("Thread summary SQLite transaction is already open");
      }
      currentChanges = new Map();
    },
    async close() {
      if (closed) {
        return;
      }
      await flushPending();
      closed = true;
    },
    async commit(options = {}) {
      const changes = currentChanges;
      if (changes === null) {
        throw new Error("Thread summary SQLite transaction is not open");
      }
      currentChanges = null;
      if (changes.size === 0) {
        return options.durable === true ? flushPending() : Promise.resolve();
      }
      const checkpoint = enqueueCheckpoint(changes);
      if (options.durable === true) {
        flushPending().catch(() => undefined);
      }
      return checkpoint;
    },
    flush: flushPending,
    async loadAll() {
      return readRows(`SELECT __payload FROM ${TABLE}`);
    },
    async loadConnectionRows(connectionId) {
      return readRows(`SELECT __payload FROM ${TABLE} WHERE connection_id = ?`, [connectionId]);
    },
    async loadRow(connectionId, threadId) {
      return (
        (
          await readRows(
            `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND thread_id = ? LIMIT 1`,
            [connectionId, threadId],
          )
        )[0] ?? null
      );
    },
    async loadRows(connectionId, threadIds) {
      if (threadIds.length === 0) {
        return [];
      }
      return readRows(
        `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND thread_id IN (${threadIds.map(() => "?").join(", ")})`,
        [connectionId, ...threadIds],
      );
    },
    async loadUnread() {
      return readRows(
        `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 0 AND json_extract(__payload, '$.unread') > 0`,
      );
    },
    async loadView(request) {
      return read(async (executor) => {
        const connectionClause =
          (request.connectionId === null ? "" : " AND connection_id = ?") +
          (request.projectCwd === undefined ? "" : " AND json_extract(__payload, '$.cwd') = ?");
        const connectionParams: SqliteValue[] =
          request.connectionId === null ? [] : [request.connectionId];
        if (request.projectCwd !== undefined) {
          connectionParams.push(request.projectCwd);
        }
        const [pinned, recent, archived] = await Promise.all([
          executeRows(
            executor,
            `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 0 AND pinned = 1${connectionClause} ORDER BY recency_at DESC NULLS LAST, __key ASC`,
            connectionParams,
          ),
          executeRows(
            executor,
            `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 0 AND pinned = 0${connectionClause} ORDER BY recency_at DESC NULLS LAST, __key ASC LIMIT ?`,
            [...connectionParams, request.recentLimit],
          ),
          executeRows(
            executor,
            `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 1${connectionClause} ORDER BY pinned DESC, recency_at DESC NULLS LAST, __key ASC LIMIT ?`,
            [...connectionParams, request.archivedLimit],
          ),
        ]);
        const selected =
          request.selectedConnectionId === null || request.selectedThreadId === null
            ? []
            : await executeRows(
                executor,
                `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND thread_id = ? LIMIT 1`,
                [request.selectedConnectionId, request.selectedThreadId],
              );
        const subagents =
          request.subagentConnectionId === null
            ? []
            : await executeRows(
                executor,
                `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND parent_thread_id IS NOT NULL AND delete_command_id IS NULL ORDER BY recency_at DESC NULLS LAST, __key ASC LIMIT ?`,
                [request.subagentConnectionId, request.subagentLimit],
              );
        return { archived, pinned, recent, selected, subagents };
      });
    },
    prepare: ensurePrepared,
    write(change) {
      if (currentChanges === null) {
        throw new Error("Thread summary SQLite transaction is not open");
      }
      const key =
        change.type === "delete"
          ? change.key
          : threadSummaryKey(change.value.connectionId, change.value.remoteThreadId);
      currentChanges.set(key, change);
    },
  };
}

async function prepareSchema(database: ReturnType<typeof getUiCacheSqliteDatabase>): Promise<void> {
  await database.transaction(async (executor) => {
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS ${META_TABLE} (runtime_id TEXT PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL)`,
    );
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
        `__key TEXT PRIMARY KEY NOT NULL, __payload TEXT NOT NULL, connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, ` +
        `recency_at REAL, pinned INTEGER NOT NULL, archived INTEGER NOT NULL, parent_thread_id TEXT, delete_command_id TEXT)`,
    );
    await executor.execute(
      `CREATE INDEX IF NOT EXISTS ${TABLE}__idx_1 ON ${TABLE} (connection_id, thread_id)`,
    );
    await executor.execute(
      `CREATE INDEX IF NOT EXISTS ${TABLE}__idx_2 ON ${TABLE} (delete_command_id)`,
    );
    const rootPredicate = "WHERE parent_thread_id IS NULL AND delete_command_id IS NULL";
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_root_connection_v6 ON ${TABLE}
      (connection_id, archived, pinned DESC, recency_at DESC, __key ASC) ${rootPredicate}`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_root_global_v6 ON ${TABLE}
      (archived, pinned DESC, recency_at DESC, __key ASC) ${rootPredicate}`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_subagents_v6 ON ${TABLE}
      (connection_id, recency_at DESC, __key ASC) WHERE parent_thread_id IS NOT NULL AND delete_command_id IS NULL`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_project_v6 ON ${TABLE}
      (connection_id, json_extract(__payload, '$.cwd'), archived, pinned DESC, recency_at DESC, __key ASC) ${rootPredicate}`);
    // Replace superseded access paths only after their complete-order indexes exist.
    for (const suffix of ["0", "root_connection", "root_global", "subagents", "project"]) {
      await executor.execute(`DROP INDEX IF EXISTS ${TABLE}__idx_${suffix}`);
    }
    // v4 and v5 have the same physical schema. The version marks projection
    // semantics, not disposable user-visible contents, so upgrading must keep
    // the locally available thread catalog until the repaired snapshot lands.
    await executor.execute(
      `INSERT INTO ${META_TABLE} (runtime_id, schema_version) VALUES (?, ?) ON CONFLICT(runtime_id) DO UPDATE SET schema_version = excluded.schema_version`,
      [RUNTIME_ID, SCHEMA_VERSION],
    );
  });
}

async function persistChange(executor: SqliteExecutor, change: ThreadSummaryChange): Promise<void> {
  if (change.type === "delete") {
    await executor.execute(`DELETE FROM ${TABLE} WHERE __key = ?`, [`string:${change.key}`]);
    return;
  }
  const row = normalizeStoredThreadSummary(change.value);
  await executor.execute(
    `INSERT INTO ${TABLE} (__key, __payload, connection_id, thread_id, recency_at, pinned, archived, parent_thread_id, delete_command_id) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(__key) DO UPDATE SET ` +
      `__payload = excluded.__payload, connection_id = excluded.connection_id, thread_id = excluded.thread_id, recency_at = excluded.recency_at, ` +
      `pinned = excluded.pinned, archived = excluded.archived, parent_thread_id = excluded.parent_thread_id, delete_command_id = excluded.delete_command_id`,
    [
      `string:${threadSummaryKey(row.connectionId, row.remoteThreadId)}`,
      JSON.stringify(row),
      row.connectionId,
      row.remoteThreadId,
      row.recencyAt,
      row.pinned ? 1 : 0,
      row.archived ? 1 : 0,
      row.parentThreadId,
      row.deleteCommandId,
    ],
  );
}

async function executeRows(
  executor: SqliteExecutor,
  sql: string,
  params: readonly SqliteValue[] = [],
): Promise<StoredThreadSummary[]> {
  // WHY: This boundary validates and constructs one complete persisted or native payload atomically; its field precedence must remain in one owner.
  // oxlint-disable-next-line eslint/complexity
  return extractRows(await executor.execute(sql, params)).flatMap((row) => {
    if (typeof row.__payload !== "string") {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(row.__payload);
      const record = unknownRecord(parsed);
      if (
        record === null ||
        typeof record.connectionId !== "string" ||
        typeof record.remoteThreadId !== "string" ||
        typeof record.archived !== "boolean" ||
        typeof record.pinned !== "boolean" ||
        typeof record.updatedAt !== "number"
      ) {
        return [];
      }
      // WHY: the remaining fields are protocol-backed values written by this cache owner. The
      // durable envelope is validated above, and normalizeStoredThreadSummary repairs its versioned
      // status contract without duplicating the generated protocol schema.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return [normalizeStoredThreadSummary(record as StoredThreadSummary)];
    } catch {
      return [];
    }
  });
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  return sqliteRows(result);
}

async function delay(durationMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
