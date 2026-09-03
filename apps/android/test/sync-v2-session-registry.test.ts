import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  SyncV2RequestError,
  type SyncV2Session,
  type SyncV2SessionSnapshot,
  type V2ProjectionStore,
  type V2SnapshotFrame,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import {
  SyncSessionRegistry,
  type SyncSessionFactory,
} from "../src/v2/infrastructure/sync/syncSessionRegistry";

const EMPTY: SyncV2SessionSnapshot = {
  operations: [],
  projections: { live: null, retained: null },
  state: "offline",
  version: 0,
};

describe("SyncSessionRegistry", () => {
  it("uses one stable projection authority while changing its current-thread intent", async () => {
    const created: Array<{
      currentThreadId: string | null;
      reconnect: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
      watchThread: ReturnType<typeof vi.fn>;
    }> = [];
    const createSession: NonNullable<ConstructorParameters<typeof SyncSessionRegistry>[2]> = async (
      _savedServerId,
      _projectionStore,
      _operationStore,
      currentThreadId,
    ) => {
      const reconnect = vi.fn();
      const release = vi.fn(async () => undefined);
      const watchThread = vi.fn(async () => undefined);
      const session = {
        reconnect,
        snapshot: async () => EMPTY,
        start: vi.fn(),
        stop: vi.fn(),
        subscribe: () => () => undefined,
        subscribeChange: () => () => undefined,
        watchThread,
      } as unknown as SyncV2Session;
      created.push({ currentThreadId, reconnect, release, watchThread });
      return { release, session };
    };
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      createSession,
    );

    const catalog = await registry.open("saved-server");
    const firstThread = await registry.open("saved-server", "thread-1");
    expect(firstThread).toBe(catalog);
    expect(await registry.open("saved-server")).toBe(catalog);
    expect(created.map(({ currentThreadId }) => currentThreadId)).toEqual([null]);
    expect(created[0]!.watchThread).toHaveBeenLastCalledWith("thread-1", 36);

    const secondThread = await registry.open("saved-server", "thread-2");
    expect(secondThread).toBe(firstThread);
    expect(created).toHaveLength(1);
    expect(created[0]!.watchThread).toHaveBeenCalledTimes(2);
    expect(created[0]!.watchThread).toHaveBeenLastCalledWith("thread-2", 36);
    expect(created[0]!.reconnect).not.toHaveBeenCalled();
    expect(created[0]!.release).not.toHaveBeenCalled();

    registry.reconnect("saved-server");
    await vi.waitFor(() => {
      expect(created[0]!.reconnect).toHaveBeenCalledOnce();
    });
    await registry.closeAll();
    expect(created[0]!.release).toHaveBeenCalledOnce();
  });

  it("keeps one session authority when a live thread watch fails", async () => {
    const reconnect = vi.fn();
    const release = vi.fn(async () => undefined);
    const watchThread = vi
      .fn<SyncV2Session["watchThread"]>()
      .mockRejectedValueOnce(new Error("watch failed"))
      .mockResolvedValue(undefined);
    const session = {
      reconnect,
      snapshot: async () => EMPTY,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread,
    } as unknown as SyncV2Session;
    const createSession = vi.fn(async () => ({ release, session }));
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      createSession,
    );

    const initial = await registry.open("saved-server");
    const watched = await registry.open("saved-server", "thread-1");
    expect(watched).toBe(initial);
    await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
    expect(initial.resource.requestedThreadAuthority()).toEqual({
      message: "watch failed",
      status: "error",
      threadId: "thread-1",
    });

    await registry.open("saved-server", "thread-1");
    await vi.waitFor(() => expect(watchThread).toHaveBeenCalledTimes(2));
    expect(initial.resource.requestedThreadAuthority()).toEqual({
      message: null,
      status: "ready",
      threadId: "thread-1",
    });

    expect(await registry.open("saved-server")).toBe(initial);
    expect(createSession).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    await registry.closeAll();
    expect(release).toHaveBeenCalledOnce();
  });

  it("surfaces a server-declared watch failure without reconnecting the old authority", async () => {
    const reconnect = vi.fn();
    const watchThread = vi
      .fn<SyncV2Session["watchThread"]>()
      .mockRejectedValueOnce(
        new SyncV2RequestError({
          code: "notFound",
          message: "thread is unavailable",
          recovery: "requery",
        }),
      )
      .mockResolvedValue(undefined);
    const session = {
      reconnect,
      snapshot: async () => EMPTY,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread,
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );

    const entry = await registry.open("saved-server");
    await registry.open("saved-server", "thread-2");
    await vi.waitFor(() => {
      expect(entry.resource.requestedThreadAuthority()).toEqual({
        message: "thread is unavailable",
        status: "error",
        threadId: "thread-2",
      });
    });
    expect(reconnect).not.toHaveBeenCalled();

    await registry.open("saved-server", "thread-2");
    await vi.waitFor(() => {
      expect(entry.resource.requestedThreadAuthority()).toEqual({
        message: null,
        status: "ready",
        threadId: "thread-2",
      });
    });
    expect(watchThread).toHaveBeenCalledTimes(2);
    await registry.closeAll();
  });

  it("returns to the requested thread when an older watch completes after navigation changed", async () => {
    let resolveOldWatch!: () => void;
    const oldWatch = new Promise<void>((resolve) => {
      resolveOldWatch = resolve;
    });
    const watchThread = vi
      .fn<SyncV2Session["watchThread"]>()
      .mockReturnValueOnce(oldWatch)
      .mockResolvedValue(undefined);
    const session = {
      reconnect: vi.fn(),
      snapshot: async () => EMPTY,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread,
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );
    const entry = await registry.open("saved-server", "thread-1");

    await registry.open("saved-server", "thread-2");
    await vi.waitFor(() => expect(watchThread).toHaveBeenCalledWith("thread-2", 36));
    await registry.open("saved-server", "thread-1");
    resolveOldWatch();

    await vi.waitFor(() => expect(watchThread).toHaveBeenCalledTimes(2));
    expect(watchThread).toHaveBeenLastCalledWith("thread-1", 36);
    expect(entry.resource.requestedThreadAuthority()).toEqual({
      message: null,
      status: "ready",
      threadId: "thread-1",
    });
    await registry.closeAll();
  });

  it("does not reconnect an orphaned thread watch after its registry entry closes", async () => {
    let rejectWatch!: (cause: Error) => void;
    const watch = new Promise<void>((_resolve, reject) => {
      rejectWatch = reject;
    });
    const reconnect = vi.fn();
    const session = {
      reconnect,
      snapshot: async () => EMPTY,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread: vi.fn(() => watch),
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );

    await registry.open("saved-server");
    await registry.open("saved-server", "thread-1");
    await vi.waitFor(() => expect(session.watchThread).toHaveBeenCalledOnce());
    await registry.close("saved-server");
    rejectWatch(new Error("closed watch"));
    await Promise.allSettled([watch]);
    await Promise.resolve();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("returns retained projection authority without waiting for a live watch reply", async () => {
    const watchThread = vi.fn(() => new Promise<void>(() => undefined));
    const session = {
      reconnect: vi.fn(),
      snapshot: async () => EMPTY,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread,
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );
    const retained = await registry.open("saved-server");

    await expect(registry.open("saved-server", "thread-1")).resolves.toBe(retained);
    await vi.waitFor(() => expect(watchThread).toHaveBeenCalledOnce());
    expect(retained.resource.requestedThreadAuthority()).toEqual({
      message: null,
      status: "loading",
      threadId: "thread-1",
    });
  });

  it("does not authorize an initial thread until the live projection matches that thread", async () => {
    let live = liveSnapshot("thread-old");
    const session = {
      reconnect: vi.fn(),
      snapshot: async () => live,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread: vi.fn(async () => undefined),
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );

    const entry = await registry.open("saved-server", "thread-new");
    await entry.resource.refresh();
    expect(entry.resource.requestedThreadAuthority()).toEqual({
      message: null,
      status: "loading",
      threadId: "thread-new",
    });

    live = liveSnapshot("thread-new");
    await entry.resource.refresh();
    expect(entry.resource.requestedThreadAuthority()).toEqual({
      message: null,
      status: "ready",
      threadId: "thread-new",
    });
    await registry.closeAll();
  });

  it("surfaces an initial thread authority failure and permits an explicit retry", async () => {
    const session = {
      reconnect: vi.fn(),
      snapshot: async () => liveSnapshot("thread-new"),
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread: vi.fn(async () => undefined),
    } as unknown as SyncV2Session;
    const createSession = vi
      .fn<SyncSessionFactory>()
      .mockRejectedValueOnce(new Error("initial open failed"))
      .mockResolvedValue({ release: async () => undefined, session });
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      createSession,
    );

    await expect(registry.open("saved-server", "thread-new")).rejects.toThrow(
      "initial open failed",
    );
    expect(registry.resource("saved-server").requestedThreadAuthority()).toEqual({
      message: "initial open failed",
      status: "error",
      threadId: "thread-new",
    });

    const retried = await registry.open("saved-server", "thread-new");
    await retried.resource.refresh();
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(retried.resource.requestedThreadAuthority()).toEqual({
      message: null,
      status: "ready",
      threadId: "thread-new",
    });
    await registry.closeAll();
  });

  it("publishes a retained projection before live session creation completes", async () => {
    const projectionStore = new MemoryV2ProjectionStore();
    await projectionStore.commitSnapshot("saved-server", retainedSnapshot());
    await projectionStore.abandonEpoch("saved-server", "epoch-retained");
    let resolveCreation!: (created: { release(): Promise<void>; session: SyncV2Session }) => void;
    const creation = new Promise<{ release(): Promise<void>; session: SyncV2Session }>(
      (resolve) => {
        resolveCreation = resolve;
      },
    );
    const registry = new SyncSessionRegistry(
      projectionStore,
      new MemoryV2OperationStore(),
      () => creation,
    );
    const resource = registry.resource("saved-server");
    const opening = registry.open("saved-server");

    await vi.waitFor(() => {
      expect(resource.snapshot()).toMatchObject({
        status: "ready",
        value: {
          projections: {
            live: null,
            retained: { epochId: "epoch-retained" },
          },
          state: "offline",
        },
      });
    });

    const session = {
      reconnect: vi.fn(),
      snapshot: async () => EMPTY,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread: vi.fn(async () => undefined),
    } as unknown as SyncV2Session;
    resolveCreation({ release: async () => undefined, session });
    await opening;
    await registry.closeAll();
  });

  it("does not let a stale retained read replace an attached live snapshot", async () => {
    const projections = new MemoryV2ProjectionStore();
    await projections.commitSnapshot("saved-server", retainedSnapshot());
    let releaseRetainedRead!: () => void;
    const retainedRead = new Promise<void>((resolve) => {
      releaseRetainedRead = resolve;
    });
    const delayedStore: V2ProjectionStore = {
      abandonEpoch: (savedServerId, epochId) => projections.abandonEpoch(savedServerId, epochId),
      active: (savedServerId) => projections.active(savedServerId),
      applyChange: (savedServerId, epochId, watermark, change) =>
        projections.applyChange(savedServerId, epochId, watermark, change),
      commitSnapshot: (savedServerId, value, signal) =>
        projections.commitSnapshot(savedServerId, value, signal),
      deleteSavedServer: (savedServerId) => projections.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => projections.hasSavedServerData(savedServerId),
      retained: async (savedServerId) => {
        const retained = await projections.retained(savedServerId);
        await retainedRead;
        return retained;
      },
      subscribe: (savedServerId, listener) => projections.subscribe(savedServerId, listener),
    };
    const live = { ...EMPTY, state: "live" as const, version: 1 };
    const session = {
      reconnect: vi.fn(),
      snapshot: async () => live,
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread: vi.fn(async () => undefined),
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      delayedStore,
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );
    const resource = registry.resource("saved-server");

    await registry.open("saved-server");
    await vi.waitFor(() => expect(resource.snapshot().value.state).toBe("live"));
    releaseRetainedRead();
    await vi.waitFor(() => expect(resource.snapshot().value).toBe(live));
    await registry.closeAll();
  });

  it("does not let an older session read replace a newer authoritative publication", async () => {
    let resolveOlder!: (snapshot: SyncV2SessionSnapshot) => void;
    let olderReadCompleted = false;
    const older = new Promise<SyncV2SessionSnapshot>((resolve) => {
      resolveOlder = resolve;
    });
    const newer = { ...liveSnapshot("thread-new"), version: 2 };
    const session = {
      reconnect: vi.fn(),
      snapshot: vi
        .fn<SyncV2Session["snapshot"]>()
        .mockImplementationOnce(async () => {
          const snapshot = await older;
          olderReadCompleted = true;
          return snapshot;
        })
        .mockResolvedValue(newer),
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: () => () => undefined,
      subscribeChange: () => () => undefined,
      watchThread: vi.fn(async () => undefined),
    } as unknown as SyncV2Session;
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      async () => ({ release: async () => undefined, session }),
    );
    const entry = await registry.open("saved-server");
    await vi.waitFor(() => expect(session.snapshot).toHaveBeenCalledOnce());

    await entry.resource.refresh();
    expect(entry.resource.snapshot().value).toBe(newer);
    resolveOlder(liveSnapshot("thread-old"));
    await vi.waitFor(() => expect(olderReadCompleted).toBe(true));
    await Promise.resolve();
    expect(entry.resource.snapshot().value).toBe(newer);
    await registry.closeAll();
  });
});

function retainedSnapshot(): V2SnapshotFrame {
  return {
    type: "snapshot",
    version: 2,
    sourceGeneration: "1",
    epochId: "epoch-retained",
    revision: "sync-v2-revision:retained",
    watermark: "0",
    scope: {
      active: { limit: 1, returned: 1, complete: true },
      archived: { limit: 1, returned: 0, complete: true },
    },
    catalog: {
      active: [
        {
          id: "thread-retained",
          parentId: null,
          title: "Retained",
          preview: "",
          workspace: "/workspace",
          archived: false,
          state: "idle",
          settings: null,
          readState: {
            kind: "unknown",
            latestActivityMarker: null,
            readThroughMarker: null,
            unreadCount: null,
          },
          createdAt: "2026-08-27T12:00:00Z",
          updatedAt: "2026-08-27T12:00:00Z",
          lastActivityAt: null,
          headTurnId: null,
        },
      ],
      archived: [],
    },
    currentThread: null,
    pendingRequests: [],
    includedTail: [],
    limits: {
      catalogPerPartitionMax: 100,
      turnWindowMax: 36,
      historyPageMax: 100,
      queueMaxEvents: 2_048,
      queueMaxBytes: 4_194_304,
    },
  };
}

function liveSnapshot(threadId: string): SyncV2SessionSnapshot {
  return {
    operations: [],
    projections: {
      live: {
        catalog: [],
        currentThread: {
          newerCursor: null,
          olderCursor: null,
          thread: {
            ...retainedSnapshot().catalog.active[0]!,
            id: threadId,
          },
          turns: [],
        },
        epochId: "epoch-live",
        pendingRequests: [],
        revision: "sync-v2-revision:live",
        watermark: "0",
      },
      retained: null,
    },
    state: "live",
    version: 1,
  };
}
