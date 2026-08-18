import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import type { StoredConnection } from "./connection-profile-types";
import type { StoredComposerPreferences, StoredDraftAttachment } from "./thread-ui-state-types";

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

  async loadDraft(connectionId: string, threadId: string): Promise<string> {
    if (!await tableExists(this.#database, "drafts")) return "";
    const row = await this.#database.getFirstAsync<{ text: string }>(
      "SELECT text FROM drafts WHERE connection_id = ? AND remote_thread_id = ?",
      connectionId,
      threadId,
    );
    return row?.text ?? "";
  }

  async loadDraftAttachments(connectionId: string, threadId: string): Promise<StoredDraftAttachment[]> {
    const columns = await tableColumns(this.#database, "drafts");
    if (!columns.has("attachments_json")) return [];
    const row = await this.#database.getFirstAsync<{ attachments_json: string }>(
      "SELECT attachments_json FROM drafts WHERE connection_id = ? AND remote_thread_id = ?",
      connectionId,
      threadId,
    );
    if (row === null) return [];
    try {
      return sanitizeDraftAttachments(JSON.parse(row.attachments_json) as unknown);
    } catch {
      return [];
    }
  }

  async loadScrollOffset(connectionId: string, threadId: string): Promise<number | null> {
    if (!await tableExists(this.#database, "thread_ui_state")) return null;
    const row = await this.#database.getFirstAsync<{ scroll_offset: number }>(
      "SELECT scroll_offset FROM thread_ui_state WHERE connection_id = ? AND remote_thread_id = ?",
      connectionId,
      threadId,
    );
    return row === null || !Number.isFinite(row.scroll_offset) ? null : Math.max(0, row.scroll_offset);
  }

  async loadComposerPreferences(connectionId: string, threadId: string): Promise<StoredComposerPreferences | null> {
    const columns = await tableColumns(this.#database, "composer_preferences");
    if (columns.size === 0) return null;
    const row = await this.#database.getFirstAsync<{
      model: string | null;
      effort: string | null;
      personality: string | null;
      permissions: string | null;
      skill_paths_json: string;
      send_mode: string;
    }>(`
      SELECT model, effort,
        ${optionalColumn(columns, "personality", "NULL")} AS personality,
        permissions, skill_paths_json, send_mode
      FROM composer_preferences WHERE connection_id = ? AND remote_thread_id = ?
    `, connectionId, threadId);
    if (row === null) return null;
    let skillPaths: string[] = [];
    try {
      const rawPaths = JSON.parse(row.skill_paths_json) as unknown;
      if (Array.isArray(rawPaths)) skillPaths = rawPaths.filter((value): value is string => typeof value === "string");
    } catch {
      // A malformed legacy preference must not block opening the thread.
    }
    return {
      model: row.model,
      effort: row.effort,
      personality: row.personality === "none" || row.personality === "friendly" || row.personality === "pragmatic" ? row.personality : null,
      permissions: row.permissions,
      skillPaths,
      sendMode: row.send_mode === "queue" || row.send_mode === "steer" ? row.send_mode : "start",
    };
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

function sanitizeDraftAttachments(value: unknown): StoredDraftAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).flatMap((raw) => {
    const attachment = object(raw);
    if (attachment === null) return [];
    const { id, rootId, path, name, kind } = attachment;
    if (
      typeof id !== "string" || id.length < 1 || id.length > 128
      || typeof rootId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/u.test(rootId)
      || typeof path !== "string" || path.length < 1 || path.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(path)
      || typeof name !== "string" || name.length < 1 || name.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(name)
      || (kind !== "image" && kind !== "audio" && kind !== "file")
    ) return [];
    return [{ id, rootId, path, name, kind }];
  });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tokenKey(connectionId: string): string {
  return `connection-token-${connectionId}`;
}
