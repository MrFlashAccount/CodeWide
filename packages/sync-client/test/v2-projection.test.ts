import { describe, expect, it } from "vitest";

import {
  MemoryV2ProjectionStore,
  MemoryV2OperationStore,
  SyncV2Session,
  type V2ProjectionStore,
  type V2ThreadWindow,
} from "../src/v2/index.js";
import {
  FakeV2Socket,
  defaultIntent,
  makeLive,
  savedServerA,
  savedServerB,
  setup,
  snapshot,
  thread,
  waitFor,
} from "./v2-fixtures.js";

describe("Sync V2 projection generations", () => {
  it("publishes distinct observable Live and retained projection views", async () => {
    const store = new MemoryV2ProjectionStore();
    let publications = 0;
    const unsubscribe = store.subscribe(savedServerA, () => {
      publications += 1;
    });
    await store.commitSnapshot(
      savedServerA,
      snapshot({
        currentThread: {
          thread: thread("thread-1"),
          turns: [],
          olderCursor: null,
          newerCursor: null,
        },
      }),
    );
    expect(await store.active(savedServerA)).not.toBeNull();
    expect(await store.retained(savedServerA)).not.toBeNull();
    await store.abandonEpoch(savedServerA, "epoch-1");
    expect(await store.active(savedServerA)).toBeNull();
    expect(await store.retained(savedServerA)).toMatchObject({
      currentThread: { thread: { id: "thread-1" } },
      pendingRequests: expect.any(Array),
      scope: { active: { returned: 1 } },
    });
    expect(publications).toBe(2);
    unsubscribe();
  });

  it("isolates throwing observers from committed projection mutations", async () => {
    const store = new MemoryV2ProjectionStore();
    let peerPublications = 0;
    store.subscribe(savedServerA, () => {
      throw new Error("observer failed");
    });
    store.subscribe(savedServerA, () => {
      peerPublications += 1;
    });

    await expect(store.commitSnapshot(savedServerA, snapshot())).resolves.not.toBeNull();
    expect(peerPublications).toBe(1);
    expect(await store.active(savedServerA)).not.toBeNull();
  });

  it("exposes session-owned projection and operation observation without duplicating state", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(projections, operations);
    let publications = 0;
    const unsubscribe = session.subscribe(() => {
      publications += 1;
    });
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);
    socket.open();
    socket.emit(snapshot());
    await waitFor(() => socket.sent.some((frame) => frame.type === "snapshotCommitted"));
    socket.emit({ type: "live", epochId: "epoch-1", watermark: "0" });
    await waitFor(() => session.state === "live");
    await operations.create(savedServerA, "operation-observed", {
      kind: "thread.delete",
      threadId: "thread",
    });
    const observed = await session.snapshot();
    expect(observed.state).toBe("live");
    expect(observed.version).toBeGreaterThan(0);
    expect(observed.projections.live?.epochId).toBe("epoch-1");
    expect(observed.projections.live?.sourceGeneration).toBe("1");
    expect(observed.projections.retained?.epochId).toBe("epoch-1");
    expect(observed.operations.map(({ operationId }) => operationId)).toContain(
      "operation-observed",
    );
    expect(observed.operations[0]).not.toHaveProperty("command");
    expect(observed.operations[0]).not.toHaveProperty("commandFingerprint");
    expect(publications).toBeGreaterThan(0);
    session.stop();
    const offline = await session.projectionViews();
    expect(offline.live).toBeNull();
    expect(offline.retained?.epochId).toBe("epoch-1");
    unsubscribe();
  });

  it("retries a session snapshot when a store publishes between reads", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    const baseActive = projections.active.bind(projections);
    let injected = false;
    const store: V2ProjectionStore = {
      active: async (savedServerId) => {
        const value = await baseActive(savedServerId);
        if (!injected) {
          injected = true;
          await operations.create(savedServerId, "during-snapshot", {
            kind: "thread.delete",
            threadId: "thread",
          });
        }
        return value;
      },
      retained: (savedServerId) => projections.retained(savedServerId),
      subscribe: (savedServerId, listener) => projections.subscribe(savedServerId, listener),
      commitSnapshot: (savedServerId, value, signal) =>
        projections.commitSnapshot(savedServerId, value, signal),
      applyChange: (savedServerId, epochId, watermark, change) =>
        projections.applyChange(savedServerId, epochId, watermark, change),
      abandonEpoch: (savedServerId, epochId) => projections.abandonEpoch(savedServerId, epochId),
      hasSavedServerData: (savedServerId) => projections.hasSavedServerData(savedServerId),
      deleteSavedServer: (savedServerId) => projections.deleteSavedServer(savedServerId),
    };
    const { socket, session } = setup(store, operations);
    const unsubscribe = session.subscribe(() => undefined);
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);
    socket.open();
    socket.emit(snapshot());
    await waitFor(() => socket.sent.some((frame) => frame.type === "snapshotCommitted"));
    socket.emit({ type: "live", epochId: "epoch-1", watermark: "0" });
    await waitFor(() => session.state === "live");

    const observed = await session.snapshot();
    expect(observed.operations.map(({ operationId }) => operationId)).toContain("during-snapshot");
    unsubscribe();
    session.stop();
  });

  it("keeps snapshot versioning coherent before any public subscriber exists", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    const baseRetained = projections.retained.bind(projections);
    let retainedReads = 0;
    const store: V2ProjectionStore = {
      active: (savedServerId) => projections.active(savedServerId),
      retained: async (savedServerId) => {
        retainedReads += 1;
        const value = await baseRetained(savedServerId);
        if (retainedReads === 1) {
          await operations.create(savedServerId, "no-subscriber-race", {
            kind: "thread.delete",
            threadId: "thread",
          });
        }
        return value;
      },
      subscribe: (savedServerId, listener) => projections.subscribe(savedServerId, listener),
      commitSnapshot: (savedServerId, value, signal) =>
        projections.commitSnapshot(savedServerId, value, signal),
      applyChange: (savedServerId, epochId, watermark, change) =>
        projections.applyChange(savedServerId, epochId, watermark, change),
      abandonEpoch: (savedServerId, epochId) => projections.abandonEpoch(savedServerId, epochId),
      hasSavedServerData: (savedServerId) => projections.hasSavedServerData(savedServerId),
      deleteSavedServer: (savedServerId) => projections.deleteSavedServer(savedServerId),
    };
    const { session } = setup(store, operations);

    const observed = await session.snapshot();

    expect(retainedReads).toBe(2);
    expect(observed.operations.map(({ operationId }) => operationId)).toContain(
      "no-subscriber-race",
    );
    session.stop();
  });

  it("isolates state callbacks and revokes mutation admission on transport errors", async () => {
    const socket = new FakeV2Socket();
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => socket },
      intent: defaultIntent,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 60_000,
      onState: () => {
        throw new Error("application callback failed");
      },
    });
    await makeLive(socket, session);

    socket.emitError();

    expect(session.state).toBe("error");
    await expect(session.query({ kind: "capabilities.read" })).rejects.toThrow("not live");
    session.stop();
  });

  it("replaces the transport epoch on explicit reconnect without replacing the session", async () => {
    const sockets = [new FakeV2Socket(), new FakeV2Socket()];
    let socketIndex = 0;
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => sockets[socketIndex++]! },
      intent: defaultIntent,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 0,
    });
    await makeLive(sockets[0]!, session);

    session.reconnect();

    expect(sockets[0]!.closes.at(-1)).toEqual({ code: 1012, reason: "client_reconnect" });
    await waitFor(() => sockets[1]!.listenerCount("open") > 0);
    sockets[1]!.open();
    const next = snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" });
    sockets[1]!.emit(next);
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "snapshotCommitted"));
    sockets[1]!.emit({ type: "live", epochId: next.epochId, watermark: next.watermark });
    await waitFor(() => session.state === "live");
    expect((await session.projectionViews()).live?.epochId).toBe("epoch-2");
    session.stop();
  });

  it("changes the watched thread inside the live epoch without reconnecting", async () => {
    const store = new MemoryV2ProjectionStore();
    const { session, socket } = setup(store);
    await makeLive(socket, session, snapshot({ currentThread: null }));

    const watched = session.watchThread("thread-2", 36);
    await waitFor(() => socket.sent.some((frame) => frame.type === "threadWatch"));
    const request = socket.sent.find((frame) => frame.type === "threadWatch");
    socket.emit({
      type: "change",
      epochId: "epoch-1",
      watermark: "1",
      change: {
        kind: "currentThreadReplaced",
        currentThread: {
          thread: thread("thread-2"),
          turns: [],
          olderCursor: null,
          newerCursor: null,
        },
        pendingRequests: [],
      },
    });
    socket.emit({
      type: "threadWatched",
      requestId: request?.requestId,
      epochId: "epoch-1",
    });

    await expect(watched).resolves.toBeUndefined();
    expect(socket.closes).toEqual([]);
    expect((await store.active(savedServerA))?.currentThread?.thread.id).toBe("thread-2");
    session.stop();
  });

  it("partitions state by saved server and retains older metadata only within that partition", async () => {
    const store = new MemoryV2ProjectionStore();
    await store.commitSnapshot(savedServerA, snapshot({ active: [thread("older")] }));
    await store.commitSnapshot(
      savedServerA,
      snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2", active: [thread("newer")] }),
    );
    expect((await store.active(savedServerA))?.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          thread: expect.objectContaining({ id: "older" }),
          coverage: "outsideCurrentScope",
        }),
        expect.objectContaining({
          thread: expect.objectContaining({ id: "newer" }),
          coverage: "current",
        }),
      ]),
    );
    expect(await store.active(savedServerB)).toBeNull();
  });

  it("enforces declared catalog limits and keeps current-thread metadata coherent", async () => {
    const store = new MemoryV2ProjectionStore();
    const currentThread: V2ThreadWindow = {
      thread: thread("thread-1"),
      turns: [],
      olderCursor: null,
      newerCursor: null,
    };
    await store.commitSnapshot(
      savedServerA,
      snapshot({ active: [thread("thread-1"), thread("thread-2")], currentThread }),
    );
    await store.applyChange(savedServerA, "epoch-1", "1", {
      kind: "threadUpserted",
      thread: thread("thread-3", { title: "three" }),
    });
    await store.applyChange(savedServerA, "epoch-1", "2", {
      kind: "threadUpserted",
      thread: thread("thread-1", { title: "updated" }),
    });
    const projection = await store.active(savedServerA);
    expect(
      projection?.catalog.filter((entry) => entry.coverage === "current" && !entry.thread.archived),
    ).toHaveLength(2);
    expect(projection?.scope.active.returned).toBe(2);
    expect(projection?.currentThread?.thread.title).toBe("updated");

    await store.applyChange(savedServerA, "epoch-1", "3", {
      kind: "threadRemoved",
      threadId: "thread-1",
      reason: "deleted",
    });
    expect((await store.active(savedServerA))?.currentThread).toBeNull();
  });

  it("exposes every semantic invalidation to projection consumers", async () => {
    const store = new MemoryV2ProjectionStore();
    await store.commitSnapshot(savedServerA, snapshot());
    await store.applyChange(savedServerA, "epoch-1", "1", {
      kind: "resourcesChanged",
      threadId: "thread-1",
      revision: "resources:1",
    });
    await store.applyChange(savedServerA, "epoch-1", "2", {
      kind: "queueChanged",
      threadId: null,
      revision: "queue:1",
    });
    await store.applyChange(savedServerA, "epoch-1", "3", {
      kind: "accountsChanged",
      revision: "accounts:1",
    });
    const projection = await store.active(savedServerA);
    expect(projection?.resourceRevisions).toEqual({ "thread-1": "resources:1" });
    expect(projection?.queueRevisions).toEqual({ "*": "queue:1" });
    expect(projection?.accountsRevision).toBe("accounts:1");
    expect(projection?.invalidations.map(({ kind, watermark }) => [kind, watermark])).toEqual([
      ["resourcesChanged", "1"],
      ["queueChanged", "2"],
      ["accountsChanged", "3"],
    ]);
  });

  it("publishes snapshot plus included tail before acknowledging the exact tuple", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = new MemoryV2ProjectionStore();
    const store: V2ProjectionStore = {
      active: (context) => base.active(context),
      retained: (context) => base.retained(context),
      subscribe: (context, listener) => base.subscribe(context, listener),
      abandonEpoch: (context, epoch) => base.abandonEpoch(context, epoch),
      applyChange: (context, epoch, watermark, change) =>
        base.applyChange(context, epoch, watermark, change),
      deleteSavedServer: (savedServerId) => base.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => base.hasSavedServerData(savedServerId),
      commitSnapshot: async (context, value, signal) => {
        await blocked;
        return await base.commitSnapshot(context, value, signal);
      },
    };
    const { socket, session } = setup(store);
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);
    socket.open();
    expect(socket.sent[0]).toEqual({ type: "open", version: 2, intent: expect.any(Object) });
    expect(socket.sent[0]).not.toHaveProperty("cursor");
    socket.emit(
      snapshot({
        includedTail: [
          { watermark: "1", change: { kind: "threadUpserted", thread: thread("tail") } },
        ],
        watermark: "1",
      }),
    );
    await Promise.resolve();
    expect(socket.sent).toHaveLength(1);
    release();
    await waitFor(() => socket.sent.length === 2);
    expect(socket.sent[1]).toEqual({
      type: "snapshotCommitted",
      epochId: "epoch-1",
      revision: "sync-v2-revision:1",
      watermark: "1",
    });
    expect((await store.active(savedServerA))?.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ thread: expect.objectContaining({ id: "tail" }) }),
      ]),
    );
    session.stop();
  });

  it("accepts authoritative reinitialize before a snapshot epoch is known", async () => {
    const { socket, session } = setup();
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);
    socket.open();
    socket.emit({ type: "reinitialize", epochId: "server-epoch", reason: "snapshotFailed" });
    await waitFor(() => socket.sent.filter((frame) => frame.type === "open").length === 2);
    expect(socket.closes).toHaveLength(0);
    session.stop();
  });

  it("cancels snapshot publication when reinitialize races a blocked commit", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = new MemoryV2ProjectionStore();
    const store: V2ProjectionStore = {
      active: (context) => base.active(context),
      retained: (context) => base.retained(context),
      subscribe: (context, listener) => base.subscribe(context, listener),
      abandonEpoch: (context, epoch) => base.abandonEpoch(context, epoch),
      applyChange: (context, epoch, watermark, change) =>
        base.applyChange(context, epoch, watermark, change),
      deleteSavedServer: (savedServerId) => base.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => base.hasSavedServerData(savedServerId),
      commitSnapshot: async (context, value, signal) => {
        await blocked;
        return await base.commitSnapshot(context, value, signal);
      },
    };
    const { socket, session } = setup(store);
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);
    socket.open();
    socket.emit(snapshot());
    socket.emit({ type: "reinitialize", epochId: "epoch-1", reason: "upstreamGenerationChanged" });
    release();
    await waitFor(() => socket.sent.filter((frame) => frame.type === "open").length === 2);
    expect(socket.sent.some((frame) => frame.type === "snapshotCommitted")).toBe(false);
    expect(await store.active(savedServerA)).toBeNull();
    session.stop();
  });

  it("recovers the apply chain after durable abandonment fails during reinitialize", async () => {
    const base = new MemoryV2ProjectionStore();
    let abandonAttempts = 0;
    const store: V2ProjectionStore = {
      active: (savedServerId) => base.active(savedServerId),
      retained: (savedServerId) => base.retained(savedServerId),
      subscribe: (savedServerId, listener) => base.subscribe(savedServerId, listener),
      commitSnapshot: (savedServerId, value, signal) =>
        base.commitSnapshot(savedServerId, value, signal),
      applyChange: (savedServerId, epochId, watermark, change) =>
        base.applyChange(savedServerId, epochId, watermark, change),
      deleteSavedServer: (savedServerId) => base.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => base.hasSavedServerData(savedServerId),
      abandonEpoch: async (savedServerId, epochId) => {
        abandonAttempts += 1;
        if (abandonAttempts === 1) throw new Error("injected abandonment failure");
        await base.abandonEpoch(savedServerId, epochId);
      },
    };
    const sockets = [new FakeV2Socket(), new FakeV2Socket()];
    const diagnostics: string[] = [];
    let socketIndex = 0;
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => sockets[socketIndex++]! },
      intent: defaultIntent,
      projectionStore: store,
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 0,
      onState: (_state, diagnostic) => {
        if (diagnostic !== null) diagnostics.push(diagnostic.detail);
      },
    });
    session.start();
    await waitFor(() => sockets[0]!.listenerCount("open") > 0);
    sockets[0]!.open();
    sockets[0]!.emit(snapshot());
    await waitFor(() => sockets[0]!.sent.some((frame) => frame.type === "snapshotCommitted"));
    sockets[0]!.emit({ type: "reinitialize", epochId: "epoch-1", reason: "sourceGap" });
    await waitFor(() => sockets[0]!.closes.at(-1)?.reason === "durable_abandon_failed");
    expect(diagnostics).toContain("durable_abandon_failed");

    await waitFor(() => sockets[1]!.listenerCount("open") > 0);
    sockets[1]!.open();
    sockets[1]!.emit(snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" }));
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "snapshotCommitted"));
    expect((await base.active(savedServerA))?.epochId).toBe("epoch-2");
    session.stop();
  });
});
