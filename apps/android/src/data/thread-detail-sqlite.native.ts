import {
  pendingTimelineRowId,
  type PendingTimelineEntry,
  type ThreadDetailRow,
} from "./thread-detail-projection";
import { appLogger } from "../observability/logger";
import type { CommandReceipt } from "./command-receipt-evidence";
import { getUiCacheFileDiagnostics, getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { incrementMetric, recordSqliteSubsetLoad, recordTiming } from "./operational-metrics";
import { sqliteRows } from "./sqliteResult";
import { unknownRecord } from "./unknownRecord";
import {
  historyMemberSource,
  historyMemberPayload,
  historyScope,
  historyMetaSql,
  historyLiveSql,
  resolvedHistoryWindowSql,
  retainedHistoryMemberSource,
} from "./thread-history-queries";
import {
  collectUnreferencedHistoryContent,
  persistHistoryRow,
  prepareHistoryRelations,
} from "./thread-history-relations";

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
type Executor = { execute: (sql: string, params?: readonly SqliteValue[]) => Promise<unknown> };

export type ThreadDetailChange =
  | { type: "insert" | "update"; value: ThreadDetailRow }
  | { key: string; type: "delete" };

export type ThreadDetailSqliteControls = {
  begin: (options?: { immediate?: boolean }) => void;
  commit: (options?: { durable?: boolean }) => Promise<void>;
  rollback: () => void;
  write: (change: ThreadDetailChange) => void;
};

export type ThreadDetailWindowQuery = {
  connectionId: string;
  historyEpoch: number;
  maxOrdinal: number | null;
  threadId: string;
  turnLimit: number;
};

export type ThreadDetailWindowRows = {
  detailRows: ThreadDetailRow[];
  liveRows: ThreadDetailRow[];
  turnRows: ThreadDetailRow[];
};

export type ResolvedThreadDetailWindow = ThreadDetailWindowRows & {
  earliestSealedOrdinal: number | null;
  historyEpoch: number;
  latestSealedOrdinal: number | null;
};

export type ThreadDetailSqliteDiagnostics = {
  historyBytesEvicted: number;
  historyFamiliesEvicted: number;
  historyPayloadBytes: number;
  mainFileBytes: number;
  payloadBytes: number;
  pendingDeliveryRows: number;
  pendingRows: number;
  physicalBytes: number;
  reusableBytes: number;
  rowCount: number;
  shmFileBytes: number;
  staleDeliveryRowsRemoved: number;
  walFileBytes: number;
};

type ThreadDetailSqliteMaintenance = Pick<
  ThreadDetailSqliteDiagnostics,
  "staleDeliveryRowsRemoved" | "historyFamiliesEvicted" | "historyBytesEvicted"
>;

type PendingCheckpoint = {
  changes: Map<string, ThreadDetailChange>;
  transactions: number;
  waiters: Array<{ reject: (cause: unknown) => void; resolve: () => void }>;
};

export type ThreadDetailSqlite = ThreadDetailSqliteControls & {
  close: () => Promise<void>;
  confirmCommandReceipts: (
    connectionId: string,
    receipts: readonly CommandReceipt[],
  ) => Promise<ThreadDetailRow[]>;
  diagnostics: () => Promise<ThreadDetailSqliteDiagnostics>;
  flush: () => Promise<void>;
  loadAdjacentWindow: (input: {
    boundaryOrdinal: number;
    connectionId: string;
    direction: "older" | "newer";
    historyEpoch: number;
    threadId: string;
    turnLimit: number;
  }) => Promise<ThreadDetailWindowRows>;
  loadAuthoritativeFacts: (
    connectionId: string,
    threadId: string,
    incomingTurnIds: readonly string[],
  ) => Promise<ThreadDetailRow[]>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  loadBoundary: (
    connectionId: string,
    threadId: string,
    historyEpoch: number,
    direction: "asc" | "desc",
  ) => Promise<ThreadDetailRow | null>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  loadPrependFacts: (
    connectionId: string,
    threadId: string,
    historyEpoch: number,
    turnIds: readonly string[],
  ) => Promise<ThreadDetailRow[]>;
  loadResolvedWindow: (input: {
    anchorTurnId: string | null;
    connectionId: string;
    newerBuffer: number;
    threadId: string;
    turnLimit: number;
  }) => Promise<ResolvedThreadDetailWindow>;
  loadThreadMeta: (connectionId: string, threadId: string) => Promise<ThreadDetailRow | null>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  loadTurn: (
    connectionId: string,
    threadId: string,
    turnId: string,
    historyEpoch: number,
  ) => Promise<ThreadDetailRow | null>;
  loadWindow: (query: ThreadDetailWindowQuery) => Promise<ThreadDetailWindowRows>;
  prepare: () => Promise<void>;
};

/**
 * Chat-specific SQLite adapter. It deliberately exposes semantic keyset reads
 * instead of a generic query language: the chat model asks for one range and
 * receives turns, overlays, and the mutable head from a single transaction.
 */
export function createThreadDetailSqlite(
  onCommit: (changes: readonly ThreadDetailChange[]) => void,
): ThreadDetailSqlite {
  const database = getUiCacheSqliteDatabase();
  let currentChanges: Map<string, ThreadDetailChange> | null = null;
  let pending: PendingCheckpoint | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let checkpointTail = Promise.resolve();
  let latestCheckpoint = Promise.resolve();
  let historyBytesWrittenSinceMaintenance = 0;
  let prepared: Promise<void> | null = null;
  let maintenance: ThreadDetailSqliteMaintenance = {
    historyBytesEvicted: 0,
    historyFamiliesEvicted: 0,
    staleDeliveryRowsRemoved: 0,
  };
  let closed = false;

  const ensurePrepared = async (): Promise<void> => {
    if (prepared === null) {
      const attempt = prepareSchema(database)
        .then((result) => {
          maintenance = result;
        })
        .catch((error: unknown) => {
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
        appLogger.warnCaught({ error: error, event: "thread_detail.sqlite_checkpoint.failed" });
      });
    }, CHECKPOINT_DELAY_MS);
  };

  const enqueueCheckpoint = async (
    changes: Map<string, ThreadDetailChange>,
    waitForDurability: boolean,
  ): Promise<void> => {
    pending ??= { changes: new Map(), transactions: 0, waiters: [] };
    for (const [key, change] of changes) {
      pending.changes.set(key, change);
      if (
        change.type !== "delete" &&
        change.value.sealed &&
        ["turn", "turnMeta", "activity"].includes(change.value.kind)
      ) {
        // A conservative UTF-8 upper bound is sufficient to decide when the
        // exact SQLite byte count should be checked.
        historyBytesWrittenSinceMaintenance += JSON.stringify(change.value).length * 3;
      }
    }
    pending.transactions += 1;
    const checkpoint = waitForDurability
      ? new Promise<void>((resolve, reject) => {
          pending?.waiters.push({ reject, resolve });
        })
      : Promise.resolve();
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
      const startedAt = performance.now();
      let attempts = 0;
      for (;;) {
        attempts += 1;
        try {
          await database.transaction(async (executor) => {
            for (const change of checkpoint.changes.values()) {
              await persistChange(executor, change);
            }
          });
          if (historyBytesWrittenSinceMaintenance >= HISTORY_CACHE_MAINTENANCE_WRITE_BYTES) {
            try {
              const rotation = await database.transaction(rotateHistoryCache);
              historyBytesWrittenSinceMaintenance = 0;
              maintenance = {
                ...maintenance,
                historyBytesEvicted: maintenance.historyBytesEvicted + rotation.historyBytesEvicted,
                historyFamiliesEvicted:
                  maintenance.historyFamiliesEvicted + rotation.historyFamiliesEvicted,
              };
            } catch (error) {
              // Cache maintenance must not turn an already durable chat write
              // into a failed projection. Keep the counter armed and retry on
              // the next checkpoint.
              appLogger.warnCaught({
                error: error,
                event: "thread_history.fifo_maintenance.failed",
              });
            }
          }
          break;
        } catch (error) {
          if (attempts >= CHECKPOINT_ATTEMPTS) {
            throw error;
          }
          await delay(25 * attempts);
        }
      }
      recordTiming("sqlite_checkpoint_ms", performance.now() - startedAt);
      incrementMetric("sqlite_checkpoints");
      if (checkpoint.transactions > 1) {
        incrementMetric("sqlite_transactions_coalesced", checkpoint.transactions - 1);
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
        pending ??= { changes: new Map(), transactions: 0, waiters: [] };
        for (const [key, change] of checkpoint.changes) {
          if (!pending.changes.has(key)) {
            pending.changes.set(key, change);
          }
        }
        pending.transactions += checkpoint.transactions;
        checkpoint.waiters.forEach(({ reject }) => {
          reject(error);
        });
        scheduleCheckpoint();
      },
    );
    return operation;
  };

  const query = async (sql: string, params: readonly SqliteValue[]): Promise<ThreadDetailRow[]> => {
    if (closed) {
      throw new Error("Thread detail SQLite adapter is closed");
    }
    await ensurePrepared();
    await flushPending();
    const startedAt = performance.now();
    const result = await database.execute(sql, params);
    const rows = extractRows(result).map(parsePayload);
    recordSqliteSubsetLoad(rows.length, performance.now() - startedAt);
    return rows;
  };

  const queryOne = async (
    sql: string,
    params: readonly SqliteValue[],
  ): Promise<ThreadDetailRow | null> => (await query(sql, params))[0] ?? null;

  return {
    begin() {
      if (currentChanges !== null) {
        throw new Error("Thread detail SQLite transaction is already open");
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
        throw new Error("Thread detail SQLite transaction is not open");
      }
      currentChanges = null;
      if (changes.size === 0) {
        return options.durable === true ? flushPending() : Promise.resolve();
      }
      onCommit([...changes.values()]);
      const checkpoint = enqueueCheckpoint(changes, options.durable === true);
      if (options.durable === true) {
        flushPending().catch(() => undefined);
      }
      return checkpoint;
    },
    async confirmCommandReceipts(connectionId, receipts) {
      if (receipts.length === 0) {
        return [];
      }
      await ensurePrepared();
      await flushPending();
      return database.transaction(async (executor) => {
        const updated: ThreadDetailRow[] = [];
        for (const receipt of receipts) {
          const candidates = await executeRows(
            executor,
            `SELECT payload AS __payload FROM codewide_history_pending WHERE __key = ? AND connection_id = ? AND thread_id = ?`,
            [
              storageKey(pendingTimelineRowId(connectionId, receipt.threadId, receipt.commandId)),
              connectionId,
              receipt.threadId,
            ],
          );
          const row = candidates[0];
          if (!isUnconfirmedReceiptRow(row, receipt)) {
            continue;
          }
          const pendingEntry = row.pending;
          const confirmed: ThreadDetailRow = {
            ...row,
            pending: {
              ...pendingEntry,
              confirmation: receipt,
              lastError: null,
              presentation: "delivery",
              state: "appServerAccepted",
            },
          };
          await persistHistoryRow(executor, confirmed);
          updated.push(confirmed);
        }
        return updated;
      });
    },
    async diagnostics() {
      await ensurePrepared();
      await flushPending();
      return {
        ...(await collectDiagnostics(database)),
        ...maintenance,
      };
    },
    flush: flushPending,
    async loadAdjacentWindow({
      boundaryOrdinal,
      connectionId,
      direction,
      historyEpoch,
      threadId,
      turnLimit,
    }) {
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
        const detailRows =
          ordinals.length === 0
            ? []
            : await executeRows(
                executor,
                `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.sealed = 1 AND c.kind IN ('turnMeta', 'activity') AND p.ordinal IN (${ordinals.map(() => "?").join(", ")})`,
                [connectionId, threadId, historyEpoch, ...ordinals],
              );
        return { detailRows, liveRows: [], turnRows };
      });
      recordSqliteSubsetLoad(
        loaded.turnRows.length + loaded.detailRows.length,
        performance.now() - startedAt,
      );
      return loaded;
    },
    async loadAuthoritativeFacts(connectionId, threadId, incomingTurnIds) {
      const [meta, families] = await Promise.all([
        this.loadThreadMeta(connectionId, threadId),
        loadTurnFamilies(query, connectionId, threadId, incomingTurnIds),
      ]);
      const historyEpoch = meta?.historyEpoch ?? 0;
      const latest = await this.loadBoundary(connectionId, threadId, historyEpoch, "desc");
      const incomingOrdinalById = new Map(
        families.flatMap((row) =>
          row.kind === "turn" && row.historyEpoch === historyEpoch && row.remoteTurnId !== null
            ? [[row.remoteTurnId, row.ordinal] as const]
            : [],
        ),
      );
      const overlapIndex = incomingTurnIds.findIndex((turnId) => incomingOrdinalById.has(turnId));
      let occupied: ThreadDetailRow[] = [];
      if (overlapIndex >= 0) {
        const overlapTurnId = incomingTurnIds[overlapIndex];
        const overlapOrdinal =
          overlapTurnId === undefined ? undefined : incomingOrdinalById.get(overlapTurnId);
        if (overlapOrdinal === undefined) {
          throw new Error("Overlapping thread history turn has no ordinal");
        }
        const baseOrdinal = overlapOrdinal - overlapIndex;
        occupied = await query(
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND p.ordinal >= ? AND p.ordinal <= ?`,
          [
            connectionId,
            threadId,
            historyEpoch,
            baseOrdinal,
            baseOrdinal + incomingTurnIds.length - 1,
          ],
        );
      }
      return deduplicateRows([
        ...(meta === null ? [] : [meta]),
        ...families,
        ...(latest === null ? [] : [latest]),
        ...occupied,
      ]);
    },
    // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
    // oxlint-disable-next-line eslint/max-params
    async loadBoundary(connectionId, threadId, historyEpoch, direction) {
      return queryOne(
        `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1 ORDER BY p.ordinal ${direction === "asc" ? "ASC" : "DESC"}, p.turn_id ${direction === "asc" ? "ASC" : "DESC"} LIMIT 1`,
        [connectionId, threadId, historyEpoch],
      );
    },
    // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
    // oxlint-disable-next-line eslint/max-params
    async loadPrependFacts(connectionId, threadId, historyEpoch, turnIds) {
      const [families, minimum] = await Promise.all([
        loadTurnFamilies(query, connectionId, threadId, turnIds),
        this.loadBoundary(connectionId, threadId, historyEpoch, "asc"),
      ]);
      return deduplicateRows([...families, ...(minimum === null ? [] : [minimum])]);
    },
    async loadResolvedWindow({ anchorTurnId, connectionId, newerBuffer, threadId, turnLimit }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const loaded = await database.transaction(async (executor) => {
        const result = await executor.execute(resolvedHistoryWindowSql(), [
          connectionId,
          threadId,
          anchorTurnId,
          turnLimit,
          newerBuffer,
        ]);
        return parseResolvedWindowRows(extractRows(result));
      });
      recordSqliteSubsetLoad(
        loaded.turnRows.length + loaded.detailRows.length + loaded.liveRows.length,
        performance.now() - startedAt,
      );
      return loaded;
    },
    async loadThreadMeta(connectionId, threadId) {
      return queryOne(historyMetaSql, [connectionId, threadId]);
    },
    // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
    // oxlint-disable-next-line eslint/max-params
    async loadTurn(connectionId, threadId, turnId, historyEpoch) {
      return queryOne(
        `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.turn_id = ? AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1 LIMIT 1`,
        [connectionId, threadId, turnId, historyEpoch],
      );
    },
    async loadWindow({ connectionId, historyEpoch, maxOrdinal, threadId, turnLimit }) {
      await ensurePrepared();
      await flushPending();
      const startedAt = performance.now();
      const result = await database.transaction(async (executor) => {
        const turnParams: SqliteValue[] = [connectionId, threadId, historyEpoch];
        const maxClause = maxOrdinal === null ? "" : ` AND p.ordinal <= ?`;
        if (maxOrdinal !== null) {
          turnParams.push(maxOrdinal);
        }
        turnParams.push(turnLimit);
        const turnRows = await executeRows(
          executor,
          `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.kind = 'turn' AND c.sealed = 1${maxClause} ORDER BY p.ordinal DESC, p.turn_id DESC LIMIT ?`,
          turnParams,
        );
        const ordinals = turnRows.map(({ ordinal }) => ordinal);
        const detailRows =
          ordinals.length === 0
            ? []
            : await executeRows(
                executor,
                `SELECT ${historyMemberPayload} AS __payload FROM ${historyMemberSource} WHERE ${historyScope} AND p.history_epoch = ? AND c.sealed = 1 AND c.kind IN ('turnMeta', 'activity') AND p.ordinal >= ? AND p.ordinal <= ?`,
                [
                  connectionId,
                  threadId,
                  historyEpoch,
                  Math.min(...ordinals),
                  Math.max(...ordinals),
                ],
              );
        const liveRows = await executeRows(executor, historyLiveSql, [
          connectionId,
          threadId,
          historyEpoch,
        ]);
        return { detailRows, liveRows, turnRows };
      });
      recordSqliteSubsetLoad(
        result.turnRows.length + result.detailRows.length + result.liveRows.length,
        performance.now() - startedAt,
      );
      return result;
    },
    prepare: ensurePrepared,
    rollback() {
      // Rollback is deliberately idempotent. A caller may be recovering from
      // a synchronous commit callback failure after commit already released
      // the staging map.
      currentChanges = null;
    },
    write(change) {
      if (currentChanges === null) {
        throw new Error("Thread detail SQLite transaction is not open");
      }
      const key = change.type === "delete" ? change.key : change.value.id;
      currentChanges.set(key, change);
    },
  };
}

function isUnconfirmedReceiptRow(
  row: ThreadDetailRow | undefined,
  receipt: CommandReceipt,
): row is ThreadDetailRow & { kind: "pending"; pending: PendingTimelineEntry } {
  const pendingEntry = row?.pending;
  return (
    row?.kind === "pending" &&
    pendingEntry !== null &&
    pendingEntry !== undefined &&
    pendingEntry.commandId === receipt.commandId &&
    pendingEntry.confirmation === undefined
  );
}

async function prepareSchema(
  database: ReturnType<typeof getUiCacheSqliteDatabase>,
): Promise<ThreadDetailSqliteMaintenance> {
  return database.transaction(async (executor) => {
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

function parseResolvedWindowRows(
  rows: readonly Record<string, SqliteValue>[],
): ResolvedThreadDetailWindow {
  const metadata = rows.find(({ bucket }) => bucket === "meta");
  const historyEpoch = numericSqliteValue(metadata?.history_epoch) ?? 0;
  return {
    detailRows: rows.filter(({ bucket }) => bucket === "detail").map(parsePayload),
    earliestSealedOrdinal: numericSqliteValue(metadata?.earliest_ordinal),
    historyEpoch,
    latestSealedOrdinal: numericSqliteValue(metadata?.latest_ordinal),
    liveRows: rows.filter(({ bucket }) => bucket === "live").map(parsePayload),
    turnRows: rows.filter(({ bucket }) => bucket === "turn").map(parsePayload),
  };
}

export async function rotateHistoryCache(
  executor: Executor,
  limits: {
    hardLimitBytes: number;
    softLimitBytes: number;
  } = {
    hardLimitBytes: HISTORY_CACHE_HARD_LIMIT_BYTES,
    softLimitBytes: HISTORY_CACHE_SOFT_LIMIT_BYTES,
  },
): Promise<Pick<ThreadDetailSqliteMaintenance, "historyFamiliesEvicted" | "historyBytesEvicted">> {
  // Scan orphan references only during bounded cache maintenance, never per live patch.
  await collectUnreferencedHistoryContent(executor);
  const currentBytes = await readHistoryPayloadBytes(executor);
  if (currentBytes <= limits.hardLimitBytes) {
    return { historyBytesEvicted: 0, historyFamiliesEvicted: 0 };
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
  const selected = extractRows(
    await executor.execute(
      `${candidateCte} SELECT COUNT(*) AS "family_count", COALESCE(SUM("payload_bytes"), 0) AS "payload_bytes" FROM "chosen"`,
      [reclaimBytes],
    ),
  )[0];
  const historyFamiliesEvicted = numericSqliteValue(selected?.family_count) ?? 0;
  const historyBytesEvicted = numericSqliteValue(selected?.payload_bytes) ?? 0;
  if (historyFamiliesEvicted === 0) {
    return { historyBytesEvicted, historyFamiliesEvicted };
  }
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
  return { historyBytesEvicted, historyFamiliesEvicted };
}

async function collectDiagnostics(
  database: ReturnType<typeof getUiCacheSqliteDatabase>,
): Promise<Omit<ThreadDetailSqliteDiagnostics, keyof ThreadDetailSqliteMaintenance>> {
  const [sqlite, files] = await Promise.all([
    // WHY: This transaction captures one internally consistent diagnostic snapshot across related
    // cache tables; splitting the reads could report counts from different commits.
    // oxlint-disable-next-line eslint/complexity
    database.transaction(async (executor) => {
      const totals = extractRows(
        await executor.execute(
          `SELECT
          COUNT(*) AS "row_count",
          COALESCE(SUM(CASE WHEN "kind" = 'pending' THEN 1 ELSE 0 END), 0) AS "pending_rows"
         FROM "${TABLE}"`,
        ),
      )[0];
      const historyPayloadBytes = await readHistoryPayloadBytes(executor);
      const otherPayloadBytes =
        numericSqliteValue(
          extractRows(
            await executor.execute(
              `SELECT COALESCE(SUM(LENGTH(CAST("__payload" AS BLOB))), 0) AS "other_payload_bytes"
         FROM "${TABLE}"
         WHERE "sealed" = 0 OR "kind" NOT IN ('turn', 'turnMeta', 'activity')`,
            ),
          )[0]?.other_payload_bytes,
        ) ?? 0;
      const pendingDeliveryRows = (
        await executeRows(
          executor,
          `SELECT "__payload" FROM "${TABLE}" WHERE "kind" = 'pending'`,
          [],
        )
      ).filter((row) => row.pending?.presentation === "delivery").length;
      const pageCount =
        numericSqliteValue(
          extractRows(await executor.execute("PRAGMA page_count"))[0]?.page_count,
        ) ?? 0;
      const freePages =
        numericSqliteValue(
          extractRows(await executor.execute("PRAGMA freelist_count"))[0]?.freelist_count,
        ) ?? 0;
      const pageSize =
        numericSqliteValue(extractRows(await executor.execute("PRAGMA page_size"))[0]?.page_size) ??
        0;
      return {
        historyPayloadBytes,
        payloadBytes: historyPayloadBytes + otherPayloadBytes,
        pendingDeliveryRows,
        pendingRows: numericSqliteValue(totals?.pending_rows) ?? 0,
        physicalBytes: pageCount * pageSize,
        reusableBytes: freePages * pageSize,
        rowCount: numericSqliteValue(totals?.row_count) ?? 0,
      };
    }),
    getUiCacheFileDiagnostics(),
  ]);
  return { ...sqlite, ...files };
}

export async function prepareHistoryCacheAccounting(executor: Executor): Promise<void> {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS "${CACHE_META_TABLE}" (` +
      `"singleton" INTEGER PRIMARY KEY NOT NULL CHECK("singleton" = 1), ` +
      `"history_bytes" INTEGER NOT NULL)`,
  );
  const present =
    extractRows(
      await executor.execute(
        `SELECT 1 AS "present" FROM "${CACHE_META_TABLE}" WHERE "singleton" = 1`,
      ),
    ).length > 0;
  if (!present) {
    await executor.execute(
      `INSERT INTO "${CACHE_META_TABLE}" ("singleton", "history_bytes") ` +
        `SELECT 1, COALESCE(SUM("payload_bytes"), 0) ` +
        `FROM "${CONTENT_TABLE}" WHERE "sealed" = 1`,
    );
  }
  const newHistory = `NEW."sealed" = 1 AND NEW."kind" IN ('turn', 'turnMeta', 'activity')`;
  const oldHistory = `OLD."sealed" = 1 AND OLD."kind" IN ('turn', 'turnMeta', 'activity')`;
  await executor.execute(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENT_TABLE}__cache_insert" AFTER INSERT ON "${CONTENT_TABLE}" ` +
      `WHEN ${newHistory} BEGIN ` +
      `UPDATE "${CACHE_META_TABLE}" SET "history_bytes" = "history_bytes" + NEW."payload_bytes" WHERE "singleton" = 1; END`,
  );
  await executor.execute(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENT_TABLE}__cache_delete" AFTER DELETE ON "${CONTENT_TABLE}" ` +
      `WHEN ${oldHistory} BEGIN ` +
      `UPDATE "${CACHE_META_TABLE}" SET "history_bytes" = MAX(0, "history_bytes" - OLD."payload_bytes") WHERE "singleton" = 1; END`,
  );
  await executor.execute(
    `CREATE TRIGGER IF NOT EXISTS "${CONTENT_TABLE}__cache_update" AFTER UPDATE ON "${CONTENT_TABLE}" BEGIN ` +
      `UPDATE "${CACHE_META_TABLE}" SET "history_bytes" = MAX(0, "history_bytes" ` +
      `- CASE WHEN ${oldHistory} THEN OLD."payload_bytes" ELSE 0 END ` +
      `+ CASE WHEN ${newHistory} THEN NEW."payload_bytes" ELSE 0 END) ` +
      `WHERE "singleton" = 1; END`,
  );
}

async function readHistoryPayloadBytes(executor: Executor): Promise<number> {
  return (
    numericSqliteValue(
      extractRows(
        await executor.execute(
          `SELECT "history_bytes" FROM "${CACHE_META_TABLE}" WHERE "singleton" = 1`,
        ),
      )[0]?.history_bytes,
    ) ?? 0
  );
}

function numericSqliteValue(value: SqliteValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function executeRows(
  executor: Executor,
  sql: string,
  params: readonly SqliteValue[],
): Promise<ThreadDetailRow[]> {
  return extractRows(await executor.execute(sql, params)).map(parsePayload);
}

// WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
// oxlint-disable-next-line eslint/max-params
async function loadTurnFamilies(
  query: (sql: string, params: readonly SqliteValue[]) => Promise<ThreadDetailRow[]>,
  connectionId: string,
  threadId: string,
  turnIds: readonly string[],
): Promise<ThreadDetailRow[]> {
  if (turnIds.length === 0) {
    return [];
  }
  return query(
    `SELECT ${historyMemberPayload} AS __payload FROM ${retainedHistoryMemberSource}
      WHERE ${historyScope} AND p.turn_id IN (${turnIds.map(() => "?").join(", ")})
      ORDER BY CASE WHEN p.history_epoch=h.active_epoch THEN 1 ELSE 0 END ASC,
        p.history_epoch ASC,c.content_id ASC`,
    [connectionId, threadId, ...turnIds],
  );
}

// WHY: This boundary validates and constructs one complete persisted or native payload atomically; its field precedence must remain in one owner.
// oxlint-disable-next-line eslint/complexity
function parsePayload(row: Record<string, SqliteValue>): ThreadDetailRow {
  const payload = row.__payload;
  if (typeof payload !== "string") {
    throw new Error("Thread detail SQLite row has no payload");
  }
  const parsed: unknown = JSON.parse(payload);
  const record = unknownRecord(parsed);
  if (
    record === null ||
    typeof record.id !== "string" ||
    typeof record.connectionId !== "string" ||
    typeof record.remoteThreadId !== "string" ||
    typeof record.historyEpoch !== "number" ||
    typeof record.ordinal !== "number" ||
    typeof record.lastOpenedAt !== "number" ||
    typeof record.sealed !== "boolean" ||
    !(
      record.kind === "thread" ||
      record.kind === "turn" ||
      record.kind === "turnMeta" ||
      record.kind === "activity" ||
      record.kind === "pending"
    )
  ) {
    throw new Error("Thread detail SQLite payload is invalid");
  }
  // WHY: this cache stores protocol Thread and Turn graphs that were validated before persistence.
  // The structural cache envelope above is checked here; duplicating the generated protocol decoder
  // would create a second wire authority for reconstructable local rows.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return record as ThreadDetailRow;
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  return sqliteRows(result);
}

function deduplicateRows(rows: readonly ThreadDetailRow[]): ThreadDetailRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function storageKey(key: string): string {
  return `string:${key}`;
}

async function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
