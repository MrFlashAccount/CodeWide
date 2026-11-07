import { describe, expect, it, vi } from "vitest";

import { createDownloadHistoryStorage } from "../src/data/downloadHistoryStorage.web";
import {
  DownloadManager,
  downloadsActivity,
  type DownloadPorts,
  type DownloadTransferStart,
} from "../src/data/downloadManager";
import { createDownloadId, type DownloadEntry } from "../src/data/downloadRecords";
import type { RunningDownload, SelectedDirectory } from "../src/native/file-transfer";

type TransferResult = Awaited<RunningDownload["promise"]>;

/** One controllable native transfer: the test reports progress and settles it. */
type FakeTransfer = {
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly fail: (error: Error) => void;
  readonly finish: (result: TransferResult) => void;
  readonly pause: ReturnType<typeof vi.fn>;
  readonly progress: (transferred: number, total: number) => void;
};

const access = async () => {
  await Promise.resolve();
  throw new Error("Transfers are faked in this test");
};
const folder: SelectedDirectory = { name: "Downloads", native: {}, uri: "content://downloads" };
const video = {
  getAccess: access,
  name: "repro.mp4",
  source: { kind: "path", path: "/srv/repro.mp4" },
} as const;
const saved: TransferResult = {
  bytes: 2048,
  mimeType: "video/mp4",
  sha256: "a".repeat(64),
  uri: "content://downloads/repro.mp4",
};

function harness(overrides: Partial<DownloadPorts> = {}) {
  const transfers: FakeTransfer[] = [];
  let storedFolder: string | null = null;
  let clock = 1_000;
  const ports: DownloadPorts = {
    deleteFile: vi.fn(),
    discardPartial: vi.fn(),
    isPickerCancellation: (error) => error instanceof Error && error.message === "picker cancelled",
    now: () => {
      clock += 1_000;
      return clock;
    },
    pickDirectory: vi.fn(async () => folder),
    readFolder: async () => storedFolder,
    restoreDirectory: vi.fn((uri: string) => (uri === folder.uri ? folder : null)),
    start: vi.fn(({ onProgress }: DownloadTransferStart) => {
      let settle: { reject: (error: Error) => void; resolve: (value: TransferResult) => void };
      const promise = new Promise<TransferResult>((resolve, reject) => {
        settle = { reject, resolve };
      });
      const stop = (): void => {
        settle.reject(new Error("Transfer cancelled"));
      };
      const transfer: FakeTransfer = {
        cancel: vi.fn(stop),
        fail: (error) => {
          settle.reject(error);
        },
        finish: (result) => {
          settle.resolve(result);
        },
        pause: vi.fn(stop),
        progress: (transferred, total) => {
          onProgress({ phase: "transferring", total, transferred });
        },
      };
      transfers.push(transfer);
      return { cancel: transfer.cancel, pause: transfer.pause, promise };
    }),
    writeFolder: async (value) => {
      storedFolder = value;
      await Promise.resolve();
    },
    ...overrides,
  };
  const storage = createDownloadHistoryStorage();
  return {
    manager: new DownloadManager(storage, ports),
    ports,
    reopen: () => new DownloadManager(storage, ports),
    storage,
    transfer: (index: number): FakeTransfer => {
      const transfer = transfers[index];
      if (transfer === undefined) {
        throw new Error(`Transfer ${String(index)} did not start`);
      }
      return transfer;
    },
  };
}

function only(manager: DownloadManager): DownloadEntry {
  const [entry, ...rest] = manager.entries$.get();
  expect(rest).toEqual([]);
  if (entry === undefined) {
    throw new Error("No download entry");
  }
  return entry;
}

async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("download manager", () => {
  it("publishes progress and completes into the folder it asked for once", async () => {
    const { manager, ports, transfer } = harness();
    const first = manager.start(video);
    await settled();
    transfer(0).progress(1024, 2048);
    expect(only(manager).state).toMatchObject({ status: "running", transferredBytes: 1024 });
    transfer(0).finish(saved);
    await expect(first).resolves.toMatchObject({ status: "completed", uri: saved.uri });
    expect(only(manager).state).toMatchObject({ bytes: 2048, status: "completed", uri: saved.uri });
    expect(manager.folder$.get()).toEqual({ name: "Downloads", uri: folder.uri });

    const second = manager.start(video);
    await settled();
    transfer(1).finish(saved);
    await second;
    expect(ports.pickDirectory).toHaveBeenCalledTimes(1);
    expect(manager.entries$.get()).toHaveLength(2);
  });

  it("starts nothing when the folder picker is dismissed", async () => {
    const { manager, ports } = harness({
      pickDirectory: async () => {
        await Promise.resolve();
        throw new Error("picker cancelled");
      },
    });
    await expect(manager.start(video)).resolves.toEqual({ status: "dismissed" });
    expect(manager.entries$.get()).toEqual([]);
    expect(ports.start).not.toHaveBeenCalled();
  });

  it("pauses keeping the partial file and resumes into the same folder", async () => {
    const { manager, ports, transfer } = harness();
    const run = manager.start(video);
    await settled();
    transfer(0).progress(512, 2048);
    const { id } = only(manager);
    manager.pause(id);
    expect(transfer(0).pause).toHaveBeenCalledTimes(1);
    expect(transfer(0).cancel).not.toHaveBeenCalled();
    await expect(run).resolves.toEqual({ status: "stopped" });
    expect(only(manager).state).toMatchObject({ status: "paused", transferredBytes: 512 });

    const resumed = manager.resume(id);
    expect(only(manager).state).toMatchObject({ status: "running", transferredBytes: 512 });
    transfer(1).finish(saved);
    await expect(resumed).resolves.toMatchObject({ status: "completed" });
    expect(ports.start).toHaveBeenLastCalledWith({
      directory: folder,
      getAccess: access,
      onProgress: expect.any(Function),
      source: video.source,
    });
  });

  it("cancels a running download and a paused one, discarding their partial files", async () => {
    const { manager, ports, transfer } = harness();
    void manager.start(video);
    await settled();
    const running = only(manager).id;
    manager.cancel(running);
    expect(transfer(0).cancel).toHaveBeenCalledTimes(1);
    expect(only(manager).state).toEqual({ status: "cancelled" });

    const retried = manager.retry(running);
    transfer(1).progress(100, 2048);
    manager.pause(running);
    await retried;
    manager.cancel(running);
    expect(ports.discardPartial).toHaveBeenCalledWith(folder, "/srv/repro.mp4");
    expect(only(manager).state).toEqual({ status: "cancelled" });
  });

  it("reports a failure and retries it with the original access", async () => {
    const { manager, transfer } = harness();
    const run = manager.start(video);
    await settled();
    transfer(0).fail(new Error("Download range failed (503)"));
    await expect(run).resolves.toMatchObject({ status: "failed" });
    const entry = only(manager);
    expect(entry.state).toEqual({ error: "Download range failed (503)", status: "failed" });
    expect(manager.canRestart(entry.id)).toBe(true);

    const retried = manager.retry(entry.id);
    transfer(1).finish(saved);
    await expect(retried).resolves.toMatchObject({ status: "completed" });
  });

  it("removes an entry without touching the saved file, and deletes it on request", async () => {
    const { manager, ports, transfer } = harness();
    for (const index of [0, 1]) {
      const run = manager.start(video);
      await settled();
      transfer(index).finish(saved);
      await run;
    }
    const [newest, oldest] = manager.entries$.get();
    if (newest === undefined || oldest === undefined) {
      throw new Error("Expected two downloads");
    }
    manager.remove(newest.id);
    expect(ports.deleteFile).not.toHaveBeenCalled();
    manager.deleteFile(oldest.id);
    expect(ports.deleteFile).toHaveBeenCalledWith(saved.uri);
    expect(manager.entries$.get()).toEqual([]);
  });

  it("restores history after a restart, with unfinished downloads interrupted", async () => {
    const { manager, ports, reopen, transfer } = harness();
    const finished = manager.start(video);
    await settled();
    transfer(0).finish(saved);
    await finished;
    void manager.start({ ...video, name: "second.mp4" });
    await settled();
    transfer(1).progress(300, 2048);
    const [unfinished] = manager.entries$.get();
    if (unfinished === undefined) {
      throw new Error("Expected the second download");
    }
    manager.pause(unfinished.id);
    await settled();

    const restarted = reopen();
    await settled();
    const restored = restarted.entries$.get();
    expect(restored.map((entry) => [entry.name, entry.state.status])).toEqual([
      ["second.mp4", "interrupted"],
      ["repro.mp4", "completed"],
    ]);
    expect(restored.every((entry) => !restarted.canRestart(entry.id))).toBe(true);
    expect(restarted.folder$.get()).toEqual({ name: "Downloads", uri: folder.uri });

    void restarted.start(video);
    await settled();
    expect(ports.pickDirectory).toHaveBeenCalledTimes(1);
  });
});

describe("downloads activity", () => {
  it("sums running downloads and ignores finished or paused ones", () => {
    const entry = (state: DownloadEntry["state"]): DownloadEntry => ({
      id: createDownloadId(1),
      name: "file",
      source: { kind: "path", path: "/f" },
      startedAt: 1,
      state,
    });
    const entries = [
      entry({ phase: "transferring", status: "running", totalBytes: 100, transferredBytes: 50 }),
      entry({ phase: "transferring", status: "running", totalBytes: 300, transferredBytes: 50 }),
      entry({ status: "paused", totalBytes: 100, transferredBytes: 10 }),
      entry({ status: "cancelled" }),
    ];
    expect(downloadsActivity(entries)).toEqual({ progress: 0.25, running: 2, status: "running" });
    expect(downloadsActivity(entries.slice(2))).toEqual({ status: "idle" });
  });
});
