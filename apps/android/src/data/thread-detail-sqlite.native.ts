import { pendingTimelineRowId, type ThreadDetailRow } from "./thread-detail-projection";
import type { CommandReceipt } from "./command-receipt-evidence";
import { getUiCacheFileDiagnostics, getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { incrementMetric, recordSqliteSubsetLoad, recordTiming } from "./operational-metrics";
import { historyMemberSource, historyMemberPayload, historyScope, historyMetaSql, historyLiveSql, resolvedHistoryWindowSql, retainedHistoryMemberSource } from "./thread-history-queries";
import { collectUnreferencedHistoryContent, persistHistoryRow, prepareHistoryRelations } from "./thread-history-relations";

const TABLE = "codewide_thread_details";
const CACHE_META_TABLE = "codewide_thread_detail_cache_meta";
const CONTENT_TABLE = "codewide_history_content";
const CHECKPOINT_DELAY_MS = 250;
const CHECKPOINT_ATTEMPTS = 3;
// History is a reconstructable FIFO cache, not an LRU. Let it grow to 2 GiB,
// then rotate the oldest inserted sealed turn families down to 1 GiB. The
// remaining history reuses the freed pages for newer rows.
const HISTORY_CACHE_SOFT_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
const HISTORY_CACHE_HARD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const HISTORY_CACHE_MAINTENANCE_WRITE_BYTES = 64 * 1024 * 1024;

type SqliteValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView;
type Executor = { execute(sql: string, params?: readonly SqliteValue[]): Promise<unknown> };

export type ThreadDetailChange =
  | { type: "insert" | "update"; value: ThreadDetailRow }
  | { type: "delete"; key: string };

export type ThreadDetailSqliteControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change: ThreadDetailChange): void;
  rollback(): void;
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
};

export type ThreadDetailSqliteDiagnostics = {
  rowCount: number;
  payloadBytes: number;
  historyPayloadBytes: number;
  pendingRows: number;
  pendingDeliveryRows: number;
  physicalBytes: number;
  reusableBytes: number;
  mainFileBytes: number;
  walFileBytes: number;
  shmFileBytes: number;
  staleDeliveryRowsRemoved: number;
  historyFamiliesEvicted: number;
  historyBytesEvicted: number;
};

type ThreadDetailSqliteMaintenance = Pick<
  ThreadDetailSqliteDiagnostics,
  "staleDeliveryRowsRemoved" | "historyFamiliesEvicted" | "historyBytesEvicted"
>;

type PendingCheckpoint = {
  changes: Map<string, ThreadDetailChange>;
  transactions: number;
  waiters: Array<{ resolve(): void; reject(cause: unknown): void }>;
};

export type ThreadDetailSqlite = ThreadDetailSqliteControls & {
  confirmCommandReceipts(connectionId: string, receipts: readonly CommandReceipt[]): Promise<ThreadDetailRow[]>;
  prepare(): Promise<void>;
  diagnostics(): Promise<ThreadDetailSqliteDiagnostics>;
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
    turnLimit: number;
    newerBuffer: number;
  }): Promise<ResolvedThreadDetailWindow>;
  loadAdjacentWindow(input: {
    connectionId: string;
    threadId: string;
    historyEpoch: number;
    boundaryOrdinal: number;
    direction: "older" | "newer";
    turnLimit: number;
  }): Promise<ThreadDetailWindowRows>;
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
  let historyBytesWrittenSinceMaintenance = 0;
  let prepared: Promise<void> | null = null;
  let maintenance: ThreadDetailSqliteMaintenance = {
    staleDeliveryRowsRemoved: 0,
    historyFamiliesEvicted: 0,
    historyBytesEvicted: 0,
  };
  let closed = false;

  const ensurePrepared = (): Promise<void> => {
    if (prepared === null) {
      let attempt!: Promise<void>;
      attempt = prepareSchema(database).then((result) => {
        maintenance = result;
      }).catch((cause) => {
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
    for (const [key, change] of changes) {
      pending.changes.set(key, change);
      if (change.type !== "delete"
        && change.value.sealed
        && ["turn", "turnMeta", "activity"].includes(change.value.kind)) {
        // A conservative UTF-8 upper bound is sufficient to decide when the
        // exact SQLite byte count should be checked.
        historyBytesWrittenSinceMaintenance += JSON.stringify(change.value).length * 3;
      }
    }
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
          if (historyBytesWrittenSinceMaintenance >= HISTORY_CACHE_MAINTENANCE_WRITE_BYTES) {
            try {
              const rotation = await database.transaction(rotateHistoryCache);
              historyBytesWrittenSinceMaintenance = 0;
              maintenance = {
                ...maintenance,
                historyFamiliesEvicted: maintenance.historyFamiliesEvicted + rotation.historyFamiliesEvicted,
                historyBytesEvicted: maintenance.historyBytesEvicted + rotation.historyBytesEvicted,
              };
            } catch (cause) {
              // Cache maintenance must not turn an already durable chat write
              // into a failed projection. Keep the counter armed and retry on
              // the next checkpoint.
              console.warn("Thread history FIFO maintenance failed", cause);
            }
          }
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
    async confirmCommandReceipts(connectionId, receipts) {
      if (receipts.length === 0) return [];
      await ensurePrepared();
      await flushPending();
      return await database.transaction(async (executor) => {
        const updated: ThreadDetailRow[] = [];
        for (const receipt of receipts) {
          const candidates = await executeRows(executor,
            `SELECT payload AS __payload FROM codewide_history_pending WHERE __key = ? AND connection_id = ? AND thread_id = ?`,
            [storageKey(pendingTimelineRowId(connectionId, receipt.threadId, receipt.commandId)), connectionId, receipt.threadId]);
          const row = candidates[0];
          const pendingEntry = row?.pending;
          if (row?.kind !== "pending" || pendingEntry == null || pendingEntry.commandId !== receipt.commandId
            || pendingEntry.confirmation !== undefined) continue;
          const confirmed: ThreadDetailRow = { ...row, pending: {
            ...pendingEntry, presentation: "delivery", state: "appServerAccepted", lastError: null, confirmation: receipt,
          } };
          await persistHistoryRow(executor, confirmed);
          updated.push(confirmed);
        }
        return updated;
      });
    },
    prepare: ensurePrepared,
    async diagnostics() {
      await ensurePrepared();
      await flushPending();
      return {
        ...(await collectDiagnostics(database)),
        ...maintenance,
      };
    },
    begin() {
      if (currentChanges !== null) throw new Error("Thread detail SQLite transaction is already open");
      currentChanges = new Map();
    },
    write(change) {
      if (currentChanges === null) throw new Error("Thread detail SQLite transaction is not open");
      const key = change.type === "delete" ? change.key : change.value.id;
      currentChanges.set(key, change);
    },
    rollback() {
      // Rollback is deliberately idempotent. A caller may be recovering from
      // a synchronous commit callback failure after commit already released
      // the staging map.
      currentChanges = null;
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
        historyMetaSql,
        [connectionId, threadId],
      );
    },
    async loadTurn(connectionId, threadId, turnId, historyEpoch) {
      return await queryOne(
        `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.turn_id = ? AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1 LIMIT 1`,
        [connectionId, threadId, turnId, historyEpoch],
      );
    },
    async loadBoundary(connectionId, threadId, historyEpoch, direction) {
      return await queryOne(
        `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1 ORDER BY p.ordinal ${direction === "asc" ? "ASC" : "DESC"}, p.turn_id ${direction === "asc" ? "ASC" : "DESC"} LIMIT 1`,
        [connectionId, threadId, historyEpoch],
      );
    },
    async loadWindow({ connectionId, threadId, historyEpoch, maxOrdinal, turnLimit }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const result = await database.transaction(async (executor) => {
        const turnParams: SqliteValue[] = [connectionId, threadId, historyEpoch];
        const maxClause = maxOrdinal === null ? "" : ` AND p.ordinal <= ?`;
        if (maxOrdinal !== null) turnParams.push(maxOrdinal);
        turnParams.push(turnLimit);
        const turnRows = await executeRows(
          executor,
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1${maxClause} ORDER BY p.ordinal DESC, p.turn_id DESC LIMIT ?`,
          turnParams,
        );
        const ordinals = turnRows.map(({ ordinal }) => ordinal);
        const detailRows = ordinals.length === 0 ? [] : await executeRows(
          executor,
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.sealed = 1 AND c.kind IN ('turnMeta', 'activity') AND p.ordinal >= ? AND p.ordinal <= ?`,
          [connectionId, threadId, historyEpoch, Math.min(...ordinals), Math.max(...ordinals)],
        );
        const liveRows = await executeRows(
          executor,
          historyLiveSql,
          [connectionId, threadId, historyEpoch],
        );
        return { turnRows, detailRows, liveRows };
      });
      recordSqliteSubsetLoad(result.turnRows.length + result.detailRows.length + result.liveRows.length, performance.now() - startedAt);
      return result;
    },
    async loadResolvedWindow({ connectionId, threadId, anchorTurnId, turnLimit, newerBuffer }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const loaded = await database.transaction(async (executor) => {
        const result = await executor.execute(
          resolvedHistoryWindowSql(),
          [
            connectionId,
            threadId,
            anchorTurnId,
            turnLimit,
            newerBuffer,
          ],
        );
        return parseResolvedWindowRows(extractRows(result));
      });
      recordSqliteSubsetLoad(loaded.turnRows.length + loaded.detailRows.length + loaded.liveRows.length, performance.now() - startedAt);
      return loaded;
    },
    async loadAdjacentWindow({ connectionId, threadId, historyEpoch, boundaryOrdinal, direction, turnLimit }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const loaded = await database.transaction(async (executor) => {
        const comparison = direction === "older" ? "<" : ">";
        const order = direction === "older" ? "DESC" : "ASC";
        const turnRows = await executeRows(
          executor,
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1 AND p.ordinal ${comparison} ? ORDER BY p.ordinal ${order}, p.turn_id ${order} LIMIT ?`,
          [connectionId, threadId, historyEpoch, boundaryOrdinal, turnLimit],
        );
        const ordinals = turnRows.map(({ ordinal }) => ordinal);
        const detailRows = ordinals.length === 0 ? [] : await executeRows(
          executor,
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.sealed = 1 AND c.kind IN ('turnMeta', 'activity') AND p.ordinal IN (${ordinals.map(() => "?").join(", ")})`,
          [connectionId, threadId, historyEpoch, ...ordinals],
        );
        return { turnRows, detailRows, liveRows: [] };
      });
      recordSqliteSubsetLoad(loaded.turnRows.length + loaded.detailRows.length, performance.now() - startedAt);
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
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND p.ordinal >= ? AND p.ordinal <= ?`,
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

async function prepareSchema(database: ReturnType<typeof getUiCacheSqliteDatabase>): Promise<ThreadDetailSqliteMaintenance> {
  return await database.transaction(async (executor) => {
    await prepareHistoryRelations(executor);
    // Old invalidation cursors represented the removed replay/repair model.
    // Authoritative thread sync now compares semantic sealed-turn ids.
    await executor.execute(`DROP TABLE IF EXISTS "codewide_thread_detail_invalidations"`);
    await executor.execute(`DROP TABLE IF EXISTS "codewide_thread_invalidations"`);
    await prepareHistoryCacheAccounting(executor);
    const rotation = await rotateHistoryCache(executor);
    return { staleDeliveryRowsRemoved: 0, ...rotation };
  });
}

async function persistChange(executor: Executor, change: ThreadDetailChange): Promise<void> {
  if (change.type === "delete") {
    await executor.execute(`DELETE FROM "${TABLE}" WHERE "__key" = ?`, [storageKey(change.key)]);
    return;
  }
  // The relational writer also guards off-window canonical identities from pending mirrors.
  await persistHistoryRow(executor, change.value);
}

function parseResolvedWindowRows(rows: readonly Record<string, SqliteValue>[]): ResolvedThreadDetailWindow {
  const metadata = rows.find(({ bucket }) => bucket === "meta");
  const historyEpoch = numericSqliteValue(metadata?.history_epoch) ?? 0;
  return {
    historyEpoch,
    latestSealedOrdinal: numericSqliteValue(metadata?.latest_ordinal),
    earliestSealedOrdinal: numericSqliteValue(metadata?.earliest_ordinal),
    turnRows: rows.filter(({ bucket }) => bucket === "turn").map(parsePayload),
    detailRows: rows.filter(({ bucket }) => bucket === "detail").map(parsePayload),
    liveRows: rows.filter(({ bucket }) => bucket === "live").map(parsePayload),
  };
}

export async function rotateHistoryCache(executor: Executor, limits: {
  softLimitBytes: number;
  hardLimitBytes: number;
} = {
  softLimitBytes: HISTORY_CACHE_SOFT_LIMIT_BYTES,
  hardLimitBytes: HISTORY_CACHE_HARD_LIMIT_BYTES,
}): Promise<Pick<
  ThreadDetailSqliteMaintenance,
  "historyFamiliesEvicted" | "historyBytesEvicted"
>> {
  // Scan orphan references only during bounded cache maintenance, never per live patch.
  await collectUnreferencedHistoryContent(executor);
  const currentBytes = await readHistoryPayloadBytes(executor);
  if (currentBytes <= limits.hardLimitBytes) {
    return { historyFamiliesEvicted: 0, historyBytesEvicted: 0 };
  }

  const reclaimBytes = currentBytes - limits.softLimitBytes;
  const candidateCte = `
    WITH "families" AS (
      SELECT
        "connection_id", "thread_id", "turn_id", MIN("content_id") AS "first_rowid",
        SUM("payload_bytes") AS "payload_bytes"
      FROM "${CONTENT_TABLE}"
      WHERE "sealed" = 1
      GROUP BY "connection_id", "thread_id", "turn_id"
    ),
    "ranked" AS (
      SELECT
        "families".*,
        SUM("payload_bytes") OVER (ORDER BY "first_rowid" ASC) AS "reclaimed_bytes"
      FROM "families"
    ),
    "chosen" AS (
      SELECT * FROM "ranked" WHERE "reclaimed_bytes" - "payload_bytes" < ?
    )`;
  const selected = extractRows(await executor.execute(
    `${candidateCte} SELECT COUNT(*) AS "family_count", COALESCE(SUM("payload_bytes"), 0) AS "payload_bytes" FROM "chosen"`,
    [reclaimBytes],
  ))[0];
  const historyFamiliesEvicted = numericSqliteValue(selected?.family_count) ?? 0;
  const historyBytesEvicted = numericSqliteValue(selected?.payload_bytes) ?? 0;
  if (historyFamiliesEvicted === 0) return { historyFamiliesEvicted, historyBytesEvicted };
  const selectedContent = `SELECT "details"."content_id" FROM "${CONTENT_TABLE}" AS "details"
     WHERE "details"."sealed" = 1
       AND EXISTS (
         SELECT 1 FROM "chosen"
         WHERE "chosen"."connection_id" = "details"."connection_id"
           AND "chosen"."thread_id" = "details"."thread_id"
           AND "chosen"."turn_id" IS "details"."turn_id"
       )`;
  await executor.execute(
    `${candidateCte} DELETE FROM codewide_history_members WHERE content_id IN (${selectedContent})`,
    [reclaimBytes],
  );
  await executor.execute(
    `${candidateCte} DELETE FROM "${CONTENT_TABLE}" WHERE content_id IN (${selectedContent})`,
    [reclaimBytes],
  );
  return { historyFamiliesEvicted, historyBytesEvicted };
}

async function collectDiagnostics(database: ReturnType<typeof getUiCacheSqliteDatabase>): Promise<Omit<
  ThreadDetailSqliteDiagnostics,
  keyof ThreadDetailSqliteMaintenance
>> {
  const [sqlite, files] = await Promise.all([
    database.transaction(async (executor) => {
      const totals = extractRows(await executor.execute(
        `SELECT
          COUNT(*) AS "row_count",
          COALESCE(SUM(CASE WHEN "kind" = 'pending' THEN 1 ELSE 0 END), 0) AS "pending_rows"
         FROM "${TABLE}"`,
      ))[0];
      const historyPayloadBytes = await readHistoryPayloadBytes(executor);
      const otherPayloadBytes = numericSqliteValue(extractRows(await executor.execute(
        `SELECT COALESCE(SUM(LENGTH(CAST("__payload" AS BLOB))), 0) AS "other_payload_bytes"
         FROM "${TABLE}"
         WHERE "sealed" = 0 OR "kind" NOT IN ('turn', 'turnMeta', 'activity')`,
      ))[0]?.other_payload_bytes) ?? 0;
      const pendingDeliveryRows = (await executeRows(
        executor,
        `SELECT "__payload" FROM "${TABLE}" WHERE "kind" = 'pending'`,
        [],
      )).filter((row) => row.pending?.presentation === "delivery").length;
      const pageCount = numericSqliteValue(extractRows(await executor.execute("PRAGMA page_count"))[0]?.page_count) ?? 0;
      const freePages = numericSqliteValue(extractRows(await executor.execute("PRAGMA freelist_count"))[0]?.freelist_count) ?? 0;
      const pageSize = numericSqliteValue(extractRows(await executor.execute("PRAGMA page_size"))[0]?.page_size) ?? 0;
      return {
        rowCount: numericSqliteValue(totals?.row_count) ?? 0,
        payloadBytes: historyPayloadBytes + otherPayloadBytes,
        historyPayloadBytes,
        pendingRows: numericSqliteValue(totals?.pending_rows) ?? 0,
        pendingDeliveryRows,
        physicalBytes: pageCount * pageSize,
        reusableBytes: freePages * pageSize,
      };
    }),
    getUiCacheFileDiagnostics(),
  ]);
  return { ...sqlite, ...files };
}

export async function prepareHistoryCacheAccounting(executor: Executor): Promise<void> {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS "${CACHE_META_TABLE}" (`
      + `"singleton" INTEGER PRIMARY KEY NOT NULL CHECK("singleton" = 1), `
      + `"history_bytes" INTEGER NOT NULL)`,
  );
  const present = extractRows(await executor.execute(
    `SELECT 1 AS "present" FROM "${CACHE_META_TABLE}" WHERE "singleton" = 1`,
  )).length > 0;
  if (!present) {
    await executor.execute(
      `INSERT INTO "${CACHE_META_TABLE}" ("singleton", "history_bytes") `
        + `SELECT 1, COALESCE(SUM("payload_bytes"), 0) `
        + `FROM "${CONTENT_TABLE}" WHERE "sealed" = 1`,
    );
  }
  const newHistory = `NEW."sealed" = 1 AND NEW."kind" IN ('turn', 'turnMeta', 'activity')`;
  const oldHistory = `OLD."sealed" = 1 AND OLD."kind" IN ('turn', 'turnMeta', 'activity')`;
  await executor.execute(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENT_TABLE}__cache_insert" AFTER INSERT ON "${CONTENT_TABLE}" `
      + `WHEN ${newHistory} BEGIN `
      + `UPDATE "${CACHE_META_TABLE}" SET "history_bytes" = "history_bytes" + NEW."payload_bytes" WHERE "singleton" = 1; END`,
  );
  await executor.execute(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENT_TABLE}__cache_delete" AFTER DELETE ON "${CONTENT_TABLE}" `
      + `WHEN ${oldHistory} BEGIN `
      + `UPDATE "${CACHE_META_TABLE}" SET "history_bytes" = MAX(0, "history_bytes" - OLD."payload_bytes") WHERE "singleton" = 1; END`,
  );
  await executor.execute(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENT_TABLE}__cache_update" AFTER UPDATE ON "${CONTENT_TABLE}" BEGIN `
      + `UPDATE "${CACHE_META_TABLE}" SET "history_bytes" = MAX(0, "history_bytes" `
      + `- CASE WHEN ${oldHistory} THEN OLD."payload_bytes" ELSE 0 END `
      + `+ CASE WHEN ${newHistory} THEN NEW."payload_bytes" ELSE 0 END) `
      + `WHERE "singleton" = 1; END`,
  );
}

async function readHistoryPayloadBytes(executor: Executor): Promise<number> {
  return numericSqliteValue(extractRows(await executor.execute(
    `SELECT "history_bytes" FROM "${CACHE_META_TABLE}" WHERE "singleton" = 1`,
  ))[0]?.history_bytes) ?? 0;
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
    `SELECT ${historyMemberPayload} AS __payload FROM ${retainedHistoryMemberSource}
      WHERE ${historyScope} AND p.turn_id IN (${turnIds.map(() => "?").join(", ")})
      ORDER BY CASE WHEN p.history_epoch=h.active_epoch THEN 1 ELSE 0 END ASC,
        p.history_epoch ASC,c.content_id ASC`,
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
