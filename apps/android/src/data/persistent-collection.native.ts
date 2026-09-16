import {
  createSqliteSyncRuntime,
  type SqliteMutationHandlerParams,
  type SqliteSyncRuntime,
  type SqliteSyncRuntimeOptions,
} from "@codewide/tanstack-db-sqlite";
import { createCollection, type Collection } from "@tanstack/react-db";

import { appLogger } from "../observability/logger";
import { readLegacyPersistedRows } from "./legacy-persistence-migration.native";

export type PersistentCollectionModel<
  T extends Record<string, unknown>,
  TKey extends string | number,
> = {
  close: () => void;
  collection: Collection<T, TKey>;
  ready: Promise<void>;
  storage: SqliteSyncRuntime<T, TKey>;
};

type PersistentCollectionOptions<
  T extends Record<string, unknown>,
  TKey extends string | number,
> = Omit<SqliteSyncRuntimeOptions<T, TKey>, "initialSync" | "bootstrap"> & {
  beforeDelete?: (params: SqliteMutationHandlerParams<T, TKey>) => Promise<void> | void;
  beforeInsert?: (params: SqliteMutationHandlerParams<T, TKey>) => Promise<void> | void;
  beforeUpdate?: (params: SqliteMutationHandlerParams<T, TKey>) => Promise<void> | void;
  legacyCollectionId?: string;
};

/** One owner for eager local models: SQLite load, resident snapshot, optimistic
 * mutation confirmation and durable checkpoint all pass through one runtime. */
export function createPersistentCollectionModel<
  T extends Record<string, unknown>,
  TKey extends string | number,
>(options: PersistentCollectionOptions<T, TKey>): PersistentCollectionModel<T, TKey> {
  const { beforeDelete, beforeInsert, beforeUpdate, legacyCollectionId, ...runtimeOptions } =
    options;
  const storage = createSqliteSyncRuntime<T, TKey>({
    ...runtimeOptions,
    initialSync: "all",
    ...(legacyCollectionId === undefined
      ? {}
      : {
          bootstrap: {
            id: `tanstack-persistence:${legacyCollectionId}:v1`,
            load: async (executor) => readLegacyPersistedRows<T>(executor, legacyCollectionId),
          },
        }),
  });
  // WHY: TanStack infers its internal collection key from a generic callback as string | number;
  // this owner preserves the same TKey in getKey, mutations, storage and the returned collection.
  const collection = createCollection({
    getKey: options.getKey,
    id: options.id,
    onDelete: async (params) => {
      await beforeDelete?.(params);
      await storage.mutations.onDelete(params);
    },
    onInsert: async (params) => {
      await beforeInsert?.(params);
      await storage.mutations.onInsert(params);
    },
    onUpdate: async (params) => {
      await beforeUpdate?.(params);
      await storage.mutations.onUpdate(params);
    },
    sync: storage.sync,
    syncMode: "eager",
  }) as Collection<T, TKey>;
  const ready = collection.preload();
  return {
    close() {
      collection.cleanup().catch(() => undefined);
      storage.close().catch((error: unknown) => {
        appLogger.warnCaught({
          error,
          event: "sqlite_model.close.failed",
          fields: { modelId: options.id },
        });
      });
    },
    collection,
    ready,
    storage,
  };
}

/** One owner for query-driven local models whose resident rows follow explicit demand. */
export function createOnDemandPersistentCollectionModel<
  T extends Record<string, unknown>,
  TKey extends string | number,
>(options: PersistentCollectionOptions<T, TKey>): PersistentCollectionModel<T, TKey> {
  const { beforeDelete, beforeInsert, beforeUpdate, legacyCollectionId, ...runtimeOptions } =
    options;
  const storage = createSqliteSyncRuntime<T, TKey>({
    ...runtimeOptions,
    ...(legacyCollectionId === undefined
      ? {}
      : {
          bootstrap: {
            id: `tanstack-persistence:${legacyCollectionId}:v1`,
            load: async (executor) => readLegacyPersistedRows<T>(executor, legacyCollectionId),
          },
        }),
  });
  // WHY: TanStack infers its internal collection key from a generic callback as string | number;
  // this owner preserves the same TKey in getKey, mutations, storage and the returned collection.
  const collection = createCollection({
    getKey: options.getKey,
    id: options.id,
    onDelete: async (params) => {
      await beforeDelete?.(params);
      await storage.mutations.onDelete(params);
    },
    onInsert: async (params) => {
      await beforeInsert?.(params);
      await storage.mutations.onInsert(params);
    },
    onUpdate: async (params) => {
      await beforeUpdate?.(params);
      await storage.mutations.onUpdate(params);
    },
    sync: storage.sync,
    syncMode: "on-demand",
  }) as Collection<T, TKey>;
  collection.startSyncImmediate();
  return {
    close() {
      collection.cleanup().catch(() => undefined);
      storage.close().catch((error: unknown) => {
        appLogger.warnCaught({
          error,
          event: "sqlite_model.close.failed",
          fields: { modelId: options.id },
        });
      });
    },
    collection,
    ready: storage.prepare(),
    storage,
  };
}
