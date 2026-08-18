import { createCollection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import { getSettingsPersistence } from "./settings-persistence.native";
import type { UserPreferencesDatabase } from "./user-preferences-database.types";
import type { UserPreferenceRow } from "./user-preferences";

let database: UserPreferencesDatabase | null = null;

/** Durable, device-wide UI preferences. This collection intentionally lives
 * in the settings database rather than the reconstructable thread cache. */
export function getUserPreferencesDatabase(): UserPreferencesDatabase {
  if (database !== null) return database;
  const collection = createCollection(
    persistedCollectionOptions<UserPreferenceRow, string>({
      id: "user-preferences-v1",
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: getSettingsPersistence(),
    }),
  );
  const ready = collection.preload();
  void ready.catch((cause: unknown) => {
    console.warn("Could not preload user preferences", cause);
  });
  let writeQueue: Promise<void> = Promise.resolve();
  database = {
    collection,
    update(id, apply) {
      const operation = writeQueue.then(async () => {
        await ready;
        const current = collection.get(id);
        const value = apply(current?.value ?? null);
        const transaction = current === undefined
          ? collection.insert({ id, value, updatedAt: Date.now() })
          : collection.update(id, (draft) => {
              draft.value = value;
              draft.updatedAt = Date.now();
            });
        await transaction.isPersisted.promise;
      });
      writeQueue = operation.catch(() => undefined);
      return operation;
    },
  };
  return database;
}
