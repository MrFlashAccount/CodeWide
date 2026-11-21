import { createDownloadHistoryStorage } from "../src/data/downloadHistoryStorage.web";
import { DownloadManager, type DownloadPorts } from "../src/data/downloadManager";

/** A download manager over in-memory history whose platform ports refuse every
 * file operation unless the test supplies its own. */
export function createTestDownloadManager(ports: Partial<DownloadPorts> = {}): DownloadManager {
  let folder: string | null = null;
  return new DownloadManager(createDownloadHistoryStorage(), {
    deleteFile: () => undefined,
    discardPartial: () => undefined,
    isPickerCancellation: () => false,
    now: Date.now,
    pickDirectory: async () => {
      await Promise.resolve();
      throw new Error("No download folder in this test");
    },
    readFolder: async () => {
      await Promise.resolve();
      return folder;
    },
    restoreDirectory: () => null,
    start: () => {
      throw new Error("No downloads in this test");
    },
    writeFolder: async (value) => {
      await Promise.resolve();
      folder = value;
    },
    ...ports,
  });
}
