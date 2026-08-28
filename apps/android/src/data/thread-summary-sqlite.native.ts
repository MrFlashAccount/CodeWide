import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import { threadSummaryKey } from "./thread-summary-projection";
import type { ThreadSummaryViewRequest, LoadedThreadSummaryView } from "./thread-summary-model";
import { normalizeStoredThreadSummary, type StoredThreadSummary } from "./thread-summary-types";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

const TABLE = "codewide_thread_summaries";
const META_TABLE = "__tanstack_db_sqlite_meta";
const RUNTIME_ID = "thread-summaries-v2";
const SCHEMA_VERSION = 5;
const CHECKPOINT_DELAY_MS = 250;
const CHECKPOINT_ATTEMPTS = 3;

export type ThreadSummaryChange =
  | { type: "insert" | "update"; value: StoredThreadSummary }
  | { type: "delete"; key: string };

type PendingCheckpoint = {
  changes: Map<string, ThreadSummaryChange>;
  waiters: Array<{ resolve(): void; reject(cause: unknown): void }>;
};

export type ThreadSummarySqlite = {
  prepare(): Promise<void>;
  begin(): void;
  write(change: ThreadSummaryChange): void;
  commit(options?: { durable?: boolean }): Promise<void>;
  loadView(request: ThreadSummaryViewRequest): Promise<LoadedThreadSummaryView>;
  loadRow(connectionId: string, threadId: string): Promise<StoredThreadSummary | null>;
  loadRows(connectionId: string, threadIds: readonly string[]): Promise<StoredThreadSummary[]>;
  loadConnectionRows(connectionId: string): Promise<StoredThreadSummary[]>;
  loadAll(): Promise<StoredThreadSummary[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
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

  const ensurePrepared = (): Promise<void> => {
    if (prepared === null) {
      let attempt!: Promise<void>;
      attempt = prepareSchema(database).catch((cause) => {
        if (prepared === attempt) prepared = null;
        throw cause;
      });
      prepared = attempt;
    }
    return prepared;
  };

  const scheduleCheckpoint = (): void => {
    if (checkpointTimer !== null) return;
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null;
      void flushPending().catch((cause: unknown) => console.warn("Thread summary SQLite checkpoint failed", cause));
    }, CHECKPOINT_DELAY_MS);
  };

  const enqueueCheckpoint = (changes: Map<string, ThreadSummaryChange>): Promise<void> => {
    pending ??= { changes: new Map(), waiters: [] };
    for (const [key, change] of changes) pending.changes.set(key, change);
    const checkpoint = new Promise<void>((resolve, reject) => pending?.waiters.push({ resolve, reject }));
    scheduleCheckpoint();
    return checkpoint;
  };

  const flushPending = (): Promise<void> => {
    if (checkpointTimer !== null) clearTimeout(checkpointTimer);
    checkpointTimer = null;
    const checkpoint = pending;
    pending = null;
    if (checkpoint === null) return latestCheckpoint;
    const operation = checkpointTail.then(async () => {
      await ensurePrepared();
      let attempt = 0;
      while (true) {
        attempt += 1;
        try {
          await database.transaction(async (executor) => {
            for (const change of checkpoint.changes.values()) await persistChange(executor, change);
          });
          return;
        } catch (cause) {
          if (attempt >= CHECKPOINT_ATTEMPTS) throw cause;
          await delay(25 * attempt);
        }
      }
    });
    latestCheckpoint = operation;
    checkpointTail = operation.catch(() => undefined);
    void operation.then(
      () => checkpoint.waiters.forEach(({ resolve }) => resolve()),
      (cause) => {
        pending ??= { changes: new Map(), waiters: [] };
        for (const [key, change] of checkpoint.changes) if (!pending.changes.has(key)) pending.changes.set(key, change);
        checkpoint.waiters.forEach(({ reject }) => reject(cause));
        scheduleCheckpoint();
      },
    );
    return operation;
  };

  const read = async <T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> => {
    if (closed) throw new Error("Thread summary SQLite adapter is closed");
    await ensurePrepared();
    await flushPending();
    return await database.transaction(operation);
  };

  const readRows = async (sql: string, params: readonly SqliteValue[] = []): Promise<StoredThreadSummary[]> => await read(
    async (executor) => await executeRows(executor, sql, params),
  );

  return {
    prepare: ensurePrepared,
    begin() {
      if (currentChanges !== null) throw new Error("Thread summary SQLite transaction is already open");
      currentChanges = new Map();
    },
    write(change) {
      if (currentChanges === null) throw new Error("Thread summary SQLite transaction is not open");
      const key = change.type === "delete" ? change.key : threadSummaryKey(change.value.connectionId, change.value.remoteThreadId);
      currentChanges.set(key, change);
    },
    commit(options = {}) {
      const changes = currentChanges;
      if (changes === null) throw new Error("Thread summary SQLite transaction is not open");
      currentChanges = null;
      if (changes.size === 0) return options.durable === true ? flushPending() : Promise.resolve();
      const checkpoint = enqueueCheckpoint(changes);
      if (options.durable === true) void flushPending();
      return checkpoint;
    },
    async loadView(request) {
      return await read(async (executor) => {
        const connectionClause = request.connectionId === null ? "" : " AND connection_id = ?";
        const connectionParams: SqliteValue[] = request.connectionId === null ? [] : [request.connectionId];
        const pinned = await executeRows(
          executor,
          `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 0 AND pinned = 1${connectionClause} ORDER BY recency_at DESC NULLS LAST, __key ASC`,
          connectionParams,
        );
        const recent = await executeRows(
          executor,
          `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 0 AND pinned = 0${connectionClause} ORDER BY recency_at DESC NULLS LAST, __key ASC LIMIT ?`,
          [...connectionParams, request.recentLimit],
        );
        const archived = await executeRows(
          executor,
          `SELECT __payload FROM ${TABLE} WHERE parent_thread_id IS NULL AND delete_command_id IS NULL AND archived = 1${connectionClause} ORDER BY pinned DESC, recency_at DESC NULLS LAST, __key ASC LIMIT ?`,
          [...connectionParams, request.archivedLimit],
        );
        const selected = request.selectedConnectionId === null || request.selectedThreadId === null ? [] : await executeRows(
          executor,
          `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND thread_id = ? LIMIT 1`,
          [request.selectedConnectionId, request.selectedThreadId],
        );
        const subagents = request.subagentConnectionId === null ? [] : await executeRows(
          executor,
          `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND parent_thread_id IS NOT NULL AND delete_command_id IS NULL ORDER BY recency_at DESC NULLS LAST, __key ASC LIMIT ?`,
          [request.subagentConnectionId, request.subagentLimit],
        );
        return { pinned, recent, archived, selected, subagents };
      });
    },
    async loadRow(connectionId, threadId) {
      return (await readRows(
        `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND thread_id = ? LIMIT 1`,
        [connectionId, threadId],
      ))[0] ?? null;
    },
    async loadRows(connectionId, threadIds) {
      if (threadIds.length === 0) return [];
      return await readRows(
        `SELECT __payload FROM ${TABLE} WHERE connection_id = ? AND thread_id IN (${threadIds.map(() => "?").join(", ")})`,
        [connectionId, ...threadIds],
      );
    },
    async loadConnectionRows(connectionId) {
      return await readRows(`SELECT __payload FROM ${TABLE} WHERE connection_id = ?`, [connectionId]);
    },
    async loadAll() {
      return await readRows(`SELECT __payload FROM ${TABLE}`);
    },
    flush: flushPending,
    async close() {
      if (closed) return;
      await flushPending();
      closed = true;
    },
  };
}

async function prepareSchema(database: ReturnType<typeof getUiCacheSqliteDatabase>): Promise<void> {
  await database.transaction(async (executor) => {
    await executor.execute(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (runtime_id TEXT PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL)`);
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (`
      + `__key TEXT PRIMARY KEY NOT NULL, __payload TEXT NOT NULL, connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, `
      + `recency_at REAL, pinned INTEGER NOT NULL, archived INTEGER NOT NULL, parent_thread_id TEXT, delete_command_id TEXT)`,
    );
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_0 ON ${TABLE} (connection_id, pinned, archived, recency_at)`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_1 ON ${TABLE} (connection_id, thread_id)`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_2 ON ${TABLE} (delete_command_id)`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_root_connection ON ${TABLE} (connection_id, parent_thread_id, delete_command_id, archived, pinned, recency_at)`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_root_global ON ${TABLE} (parent_thread_id, delete_command_id, archived, pinned, recency_at)`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${TABLE}__idx_subagents ON ${TABLE} (connection_id, parent_thread_id, delete_command_id, recency_at)`);
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
    `INSERT INTO ${TABLE} (__key, __payload, connection_id, thread_id, recency_at, pinned, archived, parent_thread_id, delete_command_id) `
    + `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(__key) DO UPDATE SET `
    + `__payload = excluded.__payload, connection_id = excluded.connection_id, thread_id = excluded.thread_id, recency_at = excluded.recency_at, `
    + `pinned = excluded.pinned, archived = excluded.archived, parent_thread_id = excluded.parent_thread_id, delete_command_id = excluded.delete_command_id`,
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

async function executeRows(executor: SqliteExecutor, sql: string, params: readonly SqliteValue[] = []): Promise<StoredThreadSummary[]> {
  return extractRows(await executor.execute(sql, params)).flatMap((row) => {
    if (typeof row.__payload !== "string") return [];
    try {
      return [normalizeStoredThreadSummary(JSON.parse(row.__payload) as StoredThreadSummary)];
    } catch {
      return [];
    }
  });
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) return result as readonly Record<string, SqliteValue>[];
  if (typeof result !== "object" || result === null) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as readonly Record<string, SqliteValue>[] : [];
}

function delay(durationMs: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}
