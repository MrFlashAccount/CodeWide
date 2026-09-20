import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getSettingsSqliteDatabase } from "./settings-persistence.native";
import {
  GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
  parseGlobalSupervisorBinding,
  type GlobalSupervisorBinding,
} from "./globalSupervisorBinding";
import type {
  GlobalSupervisorBindingDatabase,
  GlobalSupervisorBindingStorageRow,
} from "./globalSupervisorBindingDatabase.types";

const ROW_ID = "global-supervisor-binding";

/** Creates the schema-versioned settings owner for the one durable binding row. */
export function createGlobalSupervisorBindingDatabase(): GlobalSupervisorBindingDatabase {
  const model = createPersistentCollectionModel<GlobalSupervisorBindingStorageRow, string>({
    columns: [{ column: "updated_at", property: "updatedAt", type: "REAL" }],
    database: getSettingsSqliteDatabase(),
    getKey: (row) => row.id,
    id: "global-supervisor-binding-v1",
    schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
    tableName: "codewide_global_supervisor_binding",
  });
  return {
    async clear() {
      await model.ready;
      if (!model.collection.has(ROW_ID)) {
        return;
      }
      const transaction = model.collection.delete(ROW_ID);
      await transaction.isPersisted.promise;
    },
    async read() {
      await model.ready;
      const payload = model.collection.get(ROW_ID)?.payload;
      if (payload === undefined) {
        return null;
      }
      let value: unknown;
      try {
        value = JSON.parse(payload);
      } catch {
        return {
          priorHome: null,
          reason: "malformedStorage",
          schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
          status: "invalid",
        };
      }
      return (
        parseGlobalSupervisorBinding(value) ?? {
          priorHome: null,
          reason: "malformedStorage",
          schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
          status: "invalid",
        }
      );
    },
    ready: model.ready,
    async write(binding: GlobalSupervisorBinding) {
      await model.ready;
      const current = model.collection.get(ROW_ID);
      const payload = JSON.stringify(binding);
      const transaction =
        current === undefined
          ? model.collection.insert({ id: ROW_ID, payload, updatedAt: Date.now() })
          : model.collection.update(ROW_ID, (draft) => {
              draft.payload = payload;
              draft.updatedAt = Date.now();
            });
      await transaction.isPersisted.promise;
    },
  };
}
