import type { ThreadDetailRow } from "./thread-detail-projection";
import { historyContentPayload, migrateHistoryV6 } from "./thread-history-schema";

import type { HistoryExecutor } from "./thread-history-sql-contract";

export type { HistoryExecutor } from "./thread-history-sql-contract";

const HEADS = "codewide_history_heads";
const CHAINS = "codewide_history_chains";
const CONTENT = "codewide_history_content";
const MEMBERS = "codewide_history_members";
const PENDING = "codewide_history_pending";
const VIEW = "codewide_thread_details";
const VERSION = 6;
// Historical V1 cache identity; unrelated to the separate Android V2 runtime.
const RUNTIME = "thread-details-v2";
const META = "__tanstack_db_sqlite_meta";

function rows(result: unknown): readonly Record<string, unknown>[] {
  const value = Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null && "rows" in result
      ? result.rows
      : [];
  if (!Array.isArray(value)) throw new Error("Invalid history SQL result");
  return value.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function headPayload(expression: string): string {
  return `json_remove(${expression}, '$.historyEpoch', '$.historyCursor', '$.historyHadTurns', '$.historyCoverageMinOrdinal', '$.historyCoverageMaxOrdinal')`;
}

async function createTables(executor: HistoryExecutor): Promise<void> {
  await executor.execute(`CREATE TABLE IF NOT EXISTS ${HEADS} (
    __key TEXT PRIMARY KEY, connection_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    active_epoch INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(connection_id, thread_id),
    FOREIGN KEY(connection_id, thread_id, active_epoch) REFERENCES ${CHAINS}(connection_id, thread_id, history_epoch))`);
  await executor.execute(`CREATE TABLE IF NOT EXISTS ${CHAINS} (
    connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_epoch INTEGER NOT NULL,
    cursor TEXT, cursor_known INTEGER NOT NULL DEFAULT 0, had_turns INTEGER,
    min_ordinal REAL, min_known INTEGER NOT NULL DEFAULT 0,
    max_ordinal REAL, max_known INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(connection_id, thread_id, history_epoch))`);
  await executor.execute(`CREATE TABLE IF NOT EXISTS ${CONTENT} (
    content_id INTEGER PRIMARY KEY AUTOINCREMENT, __key TEXT NOT NULL,
    connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('turn', 'turnMeta', 'activity')),
    sealed INTEGER NOT NULL, payload TEXT NOT NULL)`);
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS ${CONTENT}_key ON ${CONTENT}(__key, content_id DESC)`,
  );
  await executor.execute(`CREATE TABLE IF NOT EXISTS ${MEMBERS} (
    connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_epoch INTEGER NOT NULL,
    __key TEXT NOT NULL, content_id INTEGER NOT NULL REFERENCES ${CONTENT}(content_id), ordinal REAL NOT NULL,
    PRIMARY KEY(connection_id, thread_id, history_epoch, __key),
    FOREIGN KEY(connection_id, thread_id, history_epoch) REFERENCES ${CHAINS}(connection_id, thread_id, history_epoch))`);
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS ${MEMBERS}_range ON ${MEMBERS}(connection_id, thread_id, history_epoch, ordinal)`,
  );
  await executor.execute(`CREATE INDEX IF NOT EXISTS ${MEMBERS}_content ON ${MEMBERS}(content_id)`);
  await executor.execute(`CREATE TABLE IF NOT EXISTS ${PENDING} (
    __key TEXT PRIMARY KEY, connection_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    history_epoch INTEGER NOT NULL, ordinal REAL NOT NULL, payload TEXT NOT NULL)`);
  // Streaming changes only one reference. Collect that superseded revision by
  // primary key instead of scanning the history cache on every checkpoint.
  await executor.execute(`CREATE TRIGGER IF NOT EXISTS codewide_history_revision_replaced
    AFTER UPDATE OF content_id ON ${MEMBERS} WHEN OLD.content_id != NEW.content_id BEGIN
      DELETE FROM ${CONTENT} WHERE content_id=OLD.content_id
        AND NOT EXISTS (SELECT 1 FROM ${MEMBERS} WHERE content_id=OLD.content_id);
    END`);
}

async function migrateRows(executor: HistoryExecutor): Promise<void> {
  // SQL performs the split without materializing the potentially multi-GiB cache in JS.
  await executor.execute(`INSERT INTO ${CHAINS}(connection_id, thread_id, history_epoch)
    SELECT DISTINCT connection_id, thread_id, history_epoch FROM ${VIEW} WHERE kind != 'pending'`);
  await executor.execute(`INSERT INTO ${HEADS} SELECT __key, connection_id, thread_id, history_epoch,
    ${headPayload("__payload")} FROM ${VIEW} WHERE kind = 'thread'`);
  await executor.execute(`INSERT INTO ${CHAINS}
    SELECT connection_id, thread_id, history_epoch,
      json_extract(__payload, '$.historyCursor'), json_type(__payload, '$.historyCursor') IS NOT NULL,
      json_extract(__payload, '$.historyHadTurns'),
      json_extract(__payload, '$.historyCoverageMinOrdinal'), json_type(__payload, '$.historyCoverageMinOrdinal') IS NOT NULL,
      json_extract(__payload, '$.historyCoverageMaxOrdinal'), json_type(__payload, '$.historyCoverageMaxOrdinal') IS NOT NULL
    FROM ${VIEW} WHERE kind = 'thread'
    ON CONFLICT(connection_id, thread_id, history_epoch) DO UPDATE SET
      cursor=excluded.cursor, cursor_known=excluded.cursor_known, had_turns=excluded.had_turns,
      min_ordinal=excluded.min_ordinal, min_known=excluded.min_known,
      max_ordinal=excluded.max_ordinal, max_known=excluded.max_known`);
  await executor.execute(`INSERT INTO ${CONTENT}(content_id, __key, connection_id, thread_id, turn_id, kind, sealed, payload)
    SELECT rowid, __key, connection_id, thread_id, turn_id, kind, sealed,
      json_remove(__payload, '$.historyEpoch', '$.ordinal')
    FROM ${VIEW} WHERE kind IN ('turn', 'turnMeta', 'activity') ORDER BY rowid`);
  await executor.execute(`INSERT INTO ${MEMBERS}
    SELECT connection_id, thread_id, history_epoch, __key, rowid, ordinal
    FROM ${VIEW} WHERE kind IN ('turn', 'turnMeta', 'activity')`);
  await executor.execute(`INSERT INTO ${PENDING}
    SELECT __key, connection_id, thread_id, history_epoch, ordinal, __payload FROM ${VIEW} WHERE kind = 'pending'`);
  // A failed migration rolls back this drop together with every preceding insert.
  await executor.execute(`DROP TABLE ${VIEW}`);
  await executor.execute(`DROP TABLE IF EXISTS codewide_thread_detail_cache_meta`);
}

/** Metadata projection shared by the compatibility view and scoped native reads. */
export function historyHeadPayload(): string {
  return `json_remove(json_set(h.payload,
    '$.historyEpoch', h.active_epoch,
    '$.historyCursor', g.cursor, '$.historyHadTurns', json(CASE g.had_turns WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END),
    '$.historyCoverageMinOrdinal', g.min_ordinal, '$.historyCoverageMaxOrdinal', g.max_ordinal),
    CASE WHEN g.cursor_known = 0 THEN '$.historyCursor' ELSE '$.__absent' END,
    CASE WHEN g.had_turns IS NULL THEN '$.historyHadTurns' ELSE '$.__absent' END,
    CASE WHEN g.min_known = 0 THEN '$.historyCoverageMinOrdinal' ELSE '$.__absent' END,
    CASE WHEN g.max_known = 0 THEN '$.historyCoverageMaxOrdinal' ELSE '$.__absent' END)`;
}

async function createReadProjection(executor: HistoryExecutor): Promise<void> {
  const metadata = historyHeadPayload();
  // Only membership in the active chain reaches the legacy row projection.
  // Content identity and revisions have no generation or position of their own.
  await executor.execute(`CREATE VIEW IF NOT EXISTS ${VIEW} AS
    SELECT h.rowid AS rowid, h.__key, ${metadata} AS __payload,
      h.connection_id, h.thread_id, NULL AS turn_id, h.active_epoch AS history_epoch,
      'thread' AS kind, 0 AS ordinal, 0 AS sealed
    FROM ${HEADS} h JOIN ${CHAINS} g ON g.connection_id=h.connection_id AND g.thread_id=h.thread_id AND g.history_epoch=h.active_epoch
    UNION ALL
    SELECT c.content_id, m.__key, json_set(${historyContentPayload()}, '$.historyEpoch', m.history_epoch, '$.ordinal', p.ordinal),
      m.connection_id, m.thread_id, c.turn_id, m.history_epoch, c.kind, p.ordinal, c.sealed
    FROM ${MEMBERS} m JOIN ${CONTENT} c ON c.content_id=m.content_id
      JOIN codewide_history_turns p ON p.connection_id=m.connection_id AND p.thread_id=m.thread_id
        AND p.history_epoch=m.history_epoch AND p.turn_id=m.turn_id
      JOIN ${HEADS} h ON h.connection_id=m.connection_id AND h.thread_id=m.thread_id AND h.active_epoch=m.history_epoch
    UNION ALL
    SELECT rowid, __key, payload, connection_id, thread_id, NULL, history_epoch, 'pending', ordinal, 0 FROM ${PENDING}`);
  // Cache eviction removes an entire content identity, including inactive references.
  // Deleting a history head does not own or cancel local delivery intents.
  await executor.execute(`CREATE TRIGGER IF NOT EXISTS codewide_history_delete INSTEAD OF DELETE ON ${VIEW} BEGIN
    DELETE FROM ${MEMBERS} WHERE __key=OLD.__key;
    DELETE FROM ${CONTENT} WHERE __key=OLD.__key;
    DELETE FROM ${PENDING} WHERE __key=OLD.__key;
    DELETE FROM ${HEADS} WHERE __key=OLD.__key;
    DELETE FROM ${CHAINS} WHERE OLD.kind='thread' AND connection_id=OLD.connection_id AND thread_id=OLD.thread_id;
  END`);
}

/** Non-destructive v4/v5-to-v6 migration; invoke inside one SQLite transaction. */
export async function prepareHistoryRelations(executor: HistoryExecutor): Promise<void> {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS ${META} (runtime_id TEXT PRIMARY KEY NOT NULL, schema_version INTEGER NOT NULL)`,
  );
  const version = rows(
    await executor.execute(`SELECT schema_version FROM ${META} WHERE runtime_id=?`, [RUNTIME]),
  )[0]?.schema_version;
  if (
    version !== undefined &&
    (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > VERSION)
  ) {
    throw new Error("Unsupported thread history schema version");
  }
  const legacy =
    rows(await executor.execute(`SELECT type FROM sqlite_master WHERE name=?`, [VIEW]))[0]?.type ===
    "table";
  if (version !== VERSION) {
    await createTables(executor);
    if (legacy) await migrateRows(executor);
    await migrateHistoryV6(executor);
  }
  await createReadProjection(executor);
  await executor.execute(
    `INSERT INTO ${META}(runtime_id, schema_version) VALUES (?, ?)
    ON CONFLICT(runtime_id) DO UPDATE SET schema_version=excluded.schema_version`,
    [RUNTIME, VERSION],
  );
}

/** Stores chain facts independently from content; unchanged payloads retain their revision. */
export async function persistHistoryRow(
  executor: HistoryExecutor,
  row: ThreadDetailRow,
): Promise<void> {
  const key = `string:${row.id}`;
  if (row.kind === "pending") {
    // A canonical receipt survives late off-window native/queue mirrors. Only
    // canonical content taking over this identity may retire the authored row.
    await executor.execute(
      `INSERT INTO ${PENDING} SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM ${CONTENT} WHERE __key=? AND kind='turn')
      ON CONFLICT(__key) DO UPDATE SET payload=excluded.payload, ordinal=excluded.ordinal, history_epoch=excluded.history_epoch
      WHERE json_type(${PENDING}.payload, '$.pending.confirmation') IS NULL`,
      [
        key,
        row.connectionId,
        row.remoteThreadId,
        row.historyEpoch,
        row.ordinal,
        JSON.stringify(row),
        key,
      ],
    );
    return;
  }
  await executor.execute(
    `INSERT INTO ${CHAINS}(connection_id, thread_id, history_epoch) VALUES (?, ?, ?)
    ON CONFLICT(connection_id, thread_id, history_epoch) DO NOTHING`,
    [row.connectionId, row.remoteThreadId, row.historyEpoch],
  );
  if (row.kind === "thread") {
    const {
      historyEpoch,
      historyCursor,
      historyHadTurns,
      historyCoverageMinOrdinal,
      historyCoverageMaxOrdinal,
      ...content
    } = row;
    await executor.execute(
      `INSERT INTO ${CHAINS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, thread_id, history_epoch) DO UPDATE SET
        cursor=excluded.cursor, cursor_known=excluded.cursor_known, had_turns=excluded.had_turns,
        min_ordinal=excluded.min_ordinal, min_known=excluded.min_known, max_ordinal=excluded.max_ordinal, max_known=excluded.max_known`,
      [
        row.connectionId,
        row.remoteThreadId,
        historyEpoch,
        historyCursor ?? null,
        historyCursor === undefined ? 0 : 1,
        historyHadTurns === undefined ? null : historyHadTurns ? 1 : 0,
        historyCoverageMinOrdinal ?? null,
        historyCoverageMinOrdinal === undefined ? 0 : 1,
        historyCoverageMaxOrdinal ?? null,
        historyCoverageMaxOrdinal === undefined ? 0 : 1,
      ],
    );
    await executor.execute(
      `INSERT INTO ${HEADS} VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(__key) DO UPDATE SET active_epoch=excluded.active_epoch, payload=excluded.payload`,
      [key, row.connectionId, row.remoteThreadId, historyEpoch, JSON.stringify(content)],
    );
    return;
  }
  const { historyEpoch, ordinal, ...content } = row;
  const payload = JSON.stringify(content);
  const items = JSON.stringify(
    row.kind === "turn"
      ? (row.turn?.items ?? [])
      : row.kind === "activity"
        ? (row.activityItems ?? [])
        : [],
  );
  const envelope = `CASE ? WHEN 'turn' THEN json_remove(?, '$.turn.items')
    WHEN 'activity' THEN json_remove(?, '$.activityItems') ELSE ? END`;
  let contentId = rows(
    await executor.execute(
      `SELECT content_id FROM ${CONTENT} c
    WHERE __key=? AND payload=(${envelope}) AND COALESCE((SELECT json_group_array(json(payload))
      FROM (SELECT payload FROM codewide_history_items WHERE content_id=c.content_id ORDER BY position)), '[]')=json(?)
    ORDER BY content_id DESC LIMIT 1`,
      [key, row.kind, payload, payload, payload, items],
    ),
  )[0]?.content_id;
  if (contentId === undefined) {
    contentId = rows(
      await executor.execute(
        `INSERT INTO ${CONTENT}
      (__key, connection_id, thread_id, turn_id, kind, sealed, payload, payload_bytes)
      VALUES (?, ?, ?, ?, ?, ?, (${envelope}), LENGTH(CAST(? AS BLOB))) RETURNING content_id`,
        [
          key,
          row.connectionId,
          row.remoteThreadId,
          row.remoteTurnId,
          row.kind,
          row.sealed ? 1 : 0,
          row.kind,
          payload,
          payload,
          payload,
          payload,
        ],
      ),
    )[0]?.content_id;
    if (typeof contentId !== "number")
      throw new Error("History revision insert returned no identity");
    await executor.execute(
      `INSERT INTO codewide_history_items
      SELECT ?, j.key, json_extract(j.value, '$.id'), json_extract(j.value, '$.type'), j.value FROM json_each(?) j`,
      [contentId, items],
    );
  }
  if (typeof contentId !== "number") throw new Error("Invalid history revision identity");
  await executor.execute(
    `INSERT INTO codewide_history_turns VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, thread_id, history_epoch, turn_id) DO UPDATE SET ordinal=excluded.ordinal
      WHERE ?='turn'`,
    [row.connectionId, row.remoteThreadId, historyEpoch, row.remoteTurnId, ordinal, row.kind],
  );
  await executor.execute(
    `INSERT INTO ${MEMBERS} VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, thread_id, history_epoch, __key) DO UPDATE SET content_id=excluded.content_id`,
    [row.connectionId, row.remoteThreadId, historyEpoch, key, contentId, row.remoteTurnId],
  );
  await executor.execute(`DELETE FROM ${PENDING} WHERE __key=?`, [key]);
}

/** Removes superseded content revisions without touching a revision shared by chains. */
export async function collectUnreferencedHistoryContent(executor: HistoryExecutor): Promise<void> {
  // Keep the active chain and one fallback chain. Older epochs are disconnected
  // cache snapshots, not user-visible branches or pending delivery ownership.
  await executor.execute(`DELETE FROM ${CHAINS} AS g WHERE EXISTS (
    SELECT 1 FROM ${HEADS} h WHERE h.connection_id=g.connection_id AND h.thread_id=g.thread_id
      AND h.active_epoch != g.history_epoch
      AND g.history_epoch != (SELECT MAX(previous.history_epoch) FROM ${CHAINS} previous
        WHERE previous.connection_id=g.connection_id AND previous.thread_id=g.thread_id AND previous.history_epoch != h.active_epoch))`);
  await executor.execute(`DELETE FROM codewide_history_turns AS p WHERE NOT EXISTS (
    SELECT 1 FROM ${MEMBERS} m WHERE m.connection_id=p.connection_id AND m.thread_id=p.thread_id
      AND m.history_epoch=p.history_epoch AND m.turn_id=p.turn_id)`);
  await executor.execute(
    `DELETE FROM ${CONTENT} WHERE NOT EXISTS (SELECT 1 FROM ${MEMBERS} WHERE ${MEMBERS}.content_id=${CONTENT}.content_id)`,
  );
}
