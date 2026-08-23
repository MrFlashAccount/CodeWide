import type { AccountRateLimitsUpdatedNotification, GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import type { Collection } from "@tanstack/react-db";

import { mergeAccountRateLimits, type AccountRateLimitsRow } from "./account-rate-limits";
import type { AccountPoolSnapshot } from "./account-pool";
import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

export type AccountRateLimitsDatabase = {
  collection: Collection<AccountRateLimitsRow, string>;
  get(connectionId: string): AccountRateLimitsRow | null;
  markLoading(connectionId: string): void;
  putSnapshot(connectionId: string, snapshot: GetAccountRateLimitsResponse): void;
  putAccountPool(connectionId: string, accountPool: AccountPoolSnapshot): void;
  mergeUpdate(connectionId: string, update: AccountRateLimitsUpdatedNotification): void;
  markError(connectionId: string, error: string): void;
  remove(connectionId: string): void;
  close(): void;
};

export function createAccountRateLimitsDatabase(): AccountRateLimitsDatabase {
  let source = new Map<string, AccountRateLimitsRow>();
  let disposed = false;
  const model = createPersistentCollectionModel<AccountRateLimitsRow, string>({
    id: "account-rate-limits-v1",
    tableName: "codewide_account_rate_limits",
    schemaVersion: 1,
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    columns: [
      { property: "connectionId", column: "connection_id", type: "TEXT" },
      { property: "updatedAt", column: "updated_at", type: "REAL" },
    ],
    legacyCollectionId: "account-rate-limits-v1",
    onResidentRows: (rows) => { source = new Map(rows.map((row) => [row.id, row])); },
  });
  const { collection, storage } = model;

  const publish = (row: AccountRateLimitsRow): void => {
    if (disposed) return;
    const previous = source.get(row.id);
    source.set(row.id, row);
    storage.begin();
    storage.write({ type: previous === undefined ? "insert" : "update", value: row });
    void storage.commit().catch((cause: unknown) => console.warn("Could not persist account limits", cause));
  };
  const get = (connectionId: string): AccountRateLimitsRow | null => {
    return source.get(connectionId) ?? null;
  };

  return {
    collection,
    get,
    markLoading(connectionId) {
      const previous = get(connectionId);
      publish({ id: connectionId, connectionId, status: "loading", snapshot: previous?.snapshot ?? null, accountPool: previous?.accountPool ?? null, error: null, updatedAt: previous?.updatedAt ?? 0 });
    },
    putSnapshot(connectionId, snapshot) {
      const previous = get(connectionId);
      publish({ id: connectionId, connectionId, status: "ready", snapshot: structuredClone(snapshot), accountPool: previous?.accountPool ?? null, error: null, updatedAt: Date.now() });
    },
    putAccountPool(connectionId, accountPool) {
      const previous = get(connectionId);
      publish({
        id: connectionId,
        connectionId,
        status: previous?.status ?? "ready",
        snapshot: previous?.snapshot ?? null,
        accountPool: structuredClone(accountPool),
        error: previous?.error ?? null,
        updatedAt: previous?.updatedAt ?? Date.now(),
      });
    },
    mergeUpdate(connectionId, update) {
      const previous = get(connectionId);
      publish({
        id: connectionId,
        connectionId,
        status: "ready",
        snapshot: mergeAccountRateLimits(previous?.snapshot ?? null, update),
        accountPool: previous?.accountPool ?? null,
        error: null,
        updatedAt: Date.now(),
      });
    },
    markError(connectionId, error) {
      const previous = get(connectionId);
      publish({ id: connectionId, connectionId, status: "error", snapshot: previous?.snapshot ?? null, accountPool: previous?.accountPool ?? null, error: error.slice(0, 1_000), updatedAt: previous?.updatedAt ?? 0 });
    },
    remove(connectionId) {
      if (disposed) return;
      if (!source.delete(connectionId)) return;
      storage.begin();
      storage.write({ type: "delete", key: connectionId });
      void storage.commit().catch((cause: unknown) => console.warn("Could not delete account limits", cause));
    },
    close() {
      disposed = true;
      model.close();
    },
  };
}
