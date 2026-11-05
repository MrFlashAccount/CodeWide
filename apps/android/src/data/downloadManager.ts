import { observable, type Observable } from "@legendapp/state";

import type { RunningDownload, SelectedDirectory, TransferProgress } from "../native/file-transfer";
import { appLogger } from "../observability/logger";
import type { DownloadHistoryStorage } from "./downloadHistoryStorage.types";
import {
  createDownloadId,
  restoreDownloadEntry,
  type DownloadEntry,
  type DownloadId,
  type DownloadSource,
  type DownloadState,
} from "./downloadRecords";
import type { GetTransferAccess } from "./private-transfer";
import { unknownRecord } from "./unknownRecord";

export type DownloadRequest = {
  readonly getAccess: GetTransferAccess;
  readonly name: string;
  readonly source: DownloadSource;
};

/** How one run of a download ended, for the surface that started it. */
export type DownloadSettlement =
  | {
      readonly id: DownloadId;
      readonly mimeType: string | null;
      readonly name: string;
      readonly status: "completed";
      readonly uri: string;
    }
  | { readonly error: unknown; readonly id: DownloadId; readonly status: "failed" }
  /** Paused, cancelled or removed by the user. */
  | { readonly status: "stopped" }
  /** The user closed the folder picker; nothing started. */
  | { readonly status: "dismissed" };

/** Saved download folder: its grant URI and the name shown to the user. */
export type DownloadFolder = { readonly name: string; readonly uri: string };

/** Everything one native transfer needs to fetch `source` into `directory`. */
export type DownloadTransferStart = {
  readonly directory: SelectedDirectory;
  readonly getAccess: GetTransferAccess;
  readonly onProgress: (progress: TransferProgress) => void;
  readonly source: DownloadSource;
};

/** Platform capabilities the manager drives; production binds the native file layer. */
export type DownloadPorts = {
  readonly deleteFile: (uri: string) => void;
  readonly discardPartial: (directory: SelectedDirectory, remotePath: string) => void;
  readonly isPickerCancellation: (error: unknown) => boolean;
  readonly now: () => number;
  readonly pickDirectory: () => Promise<SelectedDirectory>;
  readonly readFolder: () => Promise<string | null>;
  readonly restoreDirectory: (uri: string) => SelectedDirectory | null;
  readonly start: (transfer: DownloadTransferStart) => RunningDownload;
  readonly writeFolder: (value: string) => Promise<void>;
};

/** Live work of a download started in this process. */
type DownloadJob = {
  attempt: number;
  readonly directory: SelectedDirectory;
  readonly request: DownloadRequest;
  stopping: "cancel" | "pause" | "remove" | null;
  transfer: RunningDownload | null;
};

const PROGRESS_INTERVAL_MS = 200;
const STOPPED: DownloadSettlement = { status: "stopped" };

/**
 * Process-lifetime owner of device downloads: it starts, pauses, resumes,
 * cancels and removes them, publishes their live state, records each state
 * transition in the durable history and remembers the chosen folder.
 */
export class DownloadManager {
  /** Newest first. Progress updates are throttled; transitions publish immediately. */
  readonly entries$: Observable<readonly DownloadEntry[]> = observable<readonly DownloadEntry[]>(
    [],
  );
  readonly folder$: Observable<DownloadFolder | null> = observable<DownloadFolder | null>(null);

  private directory: SelectedDirectory | null = null;
  private directoryLoad: Promise<SelectedDirectory | null> | null = null;
  private readonly jobs = new Map<DownloadId, DownloadJob>();
  private readonly ports: DownloadPorts;
  private readonly storage: DownloadHistoryStorage;

  constructor(storage: DownloadHistoryStorage, ports: DownloadPorts) {
    this.storage = storage;
    this.ports = ports;
    storage.ready.then(
      () => {
        this.hydrate();
      },
      (error: unknown) => {
        appLogger.warnCaught({ error, event: "downloads.history_load.failed" });
      },
    );
    ports.readFolder().then(
      (value) => {
        this.folder$.set(decodeFolder(value));
      },
      (error: unknown) => {
        appLogger.warnCaught({ error, event: "downloads.folder_load.failed" });
      },
    );
  }

  /** Starts a download into the remembered folder, asking for one the first time. */
  async start(request: DownloadRequest): Promise<DownloadSettlement> {
    const directory = await this.resolveDirectory();
    if (directory === null) {
      return { status: "dismissed" };
    }
    const startedAt = this.ports.now();
    const entry: DownloadEntry = {
      id: createDownloadId(startedAt),
      name: request.name,
      source: request.source,
      startedAt,
      state: { phase: "starting", status: "running", totalBytes: null, transferredBytes: 0 },
    };
    this.jobs.set(entry.id, { attempt: 0, directory, request, stopping: null, transfer: null });
    this.entries$.set([entry, ...this.entries$.peek()]);
    this.persist(entry);
    return this.run(entry.id);
  }

  /** Stops a running download and keeps its partial file for `resume`. */
  pause(id: DownloadId): void {
    const job = this.jobs.get(id);
    const state = this.entry(id)?.state;
    const transfer = job?.transfer ?? null;
    if (job === undefined || transfer === null || state?.status !== "running") {
      return;
    }
    job.stopping = "pause";
    transfer.pause();
    this.transition(id, {
      status: "paused",
      totalBytes: state.totalBytes,
      transferredBytes: state.transferredBytes,
    });
  }

  /** Continues a paused download from its partial file. */
  async resume(id: DownloadId): Promise<DownloadSettlement> {
    const state = this.entry(id)?.state;
    if (state?.status !== "paused" || !this.jobs.has(id)) {
      return STOPPED;
    }
    this.transition(id, {
      phase: "starting",
      status: "running",
      totalBytes: state.totalBytes,
      transferredBytes: state.transferredBytes,
    });
    return this.run(id);
  }

  /** Starts a failed or cancelled download again with the access it was started with. */
  async retry(id: DownloadId): Promise<DownloadSettlement> {
    const state = this.entry(id)?.state;
    if ((state?.status !== "failed" && state?.status !== "cancelled") || !this.jobs.has(id)) {
      return STOPPED;
    }
    this.transition(id, {
      phase: "starting",
      status: "running",
      totalBytes: null,
      transferredBytes: 0,
    });
    return this.run(id);
  }

  /** Whether this process still holds the access needed to resume or retry `id`. */
  canRestart(id: DownloadId): boolean {
    return this.jobs.has(id);
  }

  /** Stops an unfinished download and discards its partial file; the entry stays as cancelled. */
  cancel(id: DownloadId): void {
    const job = this.jobs.get(id);
    const entry = this.entry(id);
    if (job === undefined || entry === undefined) {
      return;
    }
    if (entry.state.status === "running" && job.transfer !== null) {
      job.stopping = "cancel";
      job.transfer.cancel();
    } else if (entry.state.status === "paused") {
      this.discardPartial(job.directory, entry.source);
    } else {
      return;
    }
    this.transition(id, { status: "cancelled" });
  }

  /** Forgets a download. An unfinished one is stopped and its partial file discarded;
   * a completed file stays on the device. */
  remove(id: DownloadId): void {
    const entry = this.entry(id);
    if (entry === undefined) {
      return;
    }
    this.stopForRemoval(entry);
    this.jobs.delete(id);
    this.entries$.set(this.entries$.peek().filter((candidate) => candidate.id !== id));
    this.storage.delete(id).catch((error: unknown) => {
      appLogger.warnCaught({ error, event: "downloads.history_delete.failed" });
    });
  }

  /** Deletes a completed file from the device and forgets it. */
  deleteFile(id: DownloadId): void {
    const state = this.entry(id)?.state;
    if (state?.status !== "completed") {
      return;
    }
    this.ports.deleteFile(state.uri);
    this.remove(id);
  }

  /** Asks for a new folder; later downloads go there. */
  async changeFolder(): Promise<void> {
    await this.pickDirectory();
  }

  private stopForRemoval(entry: DownloadEntry): void {
    const job = this.jobs.get(entry.id);
    const status = entry.state.status;
    if (status === "running" && job !== undefined) {
      job.stopping = "remove";
      job.transfer?.cancel();
    } else if (status === "paused" || status === "interrupted") {
      this.discardRemovedPartial(entry, job);
    }
  }

  /** A paused partial lives in its job's folder; an interrupted one in the remembered folder. */
  private discardRemovedPartial(entry: DownloadEntry, job: DownloadJob | undefined): void {
    const directory = job?.directory ?? this.savedDirectory();
    if (directory !== null) {
      this.discardPartial(directory, entry.source);
    }
  }

  /** Read through a call: `run` narrowed `stopping` to `null` before awaiting the
   * transfer, but `pause`, `cancel` and `remove` set it meanwhile. */
  private stopRequested(job: DownloadJob): boolean {
    return job.stopping !== null;
  }

  private async run(id: DownloadId): Promise<DownloadSettlement> {
    const job = this.jobs.get(id);
    const entry = this.entry(id);
    if (job === undefined || entry === undefined) {
      return STOPPED;
    }
    job.attempt += 1;
    job.stopping = null;
    const attempt = job.attempt;
    try {
      job.transfer = this.ports.start({
        directory: job.directory,
        getAccess: job.request.getAccess,
        onProgress: this.progressPublisher(id, job, attempt),
        source: entry.source,
      });
      return this.complete(entry, await job.transfer.promise);
    } catch (error) {
      if (this.stopRequested(job)) {
        return STOPPED;
      }
      this.transition(id, {
        error: error instanceof Error ? error.message : "Download failed",
        status: "failed",
      });
      return { error, id, status: "failed" };
    } finally {
      if (job.attempt === attempt) {
        job.transfer = null;
      }
    }
  }

  /** Publishes one attempt's progress, at most every `PROGRESS_INTERVAL_MS` within a phase. */
  private progressPublisher(
    id: DownloadId,
    job: DownloadJob,
    attempt: number,
  ): (progress: TransferProgress) => void {
    let lastPublishedAt = 0;
    return (progress) => {
      const state = this.entry(id)?.state;
      if (job.attempt !== attempt || state?.status !== "running") {
        return;
      }
      const next = runningProgress(progress);
      const now = this.ports.now();
      if (next.phase === state.phase && now - lastPublishedAt < PROGRESS_INTERVAL_MS) {
        return;
      }
      lastPublishedAt = now;
      this.publishState(id, next);
    };
  }

  private complete(
    entry: DownloadEntry,
    value: Awaited<RunningDownload["promise"]>,
  ): DownloadSettlement {
    if (value.uri === undefined) {
      throw new Error("The download finished without a saved file");
    }
    const mimeType = value.mimeType ?? null;
    this.transition(entry.id, {
      bytes: value.bytes,
      completedAt: this.ports.now(),
      mimeType,
      status: "completed",
      uri: value.uri,
    });
    return { id: entry.id, mimeType, name: entry.name, status: "completed", uri: value.uri };
  }

  private async resolveDirectory(): Promise<SelectedDirectory | null> {
    if (this.directory !== null) {
      return this.directory;
    }
    this.directoryLoad ??= this.restoreOrPickDirectory().finally(() => {
      this.directoryLoad = null;
    });
    return this.directoryLoad;
  }

  private async restoreOrPickDirectory(): Promise<SelectedDirectory | null> {
    const saved = decodeFolder(await this.ports.readFolder());
    const restored = saved === null ? null : this.ports.restoreDirectory(saved.uri);
    if (restored !== null) {
      this.directory = restored;
      return restored;
    }
    return this.pickDirectory();
  }

  private async pickDirectory(): Promise<SelectedDirectory | null> {
    let picked: SelectedDirectory;
    try {
      picked = await this.ports.pickDirectory();
    } catch (error) {
      if (this.ports.isPickerCancellation(error)) {
        return null;
      }
      throw error;
    }
    const folder: DownloadFolder = { name: picked.name, uri: picked.uri };
    await this.ports.writeFolder(JSON.stringify(folder));
    this.directory = picked;
    this.folder$.set(folder);
    return picked;
  }

  /** The folder in use or the remembered one, without asking the user. */
  private savedDirectory(): SelectedDirectory | null {
    if (this.directory !== null) {
      return this.directory;
    }
    const folder = this.folder$.peek();
    return folder === null ? null : this.ports.restoreDirectory(folder.uri);
  }

  private discardPartial(directory: SelectedDirectory, source: DownloadSource): void {
    try {
      this.ports.discardPartial(directory, source.path);
    } catch (error) {
      appLogger.warnCaught({ error, event: "downloads.partial_discard.failed" });
    }
  }

  private hydrate(): void {
    const live = this.entries$.peek();
    const liveIds = new Set(live.map((entry) => entry.id));
    const restored: DownloadEntry[] = [];
    for (const row of this.storage.rows()) {
      const entry = restoreDownloadEntry(row);
      if (entry !== null && !liveIds.has(entry.id)) {
        restored.push(entry);
      }
    }
    if (restored.length === 0) {
      return;
    }
    // The concatenation is a fresh array owned here, so sorting it in place is safe.
    const merged = [...live, ...restored];
    merged.sort((left, right) => right.startedAt - left.startedAt);
    this.entries$.set(merged);
  }

  private entry(id: DownloadId): DownloadEntry | undefined {
    return this.entries$.peek().find((entry) => entry.id === id);
  }

  /** Publishes a state change and records it in the history. */
  private transition(id: DownloadId, state: DownloadState): void {
    const entry = this.publishState(id, state);
    if (entry !== null) {
      this.persist(entry);
    }
  }

  private publishState(id: DownloadId, state: DownloadState): DownloadEntry | null {
    const entries = this.entries$.peek();
    const index = entries.findIndex((entry) => entry.id === id);
    const current = entries[index];
    if (current === undefined) {
      return null;
    }
    const updated: DownloadEntry = {
      id: current.id,
      name: current.name,
      source: current.source,
      startedAt: current.startedAt,
      state,
    };
    this.entries$.set(entries.map((entry, position) => (position === index ? updated : entry)));
    return updated;
  }

  private persist(entry: DownloadEntry): void {
    this.storage
      .put({ entry, id: entry.id, startedAt: entry.startedAt })
      .catch((error: unknown) => {
        appLogger.warnCaught({ error, event: "downloads.history_write.failed" });
      });
  }
}

/** Overall progress of running downloads for a compact indicator. */
export type DownloadsActivity =
  | { readonly status: "idle" }
  /** `progress` is 0..1, or `null` while no running download knows its size. */
  | { readonly progress: number | null; readonly running: number; readonly status: "running" };

export function downloadsActivity(entries: readonly DownloadEntry[]): DownloadsActivity {
  let running = 0;
  let total = 0;
  let transferred = 0;
  for (const { state } of entries) {
    if (state.status !== "running") {
      continue;
    }
    running += 1;
    if (state.totalBytes !== null && state.totalBytes > 0) {
      total += state.totalBytes;
      transferred += state.transferredBytes;
    }
  }
  if (running === 0) {
    return { status: "idle" };
  }
  return {
    progress: total === 0 ? null : Math.min(1, transferred / total),
    running,
    status: "running",
  };
}

function runningProgress(
  progress: TransferProgress,
): Extract<DownloadState, { readonly status: "running" }> {
  const verifying = progress.phase === "verifying";
  return {
    phase: verifying ? "verifying" : "transferring",
    status: "running",
    totalBytes: progress.total,
    // Verification rereads finished bytes; the download itself is complete.
    transferredBytes: verifying ? progress.total : progress.transferred,
  };
}

function decodeFolder(value: string | null): DownloadFolder | null {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const record = unknownRecord(parsed);
  return typeof record?.name === "string" && typeof record.uri === "string"
    ? { name: record.name, uri: record.uri }
    : null;
}
