import type { ForgeSnapshotCache } from "./forgeSnapshotCache.types";
import { sqliteRows } from "./sqliteResult";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

const TABLE = "codewide_forge_snapshots";

let database: ReturnType<typeof getUiCacheSqliteDatabase> | null = null;
let prepared: Promise<void> | null = null;
let writeQueue = Promise.resolve();

function getDatabase(): ReturnType<typeof getUiCacheSqliteDatabase> {
  database ??= getUiCacheSqliteDatabase();
  return database;
}

async function ensurePrepared(): Promise<void> {
  if (prepared === null) {
    const attempt = getDatabase()
      .execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
          `connection_id TEXT NOT NULL, snapshot_key TEXT NOT NULL, payload TEXT NOT NULL, ` +
          `updated_at REAL NOT NULL, PRIMARY KEY (connection_id, snapshot_key))`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        if (prepared === attempt) {
          prepared = null;
        }
        throw error;
      });
    prepared = attempt;
  }
  await prepared;
}

async function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(async () => {
    await ensurePrepared();
    await operation();
  });
  writeQueue = next.catch(() => undefined);
  return next;
}

/** SQLite-backed snapshot cache in the reconstructable UI cache database. */
export const forgeSnapshotCache: ForgeSnapshotCache = {
  async deleteConnection(connectionId) {
    return enqueue(async () => {
      await getDatabase().execute(`DELETE FROM ${TABLE} WHERE connection_id = ?`, [connectionId]);
    });
  },
  async read(connectionId, key) {
    await ensurePrepared();
    const result = await getDatabase().execute(
      `SELECT payload FROM ${TABLE} WHERE connection_id = ? AND snapshot_key = ? LIMIT 1`,
      [connectionId, key],
    );
    const payload = sqliteRows(result)[0]?.payload;
    if (typeof payload !== "string") {
      return null;
    }
    try {
      const value: unknown = JSON.parse(payload);
      return value;
    } catch {
      return null;
    }
  },
  async write(connectionId, key, value) {
    return enqueue(async () => {
      const db = getDatabase();
      await db.execute(
        `INSERT INTO ${TABLE} (connection_id, snapshot_key, payload, updated_at) VALUES (?, ?, ?, ?) ` +
          `ON CONFLICT(connection_id, snapshot_key) DO UPDATE SET payload = excluded.payload, ` +
          `updated_at = excluded.updated_at`,
        [connectionId, key, JSON.stringify(value), Date.now()],
      );
    });
  },
};
