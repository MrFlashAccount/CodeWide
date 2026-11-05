import type { DownloadHistoryStorage } from "./downloadHistoryStorage.types";
import type { DownloadHistoryRow } from "./downloadRecords";

/** Web has no file downloads; history lives only as long as the page. */
export function createDownloadHistoryStorage(): DownloadHistoryStorage {
  const rows = new Map<string, DownloadHistoryRow>();
  return {
    async delete(id) {
      rows.delete(id);
      await Promise.resolve();
    },
    async put(row) {
      rows.set(row.id, row);
      await Promise.resolve();
    },
    ready: Promise.resolve(),
    rows: () => [...rows.values()],
  };
}
