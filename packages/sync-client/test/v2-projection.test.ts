import { describe, expect, it } from "vitest";

import {
  MemoryV2ProjectionStore,
  MemoryV2OperationStore,
  SyncV2Session,
  type V2ProjectionStore,
  type V2ThreadWindow,
} from "../src/index.js";
import { DEVICE_A, FakeV2Socket, PIN, defaultIntent, savedServerA, savedServerB, setup, snapshot, thread, waitFor } from "./v2-fixtures.js";

describe("Sync V2 projection generations", () => {
  it("partitions state by saved server and retains older metadata only within that partition", async () => {
    const store = new MemoryV2ProjectionStore();
    await store.commitSnapshot(savedServerA, snapshot({ active: [thread("older")] }));
    await store.commitSnapshot(savedServerA, snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2", active: [thread("newer")] }));
    expect((await store.active(savedServerA))?.catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ thread: expect.objectContaining({ id: "older" }), coverage: "outsideCurrentScope" }),
      expect.objectContaining({ thread: expect.objectContaining({ id: "newer" }), coverage: "current" }),
    ]));
    expect(await store.active(savedServerB)).toBeNull();
  });

  it("enforces declared catalog limits and keeps current-thread metadata coherent", async () => {
    const store = new MemoryV2ProjectionStore();
    const currentThread: V2ThreadWindow = { thread: thread("thread-1"), turns: [], olderCursor: null, newerCursor: null };
    await store.commitSnapshot(savedServerA, snapshot({ active: [thread("thread-1"), thread("thread-2")], currentThread }));
    await store.applyChange(savedServerA, "epoch-1", "1", { kind: "threadUpserted", thread: thread("thread-3", { title: "three" }) });
    await store.applyChange(savedServerA, "epoch-1", "2", { kind: "threadUpserted", thread: thread("thread-1", { title: "updated" }) });
    const projection = await store.active(savedServerA);
    expect(projection?.catalog.filter((entry) => entry.coverage === "current" && !entry.thread.archived)).toHaveLength(2);
    expect(projection?.scope.active.returned).toBe(2);
    expect(projection?.currentThread?.thread.title).toBe("updated");

    await store.applyChange(savedServerA, "epoch-1", "3", { kind: "threadRemoved", threadId: "thread-1", reason: "deleted" });
    expect((await store.active(savedServerA))?.currentThread).toBeNull();
  });

  it("exposes every semantic invalidation to projection consumers", async () => {
    const store = new MemoryV2ProjectionStore();
    await store.commitSnapshot(savedServerA, snapshot());
    await store.applyChange(savedServerA, "epoch-1", "1", { kind: "resourcesChanged", threadId: "thread-1", revision: "resources:1" });
    await store.applyChange(savedServerA, "epoch-1", "2", { kind: "queueChanged", threadId: null, revision: "queue:1" });
    await store.applyChange(savedServerA, "epoch-1", "3", { kind: "accountsChanged", revision: "accounts:1" });
    const projection = await store.active(savedServerA);
    expect(projection?.resourceRevisions).toEqual({ "thread-1": "resources:1" });
    expect(projection?.queueRevisions).toEqual({ "*": "queue:1" });
    expect(projection?.accountsRevision).toBe("accounts:1");
    expect(projection?.invalidations.map(({ kind, watermark }) => [kind, watermark])).toEqual([
      ["resourcesChanged", "1"], ["queueChanged", "2"], ["accountsChanged", "3"],
    ]);
  });

  it("publishes snapshot plus included tail before acknowledging the exact tuple", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const base = new MemoryV2ProjectionStore();
    const store: V2ProjectionStore = {
      active: (context) => base.active(context),
      abandonEpoch: (context, epoch) => base.abandonEpoch(context, epoch),
      applyChange: (context, epoch, watermark, change) => base.applyChange(context, epoch, watermark, change),
      deleteSavedServer: (savedServerId) => base.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => base.hasSavedServerData(savedServerId),
      commitSnapshot: async (context, value, signal) => { await blocked; return await base.commitSnapshot(context, value, signal); },
    };
    const { socket, session } = setup(store);
    session.start();
    await waitFor(() => socket.listenerCount("open") > 0);
    socket.open();
    expect(socket.sent[0]).toEqual({ type: "open", version: 2, intent: expect.any(Object) });
    expect(socket.sent[0]).not.toHaveProperty("cursor");
    socket.emit(snapshot({ includedTail: [{ watermark: "1", change: { kind: "threadUpserted", thread: thread("tail") } }], watermark: "1" }));
    await Promise.resolve();
    expect(socket.sent).toHaveLength(1);
    release();
    await waitFor(() => socket.sent.length === 2);
    expect(socket.sent[1]).toEqual({ type: "snapshotCommitted", epochId: "epoch-1", revision: "sync-v2-revision:1", watermark: "1" });
    expect((await store.active(savedServerA))?.catalog).toEqual(expect.arrayContaining([expect.objectContaining({ thread: expect.objectContaining({ id: "tail" }) })]));
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
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const base = new MemoryV2ProjectionStore();
    const store: V2ProjectionStore = {
      active: (context) => base.active(context),
      abandonEpoch: (context, epoch) => base.abandonEpoch(context, epoch),
      applyChange: (context, epoch, watermark, change) => base.applyChange(context, epoch, watermark, change),
      deleteSavedServer: (savedServerId) => base.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => base.hasSavedServerData(savedServerId),
      commitSnapshot: async (context, value, signal) => { await blocked; return await base.commitSnapshot(context, value, signal); },
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
      commitSnapshot: (savedServerId, value, signal) => base.commitSnapshot(savedServerId, value, signal),
      applyChange: (savedServerId, epochId, watermark, change) => base.applyChange(savedServerId, epochId, watermark, change),
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
      connection: { savedServerId: savedServerA, endpoint: "wss://example.test/v2/sync", tlsPinSha256: PIN, deviceId: DEVICE_A },
      intent: defaultIntent,
      projectionStore: store,
      operationStore: new MemoryV2OperationStore(),
      socketFactory: () => sockets[socketIndex++]!,
      reconnectDelayMs: 0,
      onState: (_state, diagnostic) => { if (diagnostic !== null) diagnostics.push(diagnostic.detail); },
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
