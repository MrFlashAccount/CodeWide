import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createV1TestThread } from "./fixtures/v1Thread";
import { createThreadSyncProjection } from "../src/data/thread-sync-projection";
import { createThreadSummaryRepair } from "../src/data/threadSummaryRepair";
import { OrderedProjectionAcknowledger } from "../src/native/ordered-projection-acknowledger";

const sqlite = await vi.hoisted(async () => {
  const { sqliteFixture } = await import("./thread-catalog-pagination.fixture");
  return sqliteFixture();
});

// WHY: Replace only the unavailable Android JSI connection. Persistence, queries,
// event projection, summary recovery and acknowledgement use their production owners.
vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
}));

import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";

beforeEach(async () => {
  await sqlite.settled();
  sqlite.native.exec("DROP TABLE IF EXISTS codewide_thread_summaries");
});

function snapshot(id = "thread"): SyncSnapshotThread {
  return {
    archived: false,
    thread: {
      ...createV1TestThread(id, null, 1, []),
      name: "Old name",
      status: { type: "active", activeFlags: [] },
    },
  };
}

function status(cursor: number, type: "active" | "idle", threadId = "thread"): SyncEvent {
  return {
    cursor,
    payload: {
      method: "thread/status/changed",
      codewideThreadPatch: {
        version: 1,
        threadId,
        operation: {
          kind: "threadStatus",
          status: type === "active" ? { type, activeFlags: [] } : { type },
        },
      },
    },
  };
}

function name(cursor: number, threadName: string): SyncEvent {
  return {
    cursor,
    payload: {
      method: "thread/name/updated",
      codewideThreadPatch: {
        version: 1,
        threadId: "thread",
        operation: { kind: "threadName", threadName },
      },
    },
  };
}

function completed(cursor: number): SyncEvent {
  return {
    cursor,
    payload: {
      method: "turn/completed",
      codewideThreadPatch: {
        version: 1,
        threadId: "thread",
        operation: {
          kind: "turnCompleted",
          turn: { id: "turn", status: "completed", items: [] },
          summary: { activity: true, finalAgentResponse: true, previewText: "Final answer" },
        },
      },
    },
  };
}

describe("summary synchronization and durable recovery", () => {
  it("keeps a newer idle status and name through an older snapshot and database reopen", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    await summaries.mergeSnapshots("server", [snapshot()], 5);
    await summaries.applyEvents("server", [status(10, "idle"), name(11, "New name")]);
    await summaries.mergeSnapshots("server", [snapshot()], 8);
    expect(await summaries.get("server", "thread")).toMatchObject({
      name: "New name",
      status: { type: "idle" },
      latestActivityCursor: 0,
    });
    summaries.close();
    const reopened = createThreadSummaryDatabase();
    await reopened.prepare();
    await reopened.mergeSnapshots("server", [snapshot()], 8);
    expect(await reopened.get("server", "thread")).toMatchObject({
      name: "New name",
      status: { type: "idle" },
    });
    reopened.close();
  });

  it("accepts a newer snapshot and does not let older replay restore a previous status", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    await summaries.mergeSnapshots("server", [snapshot()], 5);
    await summaries.applyEvents("server", [status(10, "idle")]);
    await summaries.mergeSnapshots("server", [snapshot()], 12);
    await summaries.applyEvents("server", [status(10, "idle")]);
    expect((await summaries.get("server", "thread"))?.status.type).toBe("active");
    summaries.close();
  });

  it("keeps newer rows through an older recovery snapshot and retires them from a newer snapshot", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    await summaries.mergeSnapshots("server", [snapshot(), snapshot("absent")], 5);
    await summaries.applyEvents("server", [status(10, "idle"), status(11, "idle", "absent")]);
    await summaries.applySnapshot("server", [snapshot()], 8);
    expect((await summaries.get("server", "thread"))?.status.type).toBe("idle");
    expect((await summaries.get("server", "absent"))?.status.type).toBe("idle");
    await summaries.applyEvents("server", [status(10, "idle"), status(11, "idle", "absent")]);
    expect((await summaries.get("server", "thread"))?.status.type).toBe("idle");
    await summaries.applySnapshot("server", [snapshot()], 12);
    expect((await summaries.get("server", "thread"))?.status.type).toBe("active");
    expect(await summaries.get("server", "absent")).toBeNull();
    summaries.close();
  });

  it("defers ACK for a missing row, replays trailing events and leaves other chats live", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    await summaries.mergeSnapshots("server", [snapshot("other")], 1);
    const metadata = Promise.withResolvers<SyncSnapshotThread>();
    const readMetadata = vi.fn(() => metadata.promise);
    type Ports = Parameters<typeof createThreadSyncProjection>[0];
    // WHY: Only transport/account/resource ports outside this summary regression
    // are fixtures. Summary persistence, projection, recovery and ACK are real.
    const projection = createThreadSyncProjection({
      accountRateLimits: {},
      catalog: {
        readThreadSummary: readMetadata,
        refreshConnectionWindows: vi.fn(),
        refreshInvalidatedThread: vi.fn(),
      },
      details: { applyEvents: async () => ({ checkpoint: Promise.resolve(), threads: new Map() }) },
      resources: { threadResources: new Map() },
      summaries,
      sync: {},
    } as unknown as Ports);
    const failures: unknown[] = [];
    const acknowledger = new OrderedProjectionAcknowledger((error) => failures.push(error));
    const acknowledged: number[] = [];
    const events = [completed(7)];
    const first = (await projection.applyEvents("server", events)).checkpoint;
    acknowledger.enqueue({
      recovery: false,
      checkpoint: first,
      acknowledge: () => acknowledged.push(7),
    });
    await vi.waitFor(() =>
      expect(readMetadata).toHaveBeenCalledExactlyOnceWith("server", "thread"),
    );
    const trailing = (await projection.applyEvents("server", [name(8, "Recovered name")]))
      .checkpoint;
    acknowledger.enqueue({
      recovery: false,
      checkpoint: trailing,
      acknowledge: () => acknowledged.push(8),
    });
    await (
      await projection.applyEvents("server", [status(9, "idle", "other")])
    ).checkpoint;
    expect((await summaries.get("server", "other"))?.status.type).toBe("idle");
    expect(await summaries.get("server", "thread")).toBeNull();
    expect(acknowledged).toEqual([]);
    metadata.resolve(snapshot());
    await acknowledger.settled();
    expect(failures).toEqual([]);
    expect(acknowledged).toEqual([7, 8]);
    expect(await summaries.get("server", "thread")).toMatchObject({
      name: "Recovered name",
      preview: "Final answer",
      status: { type: "idle" },
      unread: 1,
    });
    expect(readMetadata).toHaveBeenCalledTimes(1);
    summaries.close();
    const reopened = createThreadSummaryDatabase();
    await reopened.prepare();
    expect(await reopened.get("server", "thread")).toMatchObject({
      name: "Recovered name",
      preview: "Final answer",
      status: { type: "idle" },
      unread: 1,
    });
    reopened.close();
  });

  it("does not ACK a failed metadata read and recovers from journal replay", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    const readMetadata = vi.fn(async () => snapshot());
    readMetadata.mockRejectedValueOnce(new Error("Metadata unavailable"));
    const repair = createThreadSummaryRepair({ readMetadata, summaries });
    const failed = vi.fn();
    const acknowledger = new OrderedProjectionAcknowledger(failed);
    const acknowledge = vi.fn();
    const events = [completed(7)];
    acknowledger.enqueue({ recovery: false, checkpoint: repair("server", events), acknowledge });
    await acknowledger.settled();
    expect(failed).toHaveBeenCalledOnce();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(acknowledger.blocked).toBe(true);
    acknowledger.enqueue({ recovery: true, checkpoint: repair("server", events), acknowledge });
    await acknowledger.settled();
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(acknowledger.blocked).toBe(false);
    expect(await summaries.get("server", "thread")).toMatchObject({
      preview: "Final answer",
      status: { type: "idle" },
      unread: 1,
    });
    summaries.close();
  });

  it("does not recreate a chat deleted while its metadata read is pending", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    const metadata = Promise.withResolvers<SyncSnapshotThread>();
    const readMetadata = vi.fn(() => metadata.promise);
    const repair = createThreadSummaryRepair({ readMetadata, summaries });
    const checkpoint = repair("server", [completed(7)]);
    await vi.waitFor(() => expect(readMetadata).toHaveBeenCalledOnce());
    const deleted: SyncEvent = {
      cursor: 8,
      payload: {
        method: "thread/deleted",
        codewideThreadPatch: {
          version: 1,
          threadId: "thread",
          operation: { kind: "threadDeleted" },
        },
      },
    };
    const deletionCheckpoint = repair("server", [deleted]);
    metadata.resolve(snapshot());
    await Promise.all([checkpoint, deletionCheckpoint]);
    expect(await summaries.get("server", "thread")).toBeNull();
    summaries.close();
  });

  it("respects server exclusion that arrives during metadata recovery", async () => {
    const summaries = createThreadSummaryDatabase();
    await summaries.prepare();
    const metadata = Promise.withResolvers<SyncSnapshotThread>();
    const readMetadata = vi.fn(() => metadata.promise);
    const repair = createThreadSummaryRepair({ readMetadata, summaries });
    const checkpoint = repair("server", [completed(7)]);
    await vi.waitFor(() => expect(readMetadata).toHaveBeenCalledOnce());
    const event = status(8, "idle");
    const exclusion = repair("server", [
      { ...event, payload: { ...event.payload, codewideCatalogExcluded: true } },
    ]);
    metadata.resolve(snapshot());
    await Promise.all([checkpoint, exclusion]);
    expect(await summaries.get("server", "thread")).toBeNull();
    summaries.close();
  });

  it.each(["deleted", "excluded"] as const)(
    "settles recovery when a %s chat can no longer be read",
    async (removal) => {
      const summaries = createThreadSummaryDatabase();
      await summaries.prepare();
      const metadata = Promise.withResolvers<SyncSnapshotThread>();
      const readMetadata = vi.fn(() => metadata.promise);
      const repair = createThreadSummaryRepair({ readMetadata, summaries });
      const checkpoint = repair("server", [completed(7)]);
      await vi.waitFor(() => expect(readMetadata).toHaveBeenCalledOnce());
      const event =
        removal === "deleted"
          ? {
              cursor: 8,
              payload: {
                method: "thread/deleted",
                codewideThreadPatch: {
                  version: 1,
                  threadId: "thread",
                  operation: { kind: "threadDeleted" },
                },
              },
            }
          : { cursor: 8, payload: { ...status(8, "idle").payload, codewideCatalogExcluded: true } };
      const removalCheckpoint = repair("server", [event]);
      metadata.reject(new Error("Thread unavailable"));
      await expect(Promise.all([checkpoint, removalCheckpoint])).resolves.toEqual([
        undefined,
        undefined,
      ]);
      expect(await summaries.get("server", "thread")).toBeNull();
      summaries.close();
    },
  );
});
