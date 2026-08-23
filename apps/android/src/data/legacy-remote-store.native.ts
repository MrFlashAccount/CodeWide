import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import type { StoredConnection } from "./connection-profile-types";

type ConnectionRow = {
  id: string;
  display_name: string;
  emoji: string;
  endpoint: string;
  tls_pin_sha256: string | null;
  enabled: number;
  sort_order: number;
  state: StoredConnection["state"];
  last_error: string | null;
  last_error_at: number | null;
};

/**
 * Read-only adapter for the pre-TanStack Expo-SQLite database.
 *
 * It deliberately does not run the old 16-step schema/FTS migration. The
 * database is only an upgrade source; current runtime state is owned by the
 * native transport stores and persisted TanStack collections.
 */
export class LegacyRemoteStore {
  static #sharedOpen: Promise<LegacyRemoteStore> | null = null;
  readonly #database: SQLite.SQLiteDatabase;
  readonly #tokenCache = new Map<string, string>();

  private constructor(database: SQLite.SQLiteDatabase) {
    this.#database = database;
  }

  static open(): Promise<LegacyRemoteStore> {
    if (this.#sharedOpen === null) {
      this.#sharedOpen = SQLite.openDatabaseAsync("codex-remote.db", {
        finalizeUnusedStatementsBeforeClosing: false,
      }).then(async (database) => {
        await database.execAsync("PRAGMA busy_timeout = 5000");
        return new LegacyRemoteStore(database);
      }).catch((cause: unknown) => {
        this.#sharedOpen = null;
        throw cause;
      });
    }
    return this.#sharedOpen;
  }

  async close(): Promise<void> {
    try {
      await this.#database.closeAsync();
    } finally {
      this.#tokenCache.clear();
      LegacyRemoteStore.#sharedOpen = null;
    }
  }

  async listConnections(): Promise<StoredConnection[]> {
    const columns = await tableColumns(this.#database, "connections");
    if (columns.size === 0) return [];
    const rows = await this.#database.getAllAsync<ConnectionRow>(`
      SELECT id, display_name, emoji, endpoint,
        ${optionalColumn(columns, "tls_pin_sha256", "NULL")} AS tls_pin_sha256,
        enabled, sort_order, state,
        ${optionalColumn(columns, "last_error", "NULL")} AS last_error,
        ${optionalColumn(columns, "last_error_at", "NULL")} AS last_error_at
      FROM connections ORDER BY sort_order, id
    `);
    return await Promise.all(rows.map(async (row) => {
      let token = this.#tokenCache.get(row.id);
      if (token === undefined) {
        token = await SecureStore.getItemAsync(tokenKey(row.id)) ?? "";
        this.#tokenCache.set(row.id, token);
      }
      return {
        id: row.id,
        displayName: row.display_name,
        emoji: row.emoji,
        endpoint: row.endpoint,
        ...(row.tls_pin_sha256 === null ? {} : { tlsPinSha256: row.tls_pin_sha256 }),
        enabled: row.enabled === 1,
        sortOrder: row.sort_order,
        state: row.state,
        lastError: row.last_error,
        lastErrorAt: row.last_error_at,
        token,
      };
    }));
  }

}

async function tableExists(database: SQLite.SQLiteDatabase, table: string): Promise<boolean> {
  const row = await database.getFirstAsync<{ present: number }>(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    table,
  );
  return row !== null;
}

async function tableColumns(database: SQLite.SQLiteDatabase, table: string): Promise<Set<string>> {
  if (!await tableExists(database, table)) return new Set();
  const rows = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

function optionalColumn(columns: Set<string>, column: string, fallback: string): string {
  return columns.has(column) ? column : fallback;
}

function tokenKey(connectionId: string): string {
  return `connection-token-${connectionId}`;
}
