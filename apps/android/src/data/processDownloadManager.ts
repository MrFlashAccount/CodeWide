import {
  deleteDownloadedFile,
  discardPartialDownload,
  pickDownloadDirectory,
  restoreDownloadDirectory,
  startDownload,
  startPreviewDownload,
} from "../native/file-transfer";
import { createDownloadHistoryStorage } from "./downloadHistoryStorage";
import { DownloadManager } from "./downloadManager";
import { getUserPreferencesDatabase } from "./user-preferences-database";

const DOWNLOAD_FOLDER_PREFERENCE_ID = "download-folder";

let manager: DownloadManager | null = null;

/** The one download manager of this app process, bound to the native file layer. */
export function getProcessDownloadManager(): DownloadManager {
  if (manager !== null) {
    return manager;
  }
  const preferences = getUserPreferencesDatabase();
  manager = new DownloadManager(createDownloadHistoryStorage(), {
    deleteFile: deleteDownloadedFile,
    discardPartial: discardPartialDownload,
    isPickerCancellation: (error) =>
      error instanceof Error && /cancel(?:led|ed)?/iu.test(error.message),
    now: Date.now,
    pickDirectory: pickDownloadDirectory,
    async readFolder() {
      await preferences.ready;
      return preferences.collection.get(DOWNLOAD_FOLDER_PREFERENCE_ID)?.value ?? null;
    },
    restoreDirectory: restoreDownloadDirectory,
    start: ({ directory, getAccess, onProgress, source }) =>
      source.kind === "scoped"
        ? startDownload(getAccess, directory, source.rootId, source.path, onProgress)
        : startPreviewDownload(getAccess, directory, source.path, onProgress),
    async writeFolder(value) {
      await preferences.update(DOWNLOAD_FOLDER_PREFERENCE_ID, () => value);
    },
  });
  return manager;
}
