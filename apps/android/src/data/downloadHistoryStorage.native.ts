import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getSettingsSqliteDatabase } from "./settings-persistence.native";
import type { DownloadHistoryStorage } from "./downloadHistoryStorage.types";
import type { DownloadHistoryRow } from "./downloadRecords";

/** Download history lives in the settings database: it records files saved on this
 * device, which a reconstructable thread cache must not drop. */
export function createDownloadHistoryStorage(): DownloadHistoryStorage {
  const model = createPersistentCollectionModel<DownloadHistoryRow, string>({
    columns: [{ column: "started_at", property: "startedAt", type: "REAL" }],
    database: getSettingsSqliteDatabase(),
    getKey: (row) => row.id,
    id: "download-history-v1",
    schemaVersion: 1,
    tableName: "codewide_download_history",
  });
  let writeQueue: Promise<void> = Promise.resolve();
  const enqueue = async (write: () => void): Promise<void> => {
    const operation = writeQueue.then(async () => {
      await model.ready;
      model.storage.begin();
      write();
      await model.storage.commit({ durable: true });
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  };
  return {
    async delete(id) {
      await enqueue(() => {
        if (model.collection.has(id)) {
          model.storage.write({ key: id, type: "delete" });
        }
      });
    },
    async put(row) {
      await enqueue(() => {
        model.storage.write({
          type: model.collection.has(row.id) ? "update" : "insert",
          value: row,
        });
      });
    },
    ready: model.ready,
    rows: () => model.collection.toArray,
  };
}
