import { parseRemoteProjects, type RemoteProject } from "./remote-projects";
import { sqliteRows } from "./sqliteResult";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

const TABLE = "codewide_remote_project_catalog";

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
          `connection_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at REAL NOT NULL)`,
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

function decodeCachedProjects(value: unknown): RemoteProject[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parseRemoteProjects({ data: parsed });
  } catch {
    return [];
  }
}

/** Point-read stale-while-refresh cache for the reconstructable project catalog. */
export const remoteProjectCatalogCache = {
  async delete(connectionId: string): Promise<void> {
    const operation = writeQueue.then(async () => {
      await ensurePrepared();
      await getDatabase().execute(`DELETE FROM ${TABLE} WHERE connection_id = ?`, [connectionId]);
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  },
  async read(connectionId: string): Promise<RemoteProject[]> {
    await ensurePrepared();
    const result = await getDatabase().execute(
      `SELECT payload FROM ${TABLE} WHERE connection_id = ? LIMIT 1`,
      [connectionId],
    );
    return decodeCachedProjects(sqliteRows(result)[0]?.payload);
  },
  async write(connectionId: string, projects: readonly RemoteProject[]): Promise<void> {
    const operation = writeQueue.then(async () => {
      await ensurePrepared();
      await getDatabase().execute(
        `INSERT INTO ${TABLE} (connection_id, payload, updated_at) VALUES (?, ?, ?) ` +
          `ON CONFLICT(connection_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        [connectionId, JSON.stringify(projects), Date.now()],
      );
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  },
};
