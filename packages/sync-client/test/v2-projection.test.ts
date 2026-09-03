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

  it("escapes a synchronous transport-open failure through the normal reconnect path", async () => {
    const socket = new FakeV2Socket();
    let attempts = 0;
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: {
        openSync: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("transport unavailable");
          return socket;
        },
      },
      intent: defaultIntent,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 0,
    });

    session.start();

    await waitFor(() => socket.listenerCount("open") > 0);
    expect(attempts).toBe(2);
    session.stop();
  });

  it("reconnects when the protocol Open frame cannot be sent", async () => {
    const first = new FakeV2Socket();
    first.send = () => {
      throw new Error("send failed");
    };
    const second = new FakeV2Socket();
    let attempt = 0;
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => (attempt++ === 0 ? first : second) },
      intent: defaultIntent,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 0,
    });
    session.start();
    await waitFor(() => first.listenerCount("open") > 0);
    first.open();

    expect(first.closes.at(-1)).toEqual({ code: 1011, reason: "open_send_failed" });
    await waitFor(() => second.listenerCount("open") > 0);
    session.stop();
  });

  it.each([
    ["snapshot", "snapshot_timeout"],
    ["commit", "snapshot_commit_timeout"],
    ["live", "live_timeout"],
  ] as const)(
    "reconnects a pong-responsive connection stalled before %s progress",
    async (stage, expectedReason) => {
      const projections = new MemoryV2ProjectionStore();
      let releaseCommit: () => void = () => undefined;
      const commitBarrier = new Promise<void>((resolve) => {
        if (stage === "commit") releaseCommit = resolve;
        else resolve();
      });
      const store: V2ProjectionStore = {
        abandonEpoch: (savedServerId, epochId) => projections.abandonEpoch(savedServerId, epochId),
        active: (savedServerId) => projections.active(savedServerId),
        applyChange: (savedServerId, epochId, watermark, change) =>
          projections.applyChange(savedServerId, epochId, watermark, change),
        commitSnapshot: async (savedServerId, value, signal) => {
          await commitBarrier;
          return projections.commitSnapshot(savedServerId, value, signal);
        },
        deleteSavedServer: (savedServerId) => projections.deleteSavedServer(savedServerId),
        hasSavedServerData: (savedServerId) => projections.hasSavedServerData(savedServerId),
        retained: (savedServerId) => projections.retained(savedServerId),
        subscribe: (savedServerId, listener) => projections.subscribe(savedServerId, listener),
      };
      const socket = new FakeV2Socket();
      const session = new SyncV2Session({
        savedServerId: savedServerA,
        transportLease: { openSync: () => socket },
        intent: { ...defaultIntent, currentThread: null },
        projectionStore: store,
        operationStore: new MemoryV2OperationStore(),
        reconnectDelayMs: 0,
        heartbeatIntervalMs: 2,
        heartbeatTimeoutMs: 100,
        initializationTimeoutMs: 20,
      });
      session.start();
      await waitFor(() => socket.listenerCount("open") > 0);
      socket.open();
      if (stage !== "snapshot") socket.emit(snapshot({ currentThread: null }));
      if (stage === "live") {
        await waitFor(() => socket.sent.some((frame) => frame.type === "snapshotCommitted"));
      }
      let answeredPings = 0;
      const pongResponder = setInterval(() => {
        const pings = socket.sent.filter((frame) => frame.type === "ping");
        const ping = pings[answeredPings];
        if (ping === undefined) return;
        answeredPings += 1;
        socket.emit({ type: "pong", nonce: ping.nonce });
      }, 1);

      await waitFor(() => socket.closes.at(-1)?.reason === expectedReason);
      clearInterval(pongResponder);
      releaseCommit();
      await waitFor(() => socket.listenerCount("open") > 1);
      expect(answeredPings).toBeGreaterThan(0);
      session.stop();
    },
  );

  it.each([
    [defaultIntent, snapshot({ currentThread: null })],
    [
      { ...defaultIntent, currentThread: null },
      snapshot({
        currentThread: {
          newerCursor: null,
          olderCursor: null,
          thread: thread("thread-1"),
          turns: [],
        },
      }),
    ],
  ] as const)(
    "rejects a snapshot outside the requested thread authority",
    async (intent, value) => {
      const socket = new FakeV2Socket();
      const session = new SyncV2Session({
        savedServerId: savedServerA,
        transportLease: { openSync: () => socket },
        intent,
        projectionStore: new MemoryV2ProjectionStore(),
        operationStore: new MemoryV2OperationStore(),
        reconnectDelayMs: 60_000,
        heartbeatIntervalMs: 60_000,
      });
      session.start();
      await waitFor(() => socket.listenerCount("open") > 0);
      socket.open();
      socket.emit(value);

      expect(socket.closes.at(-1)).toEqual({ code: 1008, reason: "snapshot_thread_mismatch" });
      session.stop();
    },
  );

  it("changes the watched thread inside the live epoch without reconnecting", async () => {
    const store = new MemoryV2ProjectionStore();
    const { session, socket } = setup(store);
    session.updateIntent({ ...defaultIntent, currentThread: null });
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

  it("rejects a thread-watch acknowledgement that did not publish the requested thread", async () => {
    const store = new MemoryV2ProjectionStore();
    const { session, socket } = setup(store);
    await makeLive(socket, session);

    const watched = session.watchThread("thread-2", 36);
    await waitFor(() => socket.sent.some((frame) => frame.type === "threadWatch"));
    const request = socket.sent.find((frame) => frame.type === "threadWatch");
    socket.emit({
      type: "threadWatched",
      requestId: request?.requestId,
      epochId: "epoch-1",
    });

    await expect(watched).rejects.toThrow("did not publish its requested thread");
    expect(socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: "thread_watch_projection_mismatch",
    });
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

  it("rebuilds reconnect catalog order from the authoritative snapshot before retained rows", async () => {
    const store = new MemoryV2ProjectionStore();
    const equalTimestamp = "2026-08-27T12:00:00Z";
    const first = thread("first", {
      lastActivityAt: equalTimestamp,
      updatedAt: equalTimestamp,
    });
    const second = thread("second", {
      lastActivityAt: equalTimestamp,
      updatedAt: equalTimestamp,
    });
    const retained = thread("retained", { archived: true });
    await store.commitSnapshot(
      savedServerA,
      snapshot({ active: [first, second], archived: [retained] }),
    );

    await store.commitSnapshot(
      savedServerA,
      snapshot({
        active: [second, first],
        archived: [],
        epochId: "epoch-2",
        revision: "sync-v2-revision:2",
      }),
    );

    expect(
      (await store.active(savedServerA))?.catalog.map((entry) => [entry.thread.id, entry.coverage]),
    ).toEqual([
      ["second", "current"],
      ["first", "current"],
      ["retained", "outsideCurrentScope"],
    ]);
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

  it("moves an updated tail thread to the front of its catalog partition", async () => {
    const store = new MemoryV2ProjectionStore();
    await store.commitSnapshot(
      savedServerA,
      snapshot({ active: [thread("front"), thread("tail")] }),
    );

    await store.applyChange(savedServerA, "epoch-1", "1", {
      kind: "threadUpserted",
      thread: thread("tail", {
        lastActivityAt: "2026-08-27T12:01:00Z",
        updatedAt: "2026-08-27T12:01:00Z",
      }),
    });

    const currentActive = (await store.active(savedServerA))?.catalog.filter(
      (entry) => entry.coverage === "current" && !entry.thread.archived,
    );
    expect(currentActive?.map((entry) => entry.thread.id)).toEqual(["tail", "front"]);
    expect(currentActive?.at(-1)?.thread.id).toBe("front");
  });

  it("idempotently advances live item lifecycle and preserves it across turn refreshes", async () => {
    const store = new MemoryV2ProjectionStore();
    const baseTurn = {
      id: "turn-1",
      threadId: "thread-1",
      state: "running" as const,
      createdAt: "2026-08-27T12:00:00Z",
      completedAt: null,
      durationMs: null,
      activity: null,
      usage: null,
      items: [],
      lifecycle: [],
    };
    await store.commitSnapshot(
      savedServerA,
      snapshot({
        currentThread: {
          thread: thread("thread-1"),
          turns: [baseTurn],
          olderCursor: null,
          newerCursor: null,
        },
      }),
    );
    const started = {
      item: { kind: "contextCompaction" as const, id: "compaction-1" },
      phase: "started" as const,
      preTurn: true,
    };
    await store.applyChange(savedServerA, "epoch-1", "1", {
      kind: "itemLifecycleChanged",
      threadId: "thread-1",
      turnId: "turn-1",
      lifecycle: started,
    });
    await store.applyChange(savedServerA, "epoch-1", "2", {
      kind: "itemLifecycleChanged",
      threadId: "thread-1",
      turnId: "turn-1",
      lifecycle: { ...started, phase: "completed" },
    });
    await store.applyChange(savedServerA, "epoch-1", "3", {
      kind: "turnUpserted",
      turn: { ...baseTurn, items: [{ kind: "contextCompaction", id: "compaction-1" }] },
    });

    expect((await store.active(savedServerA))?.currentThread?.turns[0]?.lifecycle).toEqual([
      { ...started, phase: "completed" },
    ]);
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
    await store.applyChange(savedServerA, "epoch-1", "4", {
      kind: "threadGoalChanged",
      threadId: "thread-1",
      revision: "goal:1",
    });
    await store.applyChange(savedServerA, "epoch-1", "5", {
      kind: "skillsChanged",
      workspace: null,
      revision: "skills:1",
    });
    const projection = await store.active(savedServerA);
    expect(projection?.resourceRevisions).toEqual({ "thread-1": "resources:1" });
    expect(projection?.queueRevisions).toEqual({ "*": "queue:1" });
    expect(projection?.accountsRevision).toBe("accounts:1");
    expect(projection?.invalidations.map(({ kind, watermark }) => [kind, watermark])).toEqual([
      ["resourcesChanged", "1"],
      ["queueChanged", "2"],
      ["accountsChanged", "3"],
      ["threadGoalChanged", "4"],
      ["skillsChanged", "5"],
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

  it("closes an authority that never answers a query", async () => {
    const socket = new FakeV2Socket();
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => socket },
      intent: defaultIntent,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 60_000,
      requestTimeoutMs: 5,
      heartbeatIntervalMs: 60_000,
    });
    await makeLive(socket, session);

    const request = session.query({ kind: "models.list" });

    await expect(request).rejects.toThrow("timed out");
    expect(socket.closes.at(-1)).toEqual({ code: 1011, reason: "query_timeout" });
    session.stop();
  });

  it("times out a thread watch while the connection never reaches Live", async () => {
    const socket = new FakeV2Socket();
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => socket },
      intent: { ...defaultIntent, currentThread: null },
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 60_000,
      requestTimeoutMs: 5,
      heartbeatIntervalMs: 60_000,
    });
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);

    await expect(session.watchThread("thread-2", 36)).rejects.toThrow("timed out");
    expect(socket.closes.at(-1)).toEqual({ code: 1011, reason: "thread_watch_timeout" });
    session.stop();
  });

  it("keeps the thread-watch deadline armed until preceding projection work settles", async () => {
    let releaseApply!: () => void;
    const blockedApply = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const projections = new MemoryV2ProjectionStore();
    const store: V2ProjectionStore = {
      abandonEpoch: (savedServerId, epochId) => projections.abandonEpoch(savedServerId, epochId),
      active: (savedServerId) => projections.active(savedServerId),
      applyChange: async (savedServerId, epochId, watermark, change) => {
        await blockedApply;
        await projections.applyChange(savedServerId, epochId, watermark, change);
      },
      commitSnapshot: (savedServerId, value, signal) =>
        projections.commitSnapshot(savedServerId, value, signal),
      deleteSavedServer: (savedServerId) => projections.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => projections.hasSavedServerData(savedServerId),
      retained: (savedServerId) => projections.retained(savedServerId),
      subscribe: (savedServerId, listener) => projections.subscribe(savedServerId, listener),
    };
    const socket = new FakeV2Socket();
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => socket },
      intent: defaultIntent,
      projectionStore: store,
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 60_000,
      requestTimeoutMs: 5,
      heartbeatIntervalMs: 60_000,
    });
    await makeLive(socket, session);
    const watched = session.watchThread("thread-2", 36);
    await waitFor(() => socket.sent.some((frame) => frame.type === "threadWatch"));
    const request = socket.sent.find((frame) => frame.type === "threadWatch");
    socket.emit({
      type: "change",
      epochId: "epoch-1",
      watermark: "1",
      change: { kind: "threadUpserted", thread: thread("thread-2") },
    });
    socket.emit({ type: "threadWatched", requestId: request?.requestId, epochId: "epoch-1" });

    await expect(watched).rejects.toThrow("timed out");
    expect(socket.closes.at(-1)?.reason).toBe("thread_watch_timeout");
    releaseApply();
    session.stop();
  });

  it("requires a matching pong before the heartbeat deadline", async () => {
    const socket = new FakeV2Socket();
    const diagnostics: string[] = [];
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => socket },
      intent: defaultIntent,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      reconnectDelayMs: 60_000,
      requestTimeoutMs: 60_000,
      heartbeatIntervalMs: 5,
      heartbeatTimeoutMs: 5,
      onState: (_state, diagnostic) => {
        if (diagnostic !== null) diagnostics.push(diagnostic.detail);
      },
    });
    await makeLive(socket, session);

    await waitFor(() => socket.closes.at(-1)?.reason === "heartbeat_timeout");
    expect(diagnostics).toContain("heartbeat_timeout");
    session.stop();
  });
});
