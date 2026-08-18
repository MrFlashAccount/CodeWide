import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";

import type { UserPreferencesDatabase } from "./user-preferences-database.types";
import type { UserPreferenceRow } from "./user-preferences";

let database: UserPreferencesDatabase | null = null;

export function getUserPreferencesDatabase(): UserPreferencesDatabase {
  if (database !== null) return database;
  const collection = createCollection(localOnlyCollectionOptions<UserPreferenceRow, string>({
    id: "user-preferences-v1-web",
    getKey: (row) => row.id,
  }));
  let writeQueue: Promise<void> = Promise.resolve();
  database = {
    collection,
    update(id, apply) {
      const operation = writeQueue.then(async () => {
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
