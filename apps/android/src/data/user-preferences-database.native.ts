import { appLogger } from "../observability/logger";
import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getSettingsSqliteDatabase } from "./settings-persistence.native";
import type { UserPreferencesDatabase } from "./user-preferences-database.types";
import type { UserPreferenceRow } from "./user-preferences";

let database: UserPreferencesDatabase | null = null;

/** Durable, device-wide UI preferences. This collection intentionally lives
 * in the settings database rather than the reconstructable thread cache. */
export function getUserPreferencesDatabase(): UserPreferencesDatabase {
  if (database !== null) {
    return database;
  }
  const model = createPersistentCollectionModel<UserPreferenceRow, string>({
    columns: [{ column: "updated_at", property: "updatedAt", type: "REAL" }],
    database: getSettingsSqliteDatabase(),
    getKey: (row) => row.id,
    id: "user-preferences-v1",
    legacyCollectionId: "user-preferences-v1",
    schemaVersion: 1,
    tableName: "codewide_user_preferences",
  });
  const { collection, ready } = model;
  void ready.catch((error: unknown) => {
    appLogger.warnCaught({ error: error, event: "user_preferences.preload.failed" });
  });
  let writeQueue: Promise<void> = Promise.resolve();
  database = {
    collection,
    ready,
    async update(id, apply) {
      const operation = writeQueue.then(async () => {
        await ready;
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
