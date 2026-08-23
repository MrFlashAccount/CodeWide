import {
  createSqliteSyncRuntime,
  type SqliteMutationHandlerParams,
  type SqliteSyncRuntime,
  type SqliteSyncRuntimeOptions,
} from "@codewide/tanstack-db-sqlite";
import { createCollection, type Collection } from "@tanstack/react-db";

import { readLegacyPersistedRows } from "./legacy-persistence-migration.native";

export type PersistentCollectionModel<T extends object, TKey extends string | number> = {
  collection: Collection<T, TKey>;
  storage: SqliteSyncRuntime<T, TKey>;
  ready: Promise<void>;
  close(): void;
};

type PersistentCollectionOptions<T extends object, TKey extends string | number> = Omit<
  SqliteSyncRuntimeOptions<T, TKey>,
  "initialSync" | "bootstrap"
> & {
  legacyCollectionId?: string;
  beforeInsert?(params: SqliteMutationHandlerParams<T, TKey>): Promise<void> | void;
  beforeUpdate?(params: SqliteMutationHandlerParams<T, TKey>): Promise<void> | void;
  beforeDelete?(params: SqliteMutationHandlerParams<T, TKey>): Promise<void> | void;
};

/** One owner for eager local models: SQLite load, resident snapshot, optimistic
 * mutation confirmation and durable checkpoint all pass through one runtime. */
export function createPersistentCollectionModel<T extends object, TKey extends string | number>(
  options: PersistentCollectionOptions<T, TKey>,
): PersistentCollectionModel<T, TKey> {
  const {
    legacyCollectionId,
    beforeInsert,
    beforeUpdate,
    beforeDelete,
    ...runtimeOptions
  } = options;
  const storage = createSqliteSyncRuntime<T, TKey>({
    ...runtimeOptions,
    initialSync: "all",
    ...(legacyCollectionId === undefined ? {} : {
      bootstrap: {
        id: `tanstack-persistence:${legacyCollectionId}:v1`,
        load: async (executor) => await readLegacyPersistedRows<T>(executor, legacyCollectionId),
      },
    }),
  });
  const collection = createCollection({
    id: options.id,
    getKey: options.getKey,
    syncMode: "eager",
    sync: storage.sync,
    onInsert: async (params) => {
      await beforeInsert?.(params as SqliteMutationHandlerParams<T, TKey>);
      await storage.mutations.onInsert(params as SqliteMutationHandlerParams<T, TKey>);
    },
    onUpdate: async (params) => {
      await beforeUpdate?.(params as SqliteMutationHandlerParams<T, TKey>);
      await storage.mutations.onUpdate(params as SqliteMutationHandlerParams<T, TKey>);
    },
    onDelete: async (params) => {
      await beforeDelete?.(params as SqliteMutationHandlerParams<T, TKey>);
      await storage.mutations.onDelete(params as SqliteMutationHandlerParams<T, TKey>);
    },
  }) as Collection<T, TKey>;
  const ready = collection.preload();
  return {
    collection,
    storage,
    ready,
    close() {
      collection.cleanup();
      void storage.close().catch((cause: unknown) => console.warn(`Could not close SQLite model ${options.id}`, cause));
    },
  };
}
