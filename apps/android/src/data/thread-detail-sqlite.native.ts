import type { ThreadDetailRow } from "./thread-detail-projection";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { incrementMetric, recordSqliteSubsetLoad, recordTiming } from "./operational-metrics";
import { readLegacyPersistedRows } from "./legacy-persistence-migration.native";

const TABLE = "codewide_thread_details";
const META_TABLE = "__tanstack_db_sqlite_meta";
const BOOTSTRAP_TABLE = "__tanstack_db_sqlite_bootstrap";
const RUNTIME_ID = "thread-details-v2";
const LEGACY_BOOTSTRAP_ID = `tanstack-persistence:${RUNTIME_ID}:v1`;
const SCHEMA_VERSION = 1;
const CHECKPOINT_DELAY_MS = 250;
const CHECKPOINT_ATTEMPTS = 3;

type SqliteValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView;
type Executor = { execute(sql: string, params?: readonly SqliteValue[]): Promise<unknown> };

export type ThreadDetailChange =
  | { type: "insert" | "update"; value: ThreadDetailRow }
  | { type: "delete"; key: string };

export type ThreadDetailSqliteControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change: ThreadDetailChange): void;
  commit(options?: { durable?: boolean }): Promise<void>;
};

export type ThreadDetailWindowQuery = {
  connectionId: string;
  threadId: string;
  historyEpoch: number;
  maxOrdinal: number | null;
  turnLimit: number;
};

export type ThreadDetailWindowRows = {
  turnRows: ThreadDetailRow[];
  detailRows: ThreadDetailRow[];
  liveRows: ThreadDetailRow[];
};

export type ResolvedThreadDetailWindow = ThreadDetailWindowRows & {
  historyEpoch: number;
  latestSealedOrdinal: number | null;
  earliestSealedOrdinal: number | null;
  requestedMaxOrdinal: number | null;
};

type PendingCheckpoint = {
  changes: Map<string, ThreadDetailChange>;
  transactions: number;
  waiters: Array<{ resolve(): void; reject(cause: unknown): void }>;
};

export type ThreadDetailSqlite = ThreadDetailSqliteControls & {
  prepare(): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  loadThreadMeta(connectionId: string, threadId: string): Promise<ThreadDetailRow | null>;
  loadTurn(connectionId: string, threadId: string, turnId: string, historyEpoch: number): Promise<ThreadDetailRow | null>;
  loadBoundary(connectionId: string, threadId: string, historyEpoch: number, direction: "asc" | "desc"): Promise<ThreadDetailRow | null>;
  loadWindow(query: ThreadDetailWindowQuery): Promise<ThreadDetailWindowRows>;
  loadResolvedWindow(input: {
    connectionId: string;
    threadId: string;
    anchorTurnId: string | null;
    residentHistoryEpoch: number | null;
    residentMaxOrdinal: number | null | undefined;
    residentTurnLimit: number;
    restoreNewerBuffer: number;
  }): Promise<ResolvedThreadDetailWindow>;
  loadAuthoritativeFacts(connectionId: string, threadId: string, incomingTurnIds: readonly string[]): Promise<ThreadDetailRow[]>;
  loadPrependFacts(connectionId: string, threadId: string, historyEpoch: number, turnIds: readonly string[]): Promise<ThreadDetailRow[]>;
};

/**
 * Chat-specific SQLite adapter. It deliberately exposes semantic keyset reads
 * instead of a generic query language: the chat model asks for one range and
 * receives turns, overlays, and the mutable head from a single transaction.
 */
export function createThreadDetailSqlite(onCommit: (changes: readonly ThreadDetailChange[]) => void): ThreadDetailSqlite {
  const database = getUiCacheSqliteDatabase();
  let currentChanges: Map<string, ThreadDetailChange> | null = null;
  let pending: PendingCheckpoint | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let checkpointTail = Promise.resolve();
  let latestCheckpoint = Promise.resolve();
  let prepared: Promise<void> | null = null;
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
      void flushPending().catch((cause: unknown) => console.warn("Thread detail SQLite checkpoint failed", cause));
    }, CHECKPOINT_DELAY_MS);
  };

  const enqueueCheckpoint = (changes: Map<string, ThreadDetailChange>, waitForDurability: boolean): Promise<void> => {
    pending ??= { changes: new Map(), transactions: 0, waiters: [] };
    for (const [key, change] of changes) pending.changes.set(key, change);
    pending.transactions += 1;
    const checkpoint = waitForDurability
      ? new Promise<void>((resolve, reject) => pending?.waiters.push({ resolve, reject }))
      : Promise.resolve();
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
      const startedAt = performance.now();
      let attempts = 0;
      while (true) {
        attempts += 1;
        try {
          await database.transaction(async (executor) => {
            for (const change of checkpoint.changes.values()) await persistChange(executor, change);
          });
          break;
        } catch (cause) {
          if (attempts >= CHECKPOINT_ATTEMPTS) throw cause;
          await delay(25 * attempts);
        }
      }
      recordTiming("sqlite_checkpoint_ms", performance.now() - startedAt);
      incrementMetric("sqlite_checkpoints");
      if (checkpoint.transactions > 1) incrementMetric("sqlite_transactions_coalesced", checkpoint.transactions - 1);
    });
    latestCheckpoint = operation;
    checkpointTail = operation.catch(() => undefined);
    void operation.then(
      () => checkpoint.waiters.forEach(({ resolve }) => resolve()),
      (cause) => {
        pending ??= { changes: new Map(), transactions: 0, waiters: [] };
        for (const [key, change] of checkpoint.changes) {
          if (!pending.changes.has(key)) pending.changes.set(key, change);
        }
        pending.transactions += checkpoint.transactions;
        checkpoint.waiters.forEach(({ reject }) => reject(cause));
        scheduleCheckpoint();
      },
    );
    return operation;
  };

  const query = async (sql: string, params: readonly SqliteValue[]): Promise<ThreadDetailRow[]> => {
    if (closed) throw new Error("Thread detail SQLite adapter is closed");
    await ensurePrepared();
    await flushPending();
    const startedAt = performance.now();
    const result = await database.execute(sql, params);
    const rows = extractRows(result).map(parsePayload);
    recordSqliteSubsetLoad(rows.length, performance.now() - startedAt);
    return rows;
  };

  const queryOne = async (sql: string, params: readonly SqliteValue[]): Promise<ThreadDetailRow | null> => (
    (await query(sql, params))[0] ?? null
  );

  return {
    prepare: ensurePrepared,
    begin() {
      if (currentChanges !== null) throw new Error("Thread detail SQLite transaction is already open");
      currentChanges = new Map();
    },
    write(change) {
      if (currentChanges === null) throw new Error("Thread detail SQLite transaction is not open");
      const key = change.type === "delete" ? change.key : change.value.id;
      currentChanges.set(key, change);
    },
    commit(options = {}) {
      const changes = currentChanges;
      if (changes === null) throw new Error("Thread detail SQLite transaction is not open");
      currentChanges = null;
      if (changes.size === 0) return options.durable === true ? flushPending() : Promise.resolve();
      onCommit([...changes.values()]);
      const checkpoint = enqueueCheckpoint(changes, options.durable === true);
      if (options.durable === true) void flushPending();
      return checkpoint;
    },
    flush: flushPending,
    async close() {
      if (closed) return;
      await flushPending();
      closed = true;
    },
    async loadThreadMeta(connectionId, threadId) {
      return await queryOne(
        `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "kind" = 'thread' LIMIT 1`,
        [connectionId, threadId],
      );
    },
    async loadTurn(connectionId, threadId, turnId, historyEpoch) {
      return await queryOne(
        `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "turn_id" = ? AND "history_epoch" = ? AND "kind" = 'turn' AND "sealed" = 1 LIMIT 1`,
        [connectionId, threadId, turnId, historyEpoch],
      );
    },
    async loadBoundary(connectionId, threadId, historyEpoch, direction) {
      return await queryOne(
        `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "history_epoch" = ? AND "kind" = 'turn' AND "sealed" = 1 ORDER BY "ordinal" ${direction === "asc" ? "ASC" : "DESC"}, "__key" ${direction === "asc" ? "ASC" : "DESC"} LIMIT 1`,
        [connectionId, threadId, historyEpoch],
      );
    },
    async loadWindow({ connectionId, threadId, historyEpoch, maxOrdinal, turnLimit }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const result = await database.transaction(async (executor) => {
        const turnParams: SqliteValue[] = [connectionId, threadId, historyEpoch];
        const maxClause = maxOrdinal === null ? "" : ` AND "ordinal" <= ?`;
        if (maxOrdinal !== null) turnParams.push(maxOrdinal);
        turnParams.push(turnLimit);
        const turnRows = await executeRows(
          executor,
          `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "history_epoch" = ? AND "kind" = 'turn' AND "sealed" = 1${maxClause} ORDER BY "ordinal" DESC, "__key" DESC LIMIT ?`,
          turnParams,
        );
        const ordinals = turnRows.map(({ ordinal }) => ordinal);
        const detailRows = ordinals.length === 0 ? [] : await executeRows(
          executor,
          `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "history_epoch" = ? AND "sealed" = 1 AND "kind" IN ('turnMeta', 'activity') AND "ordinal" >= ? AND "ordinal" <= ?`,
          [connectionId, threadId, historyEpoch, Math.min(...ordinals), Math.max(...ordinals)],
        );
        const liveRows = await executeRows(
          executor,
          `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "sealed" = 0 AND ("kind" = 'pending' OR "history_epoch" = ?)`,
          [connectionId, threadId, historyEpoch],
        );
        return { turnRows, detailRows, liveRows };
      });
      recordSqliteSubsetLoad(result.turnRows.length + result.detailRows.length + result.liveRows.length, performance.now() - startedAt);
      return result;
    },
    async loadResolvedWindow({ connectionId, threadId, anchorTurnId, residentHistoryEpoch, residentMaxOrdinal, residentTurnLimit, restoreNewerBuffer }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const loaded = await database.transaction(async (executor) => {
        const result = await executor.execute(
          resolvedWindowSql(),
          [
            connectionId,
            threadId,
            anchorTurnId,
            residentHistoryEpoch,
            residentMaxOrdinal ?? null,
            residentMaxOrdinal === undefined ? 0 : 1,
            residentTurnLimit,
            restoreNewerBuffer,
          ],
        );
        return parseResolvedWindowRows(extractRows(result));
      });
      recordSqliteSubsetLoad(loaded.turnRows.length + loaded.detailRows.length + loaded.liveRows.length, performance.now() - startedAt);
      return loaded;
    },
    async loadAuthoritativeFacts(connectionId, threadId, incomingTurnIds) {
      const meta = await this.loadThreadMeta(connectionId, threadId);
      const historyEpoch = meta?.historyEpoch ?? 0;
      const families = await loadTurnFamilies(query, connectionId, threadId, incomingTurnIds);
      const latest = await this.loadBoundary(connectionId, threadId, historyEpoch, "desc");
      const incomingOrdinalById = new Map(families.flatMap((row) => row.kind === "turn"
        && row.historyEpoch === historyEpoch
        && row.remoteTurnId !== null
        ? [[row.remoteTurnId, row.ordinal] as const]
        : []));
      const overlapIndex = incomingTurnIds.findIndex((turnId) => incomingOrdinalById.has(turnId));
      let occupied: ThreadDetailRow[] = [];
      if (overlapIndex >= 0) {
        const baseOrdinal = incomingOrdinalById.get(incomingTurnIds[overlapIndex]!)! - overlapIndex;
        occupied = await query(
          `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "history_epoch" = ? AND "kind" = 'turn' AND "ordinal" >= ? AND "ordinal" <= ?`,
          [connectionId, threadId, historyEpoch, baseOrdinal, baseOrdinal + incomingTurnIds.length - 1],
        );
      }
      return deduplicateRows([...(meta === null ? [] : [meta]), ...families, ...(latest === null ? [] : [latest]), ...occupied]);
    },
    async loadPrependFacts(connectionId, threadId, historyEpoch, turnIds) {
      const [families, minimum] = await Promise.all([
        loadTurnFamilies(query, connectionId, threadId, turnIds),
        this.loadBoundary(connectionId, threadId, historyEpoch, "asc"),
      ]);
      return deduplicateRows([...families, ...(minimum === null ? [] : [minimum])]);
    },
  };
}

async function prepareSchema(database: ReturnType<typeof getUiCacheSqliteDatabase>): Promise<void> {
  await database.transaction(async (executor) => {
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS "${META_TABLE}" ("runtime_id" TEXT PRIMARY KEY NOT NULL, "schema_version" INTEGER NOT NULL)`,
    );
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS "${BOOTSTRAP_TABLE}" (`
      + `"runtime_id" TEXT NOT NULL, "bootstrap_id" TEXT NOT NULL, `
      + `PRIMARY KEY ("runtime_id", "bootstrap_id"))`,
    );
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS "${TABLE}" (`
      + `"__key" TEXT PRIMARY KEY NOT NULL, "__payload" TEXT NOT NULL, `
      + `"connection_id" TEXT NOT NULL, "thread_id" TEXT NOT NULL, "turn_id" TEXT, `
      + `"history_epoch" INTEGER NOT NULL, "kind" TEXT NOT NULL, "ordinal" REAL NOT NULL, "sealed" INTEGER NOT NULL)`,
    );
    await executor.execute(`CREATE INDEX IF NOT EXISTS "${TABLE}__idx_0" ON "${TABLE}" ("connection_id", "thread_id", "history_epoch", "sealed", "kind", "ordinal")`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS "${TABLE}__idx_1" ON "${TABLE}" ("connection_id", "thread_id", "turn_id")`);
    await executor.execute(`CREATE INDEX IF NOT EXISTS "${TABLE}__idx_2" ON "${TABLE}" ("connection_id", "thread_id", "history_epoch", "kind", "ordinal")`);
    const bootstrap = await executor.execute(
      `SELECT 1 AS "present" FROM "${BOOTSTRAP_TABLE}" WHERE "runtime_id" = ? AND "bootstrap_id" = ?`,
      [RUNTIME_ID, LEGACY_BOOTSTRAP_ID],
    );
    if (extractRows(bootstrap).length === 0) {
      const count = await executor.execute(`SELECT COUNT(*) AS "row_count" FROM "${TABLE}"`);
      if (extractRows(count)[0]?.row_count === 0) {
        const legacyRows = await readLegacyPersistedRows<ThreadDetailRow>(executor, RUNTIME_ID);
        for (const candidate of legacyRows) {
          const row = normalizeLegacyThreadDetailRow(candidate);
          if (row !== null) await persistChange(executor, { type: "insert", value: row });
        }
      }
      await executor.execute(
        `INSERT INTO "${BOOTSTRAP_TABLE}" ("runtime_id", "bootstrap_id") VALUES (?, ?)`,
        [RUNTIME_ID, LEGACY_BOOTSTRAP_ID],
      );
    }
    await executor.execute(
      `INSERT INTO "${META_TABLE}" ("runtime_id", "schema_version") VALUES (?, ?) ON CONFLICT("runtime_id") DO UPDATE SET "schema_version" = excluded."schema_version"`,
      [RUNTIME_ID, SCHEMA_VERSION],
    );
  });
}

function normalizeLegacyThreadDetailRow(value: unknown): ThreadDetailRow | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<ThreadDetailRow>;
  if (typeof row.id !== "string"
    || !["thread", "turn", "turnMeta", "activity", "pending"].includes(row.kind ?? "")
    || typeof row.connectionId !== "string"
    || typeof row.remoteThreadId !== "string"
    || !(row.remoteTurnId === null || typeof row.remoteTurnId === "string")) return null;
  const kind = row.kind as ThreadDetailRow["kind"];
  return {
    ...row,
    id: row.id,
    kind,
    connectionId: row.connectionId,
    remoteThreadId: row.remoteThreadId,
    remoteTurnId: row.remoteTurnId,
    historyEpoch: Number.isFinite(row.historyEpoch) ? row.historyEpoch as number : 0,
    ordinal: Number.isFinite(row.ordinal) ? row.ordinal as number : kind === "thread" ? -1 : 0,
    sessionId: typeof row.sessionId === "string" ? row.sessionId : null,
    lastOpenedAt: Number.isFinite(row.lastOpenedAt) ? row.lastOpenedAt as number : 0,
    sealed: typeof row.sealed === "boolean" ? row.sealed : kind !== "pending",
    thread: typeof row.thread === "object" && row.thread !== null ? row.thread : null,
    turn: typeof row.turn === "object" && row.turn !== null ? row.turn : null,
    turnMetadata: typeof row.turnMetadata === "object" && row.turnMetadata !== null ? row.turnMetadata : null,
    activityItems: Array.isArray(row.activityItems) ? row.activityItems : null,
    pending: typeof row.pending === "object" && row.pending !== null ? row.pending : null,
  };
}

async function persistChange(executor: Executor, change: ThreadDetailChange): Promise<void> {
  if (change.type === "delete") {
    await executor.execute(`DELETE FROM "${TABLE}" WHERE "__key" = ?`, [storageKey(change.key)]);
    return;
  }
  const row = change.value;
  const params: SqliteValue[] = [
    storageKey(row.id),
    JSON.stringify(row),
    row.connectionId,
    row.remoteThreadId,
    row.remoteTurnId,
    row.historyEpoch,
    row.kind,
    row.ordinal,
    row.sealed ? 1 : 0,
  ];
  await executor.execute(
    `INSERT INTO "${TABLE}" ("__key", "__payload", "connection_id", "thread_id", "turn_id", "history_epoch", "kind", "ordinal", "sealed") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) `
    + `ON CONFLICT("__key") DO UPDATE SET "__payload" = excluded."__payload", "connection_id" = excluded."connection_id", "thread_id" = excluded."thread_id", "turn_id" = excluded."turn_id", "history_epoch" = excluded."history_epoch", "kind" = excluded."kind", "ordinal" = excluded."ordinal", "sealed" = excluded."sealed"`,
    params,
  );
}

/** Resolve the semantic viewport cursor and materialize its complete resident
 * row family in one native SQLite call. The tagged UNION keeps metadata out of
 * JSON payloads while avoiding the former meta/bounds/anchor/turn/detail/live
 * sequence of bridge round-trips. */
function resolvedWindowSql(): string {
  return `
    WITH
      "args"("connection_id", "thread_id", "anchor_turn_id", "resident_history_epoch", "resident_max_ordinal", "resident_max_supplied", "turn_limit", "newer_buffer") AS (
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ),
      "meta" AS (
        SELECT COALESCE((
          SELECT "details"."history_epoch"
          FROM "${TABLE}" AS "details", "args"
          WHERE "details"."connection_id" = "args"."connection_id"
            AND "details"."thread_id" = "args"."thread_id"
            AND "details"."kind" = 'thread'
          LIMIT 1
        ), 0) AS "history_epoch"
      ),
      "bounds" AS (
        SELECT
          "meta"."history_epoch" AS "history_epoch",
          (
            SELECT "details"."ordinal"
            FROM "${TABLE}" AS "details", "args"
            WHERE "details"."connection_id" = "args"."connection_id"
              AND "details"."thread_id" = "args"."thread_id"
              AND "details"."history_epoch" = "meta"."history_epoch"
              AND "details"."kind" = 'turn'
              AND "details"."sealed" = 1
            ORDER BY "details"."ordinal" DESC, "details"."__key" DESC
            LIMIT 1
          ) AS "latest_ordinal",
          (
            SELECT "details"."ordinal"
            FROM "${TABLE}" AS "details", "args"
            WHERE "details"."connection_id" = "args"."connection_id"
              AND "details"."thread_id" = "args"."thread_id"
              AND "details"."history_epoch" = "meta"."history_epoch"
              AND "details"."kind" = 'turn'
              AND "details"."sealed" = 1
            ORDER BY "details"."ordinal" ASC, "details"."__key" ASC
            LIMIT 1
          ) AS "earliest_ordinal",
          (
            SELECT "details"."ordinal"
            FROM "${TABLE}" AS "details", "args"
            WHERE "details"."connection_id" = "args"."connection_id"
              AND "details"."thread_id" = "args"."thread_id"
              AND "details"."turn_id" = "args"."anchor_turn_id"
              AND "details"."history_epoch" = "meta"."history_epoch"
              AND "details"."kind" = 'turn'
              AND "details"."sealed" = 1
            LIMIT 1
          ) AS "anchor_ordinal"
        FROM "meta"
      ),
      "restored" AS (
        SELECT
          "bounds".*,
          CASE
            WHEN "anchor_ordinal" IS NULL
              OR "latest_ordinal" IS NULL
              OR "anchor_ordinal" + "args"."newer_buffer" >= "latest_ordinal"
            THEN NULL
            ELSE "anchor_ordinal" + "args"."newer_buffer"
          END AS "restored_max_ordinal"
        FROM "bounds", "args"
      ),
      "resolved" AS (
        SELECT
          "restored"."history_epoch",
          "restored"."latest_ordinal",
          "restored"."earliest_ordinal",
          CASE
            WHEN "args"."resident_history_epoch" IS NOT NULL
              AND "args"."resident_history_epoch" <> "restored"."history_epoch"
            THEN "restored"."restored_max_ordinal"
            WHEN "args"."resident_max_supplied" = 0
            THEN "restored"."restored_max_ordinal"
            ELSE "args"."resident_max_ordinal"
          END AS "requested_max_ordinal"
        FROM "restored", "args"
      ),
      "turns" AS (
        SELECT "details"."__payload", "details"."__key", "details"."ordinal"
        FROM "${TABLE}" AS "details", "args", "resolved"
        WHERE "details"."connection_id" = "args"."connection_id"
          AND "details"."thread_id" = "args"."thread_id"
          AND "details"."history_epoch" = "resolved"."history_epoch"
          AND "details"."kind" = 'turn'
          AND "details"."sealed" = 1
          AND ("resolved"."requested_max_ordinal" IS NULL OR "details"."ordinal" <= "resolved"."requested_max_ordinal")
        ORDER BY "details"."ordinal" DESC, "details"."__key" DESC
        LIMIT (SELECT "turn_limit" FROM "args")
      ),
      "window_rows" AS (
        SELECT 1 AS "bucket_order", 'turn' AS "bucket", "turns"."__payload", "turns"."ordinal" AS "result_ordinal"
        FROM "turns"
        UNION ALL
        SELECT 2, 'detail', "details"."__payload", "details"."ordinal"
        FROM "${TABLE}" AS "details", "args", "resolved"
        WHERE "details"."connection_id" = "args"."connection_id"
          AND "details"."thread_id" = "args"."thread_id"
          AND "details"."history_epoch" = "resolved"."history_epoch"
          AND "details"."sealed" = 1
          AND "details"."kind" IN ('turnMeta', 'activity')
          AND EXISTS (SELECT 1 FROM "turns" WHERE "turns"."ordinal" = "details"."ordinal")
        UNION ALL
        SELECT 3, 'live', "details"."__payload", "details"."ordinal"
        FROM "${TABLE}" AS "details", "args", "resolved"
        WHERE "details"."connection_id" = "args"."connection_id"
          AND "details"."thread_id" = "args"."thread_id"
          AND "details"."sealed" = 0
          AND ("details"."kind" = 'pending' OR "details"."history_epoch" = "resolved"."history_epoch")
      )
    SELECT
      0 AS "bucket_order",
      'meta' AS "bucket",
      NULL AS "__payload",
      "history_epoch",
      "latest_ordinal",
      "earliest_ordinal",
      "requested_max_ordinal",
      0 AS "result_ordinal"
    FROM "resolved"
    UNION ALL
    SELECT
      "bucket_order",
      "bucket",
      "__payload",
      NULL,
      NULL,
      NULL,
      NULL,
      "result_ordinal"
    FROM "window_rows"
    ORDER BY "bucket_order" ASC, "result_ordinal" DESC
  `;
}

function parseResolvedWindowRows(rows: readonly Record<string, SqliteValue>[]): ResolvedThreadDetailWindow {
  const metadata = rows.find(({ bucket }) => bucket === "meta");
  const historyEpoch = numericSqliteValue(metadata?.history_epoch) ?? 0;
  return {
    historyEpoch,
    latestSealedOrdinal: numericSqliteValue(metadata?.latest_ordinal),
    earliestSealedOrdinal: numericSqliteValue(metadata?.earliest_ordinal),
    requestedMaxOrdinal: numericSqliteValue(metadata?.requested_max_ordinal),
    turnRows: rows.filter(({ bucket }) => bucket === "turn").map(parsePayload),
    detailRows: rows.filter(({ bucket }) => bucket === "detail").map(parsePayload),
    liveRows: rows.filter(({ bucket }) => bucket === "live").map(parsePayload),
  };
}

function numericSqliteValue(value: SqliteValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function executeRows(executor: Executor, sql: string, params: readonly SqliteValue[]): Promise<ThreadDetailRow[]> {
  return extractRows(await executor.execute(sql, params)).map(parsePayload);
}

async function loadTurnFamilies(
  query: (sql: string, params: readonly SqliteValue[]) => Promise<ThreadDetailRow[]>,
  connectionId: string,
  threadId: string,
  turnIds: readonly string[],
): Promise<ThreadDetailRow[]> {
  if (turnIds.length === 0) return [];
  return await query(
    `SELECT "__payload" FROM "${TABLE}" WHERE "connection_id" = ? AND "thread_id" = ? AND "turn_id" IN (${turnIds.map(() => "?").join(", ")})`,
    [connectionId, threadId, ...turnIds],
  );
}

function parsePayload(row: Record<string, SqliteValue>): ThreadDetailRow {
  const payload = row.__payload;
  if (typeof payload !== "string") throw new Error("Thread detail SQLite row has no payload");
  return JSON.parse(payload) as ThreadDetailRow;
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) return result as readonly Record<string, SqliteValue>[];
  if (typeof result !== "object" || result === null) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as readonly Record<string, SqliteValue>[] : [];
}

function deduplicateRows(rows: readonly ThreadDetailRow[]): ThreadDetailRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function storageKey(key: string): string {
  return `string:${key}`;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
