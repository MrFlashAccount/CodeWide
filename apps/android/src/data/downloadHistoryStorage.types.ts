import type { DownloadHistoryRow } from "./downloadRecords";

/** Durable device-wide download history used by the download manager. */
export type DownloadHistoryStorage = {
  readonly delete: (id: string) => Promise<void>;
  readonly put: (row: DownloadHistoryRow) => Promise<void>;
  readonly ready: Promise<void>;
  /** Stored rows as written; the manager validates each one before use. */
  readonly rows: () => readonly unknown[];
};
