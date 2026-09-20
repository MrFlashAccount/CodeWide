import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getSettingsSqliteDatabase } from "./settings-persistence.native";
import {
  GLOBAL_SUPERVISOR_ATTENTION_SCHEMA_VERSION,
  type GlobalSupervisorAttentionStorage,
  type GlobalSupervisorAttentionStoredRow,
} from "./globalSupervisorAttentionStorage.types";

/** Persistent device-wide relation and attention rows. */
export function createGlobalSupervisorAttentionStorage(): GlobalSupervisorAttentionStorage {
  const model = createPersistentCollectionModel<GlobalSupervisorAttentionStoredRow, string>({
    columns: [
      { column: "row_kind", property: "rowKind", type: "TEXT" },
      {
        column: "supervisor_connection_id",
        property: "supervisorConnectionId",
        type: "TEXT",
      },
      { column: "supervisor_thread_id", property: "supervisorThreadId", type: "TEXT" },
      { column: "worker_connection_id", property: "workerConnectionId", type: "TEXT" },
      { column: "worker_thread_id", nullable: true, property: "workerThreadId", type: "TEXT" },
      { column: "observed_at", property: "observedAt", type: "REAL" },
    ],
    database: getSettingsSqliteDatabase(),
    getKey: (row) => row.id,
    id: "global-supervisor-attention-v1",
    indexes: [
      ["rowKind", "supervisorConnectionId", "supervisorThreadId"],
      ["rowKind", "workerConnectionId", "workerThreadId"],
    ],
    schemaVersion: GLOBAL_SUPERVISOR_ATTENTION_SCHEMA_VERSION,
    tableName: "codewide_global_supervisor_attention",
  });
  return {
    close: model.close,
    async commit(changes) {
      if (changes.length === 0) {
        return;
      }
      await model.ready;
      model.storage.begin();
      for (const change of changes) {
        if (change.type === "delete") {
          model.storage.write({ key: change.id, type: "delete" });
          continue;
        }
        model.storage.write({
          type: model.collection.has(change.row.id) ? "update" : "insert",
          value: change.row,
        });
      }
      await model.storage.commit({ durable: true });
    },
    ready: model.ready,
    rows: () => model.collection.toArray,
  };
}
