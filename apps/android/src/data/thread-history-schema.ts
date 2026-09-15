import type { HistoryExecutor } from "./thread-history-sql-contract";

/** Reconstructs only the requested revision; items keep their own ordered rows. */
export function historyContentPayload(alias = "c"): string {
  const items = `json(COALESCE((SELECT json_group_array(json(payload)) FROM
    (SELECT payload FROM codewide_history_items WHERE content_id=${alias}.content_id ORDER BY position)), '[]'))`;
  return `CASE ${alias}.kind
    WHEN 'turn' THEN json_set(${alias}.payload, '$.turn.items', ${items})
    WHEN 'activity' THEN json_set(${alias}.payload, '$.activityItems', ${items})
    ELSE ${alias}.payload END`;
}

/** Upgrades v5 in the caller's transaction, including inactive chain revisions. */
export async function migrateHistoryV6(executor: HistoryExecutor): Promise<void> {
  await executor.execute("DROP VIEW IF EXISTS codewide_thread_details");
  await executor.execute("DROP TRIGGER IF EXISTS codewide_history_revision_replaced");
  for (const suffix of ["insert", "delete", "update"]) {
    await executor.execute(`DROP TRIGGER IF EXISTS codewide_history_content__cache_${suffix}`);
  }
  await executor.execute("DROP TABLE IF EXISTS codewide_thread_detail_cache_meta");
  await executor.execute(
    `ALTER TABLE codewide_history_content ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK(payload_bytes >= 0)`,
  );
  // SQLite composite references require a matching unique parent key; the
  // content_id primary key alone cannot enforce membership scope/identity.
  await executor.execute(`CREATE UNIQUE INDEX codewide_history_content_identity
    ON codewide_history_content(content_id, connection_id, thread_id, turn_id, __key)`);
  await executor.execute(`CREATE TABLE codewide_history_items (
    content_id INTEGER NOT NULL REFERENCES codewide_history_content(content_id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0), item_id TEXT NOT NULL, kind TEXT NOT NULL,
    payload TEXT NOT NULL, PRIMARY KEY(content_id, position))`);
  await executor.execute(`INSERT INTO codewide_history_items
    SELECT c.content_id, j.key, json_extract(j.value, '$.id'), json_extract(j.value, '$.type'), j.value
    FROM codewide_history_content c, json_each(c.payload,
      CASE c.kind WHEN 'turn' THEN '$.turn.items' ELSE '$.activityItems' END) j
    WHERE c.kind IN ('turn','activity')`);
  await executor.execute(`UPDATE codewide_history_content SET payload_bytes=LENGTH(CAST(payload AS BLOB)),
    payload=CASE kind WHEN 'turn' THEN json_remove(payload, '$.turn.items')
      WHEN 'activity' THEN json_remove(payload, '$.activityItems') ELSE payload END`);
  await executor.execute(`CREATE TABLE codewide_history_turns (
    connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_epoch INTEGER NOT NULL,
    turn_id TEXT NOT NULL, ordinal REAL NOT NULL,
    PRIMARY KEY(connection_id, thread_id, history_epoch, turn_id),
    FOREIGN KEY(connection_id, thread_id, history_epoch)
      REFERENCES codewide_history_chains(connection_id, thread_id, history_epoch) ON DELETE CASCADE)`);
  // A canonical turn owns position. An overlay-only cache fragment retains its
  // old position until that turn arrives; this does not invent a missing turn.
  await executor.execute(`INSERT INTO codewide_history_turns
    SELECT m.connection_id, m.thread_id, m.history_epoch, c.turn_id,
      COALESCE(MAX(CASE WHEN c.kind='turn' THEN m.ordinal END), MIN(m.ordinal))
    FROM codewide_history_members m JOIN codewide_history_content c USING(content_id)
    GROUP BY m.connection_id, m.thread_id, m.history_epoch, c.turn_id`);
  await executor.execute(`CREATE TABLE codewide_history_members_v6 (
    connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_epoch INTEGER NOT NULL,
    __key TEXT NOT NULL, content_id INTEGER NOT NULL, turn_id TEXT NOT NULL,
    PRIMARY KEY(connection_id, thread_id, history_epoch, __key),
    FOREIGN KEY(connection_id, thread_id, history_epoch, turn_id)
      REFERENCES codewide_history_turns(connection_id, thread_id, history_epoch, turn_id) ON DELETE CASCADE,
    FOREIGN KEY(content_id, connection_id, thread_id, turn_id, __key)
      REFERENCES codewide_history_content(content_id, connection_id, thread_id, turn_id, __key))`);
  await executor.execute(`INSERT INTO codewide_history_members_v6
    SELECT m.connection_id, m.thread_id, m.history_epoch, m.__key, m.content_id, c.turn_id
    FROM codewide_history_members m JOIN codewide_history_content c USING(content_id)`);
  await executor.execute("DROP TABLE codewide_history_members");
  await executor.execute(
    "ALTER TABLE codewide_history_members_v6 RENAME TO codewide_history_members",
  );
  await executor.execute(
    `CREATE INDEX codewide_history_members_key ON codewide_history_members(__key)`,
  );
  await executor.execute(
    `CREATE INDEX codewide_history_members_content ON codewide_history_members(content_id)`,
  );
  await executor.execute(`CREATE INDEX codewide_history_members_turn
    ON codewide_history_members(connection_id, thread_id, history_epoch, turn_id)`);
  await executor.execute(`CREATE INDEX codewide_history_turns_order
    ON codewide_history_turns(connection_id, thread_id, history_epoch, ordinal, turn_id)`);
  await executor.execute(
    `CREATE INDEX codewide_history_pending_scope ON codewide_history_pending(connection_id, thread_id)`,
  );
  await executor.execute(`CREATE INDEX codewide_history_content_live
    ON codewide_history_content(connection_id, thread_id, content_id) WHERE sealed=0`);
  await executor.execute(`CREATE TRIGGER codewide_history_revision_replaced
    AFTER UPDATE OF content_id ON codewide_history_members WHEN OLD.content_id != NEW.content_id BEGIN
      DELETE FROM codewide_history_content WHERE content_id=OLD.content_id
        AND NOT EXISTS (SELECT 1 FROM codewide_history_members WHERE content_id=OLD.content_id);
    END`);
}
