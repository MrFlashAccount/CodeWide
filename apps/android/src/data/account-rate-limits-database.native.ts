import type { AccountRateLimitsUpdatedNotification, GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import { mergeAccountRateLimits, type AccountRateLimitsRow } from "./account-rate-limits";
import type { AccountPoolSnapshot } from "./account-pool";
import { getUiCachePersistence } from "./ui-cache-persistence.native";

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

type SyncControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change: { type: "insert" | "update"; value: AccountRateLimitsRow } | { type: "delete"; key: string }): void;
  commit(): void;
};

export function createAccountRateLimitsDatabase(): AccountRateLimitsDatabase {
  let controls: SyncControls | null = null;
  let source = new Map<string, AccountRateLimitsRow>();
  let bootstrapped = false;
  let disposed = false;
  const collection = createCollection(persistedCollectionOptions<AccountRateLimitsRow, string>({
    id: "account-rate-limits-v1",
    schemaVersion: 1,
    getKey: (row) => row.id,
    persistence: getUiCachePersistence(),
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        controls = { begin, write, commit };
        markReady();
        return { cleanup: () => { controls = null; } };
      },
    },
  }));

  const bootstrap = (): void => {
    if (bootstrapped) return;
    source = new Map(collection.toArray.map((row) => [row.id, row]));
    bootstrapped = true;
  };
  const publish = (row: AccountRateLimitsRow): void => {
    if (disposed || controls === null) return;
    bootstrap();
    const previous = source.get(row.id);
    source.set(row.id, row);
    controls.begin({ immediate: true });
    controls.write({ type: previous === undefined ? "insert" : "update", value: row });
    controls.commit();
  };
  const get = (connectionId: string): AccountRateLimitsRow | null => {
    bootstrap();
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
      if (disposed || controls === null) return;
      bootstrap();
      if (!source.delete(connectionId)) return;
      controls.begin({ immediate: true });
      controls.write({ type: "delete", key: connectionId });
      controls.commit();
    },
    close() {
      disposed = true;
      collection.cleanup();
    },
  };
}
