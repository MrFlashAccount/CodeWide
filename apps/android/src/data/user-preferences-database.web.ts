import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db";

import type { UserPreferencesDatabase } from "./user-preferences-database.types";
import type { UserPreferenceRow } from "./user-preferences";

let database: UserPreferencesDatabase | null = null;

export function getUserPreferencesDatabase(): UserPreferencesDatabase {
  if (database !== null) {
    return database;
  }
  const collection = createCollection(
    localOnlyCollectionOptions<UserPreferenceRow, string>({
      getKey: (row) => row.id,
      id: "user-preferences-v1-web",
    }),
  );
  let writeQueue: Promise<void> = Promise.resolve();
  database = {
    collection,
    ready: Promise.resolve(),
    async update(id, apply) {
      const operation = writeQueue.then(async () => {
        const current = collection.get(id);
        const value = apply(current?.value ?? null);
        const transaction =
          current === undefined
            ? collection.insert({ id, updatedAt: Date.now(), value })
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
