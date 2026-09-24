import { appLogger } from "../observability/logger";
import type { AccountRateLimitsDatabase } from "./account-rate-limits-database-contract";

export type { AccountRateLimitsDatabase } from "./account-rate-limits-database-contract";

import {
  mergeAccountPoolRateLimits,
  mergeAccountRateLimits,
  type AccountRateLimitsRow,
} from "./account-rate-limits";

import { cloneProtocolValue } from "./clone-protocol-value";
import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

export function createAccountRateLimitsDatabase(): AccountRateLimitsDatabase {
  let disposed = false;
  const model = createPersistentCollectionModel<AccountRateLimitsRow, string>({
    columns: [
      { column: "connection_id", property: "connectionId", type: "TEXT" },
      { column: "updated_at", property: "updatedAt", type: "REAL" },
    ],
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    id: "account-rate-limits-v1",
    legacyCollectionId: "account-rate-limits-v1",
    schemaVersion: 1,
    tableName: "codewide_account_rate_limits",
  });
  const { collection, storage } = model;

  const publish = (row: AccountRateLimitsRow): void => {
    if (disposed) {
      return;
    }
    const previous = collection.get(row.id);
    storage.begin();
    storage.write({ type: previous === undefined ? "insert" : "update", value: row });
    void storage.commit().catch((error: unknown) => {
      appLogger.warnCaught({
        error: error,
        event: "account_rate_limits.persist.failed",
        fields: { connectionId: row.connectionId },
      });
    });
  };
  const get = (connectionId: string): AccountRateLimitsRow | null =>
    collection.get(connectionId) ?? null;

  return {
    close() {
      disposed = true;
      model.close();
    },
    collection,
    async deleteConnection(connectionId) {
      await model.ready;
      if (collection.get(connectionId) === undefined) {
        return;
      }
      storage.begin();
      storage.write({ key: connectionId, type: "delete" });
      await storage.commit({ durable: true });
    },
    get,
    markError(connectionId, error) {
      const previous = get(connectionId);
      publish({
        accountPool: previous?.accountPool ?? null,
        connectionId,
        error: error.slice(0, 1000),
        id: connectionId,
        snapshot: previous?.snapshot ?? null,
        status: "error",
        updatedAt: previous?.updatedAt ?? 0,
      });
    },
    markLoading(connectionId) {
      const previous = get(connectionId);
      publish({
        accountPool: previous?.accountPool ?? null,
        connectionId,
        error: null,
        id: connectionId,
        snapshot: previous?.snapshot ?? null,
        status: "loading",
        updatedAt: previous?.updatedAt ?? 0,
      });
    },
    mergeUpdate(connectionId, update) {
      const previous = get(connectionId);
      const updatedAt = Date.now();
      publish({
        accountPool: mergeAccountPoolRateLimits(
          previous?.accountPool,
          update,
          Math.floor(updatedAt / 1000),
        ),
        connectionId,
        error: null,
        id: connectionId,
        snapshot: mergeAccountRateLimits(previous?.snapshot ?? null, update),
        status: "ready",
        updatedAt,
      });
    },
    putAccountPool(connectionId, accountPool) {
      const previous = get(connectionId);
      const active =
        accountPool.profiles.find((profile) => profile.id === accountPool.activeProfileId) ?? null;
      const activeRefresh =
        active !== null &&
        active.rateLimits !== null &&
        active.rateLimitsUpdatedAt !== null &&
        active.rateLimitsError === null
          ? { snapshot: active.rateLimits, updatedAt: active.rateLimitsUpdatedAt }
          : null;
      publish({
        accountPool: cloneProtocolValue(accountPool),
        connectionId,
        error:
          active?.rateLimitsError ?? (activeRefresh !== null ? null : (previous?.error ?? null)),
        id: connectionId,
        snapshot:
          activeRefresh !== null
            ? cloneProtocolValue(activeRefresh.snapshot)
            : (previous?.snapshot ?? null),
        status:
          active?.rateLimitsError !== null && active?.rateLimitsError !== undefined
            ? "error"
            : activeRefresh !== null
              ? "ready"
              : (previous?.status ?? "ready"),
        updatedAt:
          activeRefresh !== null ? activeRefresh.updatedAt * 1000 : (previous?.updatedAt ?? 0),
      });
    },
    putSnapshot(connectionId, snapshot) {
      const previous = get(connectionId);
      publish({
        accountPool: previous?.accountPool ?? null,
        connectionId,
        error: null,
        id: connectionId,
        snapshot: cloneProtocolValue(snapshot),
        status: "ready",
        updatedAt: Date.now(),
      });
    },
    remove(connectionId) {
      if (disposed) {
        return;
      }
      if (collection.get(connectionId) === undefined) {
        return;
      }
      storage.begin();
      storage.write({ key: connectionId, type: "delete" });
      void storage.commit().catch((error: unknown) => {
        appLogger.warnCaught({
          error: error,
          event: "account_rate_limits.delete.failed",
          fields: { connectionId },
        });
      });
    },
  };
}
