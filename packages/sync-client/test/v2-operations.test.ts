import { describe, expect, it } from "vitest";

import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  SyncV2Session,
  SyncV2CommandDurableUnsettledError,
  SyncV2CommandNotCreatedError,
  V2_OPERATION_RECEIPT_MAX_AGE_MS,
  type V2Command,
  type V2ProjectionStore,
} from "../src/v2/index.js";
import {
  FakeV2Socket,
  makeLive,
  savedServerA,
  savedServerB,
  setup,
  snapshot,
  waitFor,
} from "./v2-fixtures.js";
import { makeNextEpochLive, PausableOperationStore } from "./v2-operation-test-support.js";

describe("Sync V2 durable operations", () => {
  it("reports notCreated when activation starts outside a live authority", async () => {
    const operations = new MemoryV2OperationStore();
    const { session } = setup(undefined, operations);

    await expect(
      session.command("not-created", { kind: "thread.delete", threadId: "thread-1" }),
    ).rejects.toBeInstanceOf(SyncV2CommandNotCreatedError);
    expect(await operations.get(savedServerA, "not-created")).toBeNull();
  });

  it("keeps one promise and operation id when reinitialize lands after create commit", async () => {
    const operations = new PausableOperationStore("create");
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("post-create-gap", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await operations.entered;
    socket.emit({ type: "reinitialize", epochId: "epoch-1", reason: "sourceGap" });
    await waitFor(() => session.state === "reinitializing");
    operations.release();
    await waitFor(async () => (await operations.get(savedServerA, "post-create-gap")) !== null);
    expect(socket.sent.filter((frame) => frame.type === "command")).toHaveLength(0);

    await makeNextEpochLive(socket, session);
    await waitFor(() => socket.sent.filter((frame) => frame.type === "command").length === 1);
    const sent = socket.sent.find((frame) => frame.type === "command");
    socket.emit({
      type: "commandAccepted",
      requestId: sent?.requestId,
      operationId: "post-create-gap",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    socket.emit({
      type: "commandCompleted",
      operationId: "post-create-gap",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    await expect(terminal).resolves.toMatchObject({
      operationId: "post-create-gap",
      type: "commandCompleted",
    });
    session.stop();
  });

  it("does not stale-send when reinitialize lands after the sent transition", async () => {
    const operations = new PausableOperationStore("transition");
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("post-transition-gap", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await operations.entered;
    socket.emit({ type: "reinitialize", epochId: "epoch-1", reason: "sourceGap" });
    await waitFor(() => session.state === "reinitializing");
    operations.release();
    await waitFor(
      async () => (await operations.get(savedServerA, "post-transition-gap"))?.state === "sent",
    );
    expect(socket.sent.filter((frame) => frame.type === "command")).toHaveLength(0);

    await makeNextEpochLive(socket, session);
    await waitFor(() => socket.sent.filter((frame) => frame.type === "command").length === 1);
    const sent = socket.sent.find((frame) => frame.type === "command");
    socket.emit({
      type: "commandAccepted",
      requestId: sent?.requestId,
      operationId: "post-transition-gap",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    socket.emit({
      type: "commandCompleted",
      operationId: "post-transition-gap",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    await expect(terminal).resolves.toMatchObject({ operationId: "post-transition-gap" });
    session.stop();
  });

  it("rejects an explicitly disposed durable waiter as durableUnsettled", async () => {
    const operations = new PausableOperationStore("transition");
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("disposed-durable", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await operations.entered;
    session.stop();
    operations.release();
    await expect(terminal).rejects.toBeInstanceOf(SyncV2CommandDurableUnsettledError);
    expect(await operations.get(savedServerA, "disposed-durable")).not.toBeNull();
  });

  it("drains reinitialize cleanup queued behind a terminal command before disposal resolves", async () => {
    const base = new MemoryV2ProjectionStore();
    let releaseAbandon!: () => void;
    let markAbandonEntered!: () => void;
    const abandonEntered = new Promise<void>((resolve) => {
      markAbandonEntered = resolve;
    });
    const abandonBlocked = new Promise<void>((resolve) => {
      releaseAbandon = resolve;
    });
    const projections: V2ProjectionStore = {
      abandonEpoch: async (savedServerId, epochId) => {
        markAbandonEntered();
        await abandonBlocked;
        await base.abandonEpoch(savedServerId, epochId);
      },
      active: (savedServerId) => base.active(savedServerId),
      applyChange: (savedServerId, epochId, watermark, change) =>
        base.applyChange(savedServerId, epochId, watermark, change),
      commitSnapshot: (savedServerId, value, signal) =>
        base.commitSnapshot(savedServerId, value, signal),
      deleteSavedServer: (savedServerId) => base.deleteSavedServer(savedServerId),
      hasSavedServerData: (savedServerId) => base.hasSavedServerData(savedServerId),
      retained: (savedServerId) => base.retained(savedServerId),
      subscribe: (savedServerId, listener) => base.subscribe(savedServerId, listener),
    };
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(projections, operations);
    await makeLive(socket, session);
    const terminal = session.command("dispose-after-terminal", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({
      type: "commandAccepted",
      requestId,
      operationId: "dispose-after-terminal",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    socket.emit({
      type: "commandCompleted",
      operationId: "dispose-after-terminal",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    socket.emit({ type: "reinitialize", epochId: "epoch-1", reason: "sourceGap" });
    await terminal;

    let disposed = false;
    const disposal = session.dispose().then(() => {
      disposed = true;
    });
    await abandonEntered;
    await Promise.resolve();
    expect(disposed).toBe(false);
    releaseAbandon();
    await disposal;
    expect(session.state).toBe("offline");
  });

  it("publishes an observable complete operation status list", async () => {
    const store = new MemoryV2OperationStore();
    let publications = 0;
    const unsubscribe = store.subscribe(savedServerA, () => {
      publications += 1;
    });
    await store.create(savedServerA, "operation-a", {
      kind: "thread.delete",
      threadId: "thread-a",
    });
    await store.create(savedServerA, "operation-b", {
      kind: "thread.delete",
      threadId: "thread-b",
    });
    expect((await store.list(savedServerA)).map(({ operationId }) => operationId).sort()).toEqual([
      "operation-a",
      "operation-b",
    ]);
    expect((await store.list(savedServerA))[0]).not.toHaveProperty("command");
    expect((await store.list(savedServerA))[0]).not.toHaveProperty("commandFingerprint");
    expect(publications).toBe(2);
    unsubscribe();
  });

  it("isolates throwing observers from committed operation mutations", async () => {
    const store = new MemoryV2OperationStore();
    let peerPublications = 0;
    store.subscribe(savedServerA, () => {
      throw new Error("observer failed");
    });
    store.subscribe(savedServerA, () => {
      peerPublications += 1;
    });

    await expect(
      store.create(savedServerA, "operation", { kind: "thread.delete", threadId: "thread" }),
    ).resolves.toBeDefined();
    expect(peerPublications).toBe(1);
    expect(await store.get(savedServerA, "operation")).not.toBeNull();
  });

  it("uses canonical command identity instead of property insertion order", async () => {
    const store = new MemoryV2OperationStore();
    const left = { kind: "turn.interrupt", threadId: "thread", turnId: "turn" } as const;
    const right = { turnId: "turn", kind: "turn.interrupt", threadId: "thread" } as const;
    const created = await store.create(savedServerA, "operation", left, 0);
    const replay = await store.create(savedServerA, "operation", right, 0);
    expect(replay.commandFingerprint).toBe(created.commandFingerprint);
    await expect(
      store.create(savedServerA, "operation", { ...left, turnId: "other" }, 0),
    ).rejects.toThrow("different canonical command");
  });

  it("serializes immediate accepted-to-terminal delivery", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("operation-1", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({
      type: "commandAccepted",
      requestId,
      operationId: "operation-1",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    socket.emit({
      type: "commandCompleted",
      operationId: "operation-1",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    await expect(terminal).resolves.toEqual(expect.objectContaining({ type: "commandCompleted" }));
    expect((await operations.get(savedServerA, "operation-1"))?.state).toBe("completed");
    session.stop();
  });

  it("settles an earlier terminal command before authoritative reinitialize", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("operation-before-reinitialize", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({
      type: "commandAccepted",
      requestId,
      operationId: "operation-before-reinitialize",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    socket.emit({
      type: "commandCompleted",
      operationId: "operation-before-reinitialize",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    socket.emit({ type: "reinitialize", epochId: "epoch-1", reason: "sourceGap" });

    await expect(terminal).resolves.toMatchObject({ type: "commandCompleted" });
    await waitFor(() => socket.sent.filter((frame) => frame.type === "open").length === 2);
    expect((await operations.get(savedServerA, "operation-before-reinitialize"))?.state).toBe(
      "completed",
    );
    session.stop();
  });

  it.each([
    [
      "commandRejected",
      false,
      "rejected",
      { code: "invalidRequest", recovery: "none", message: "invalid" },
    ],
    [
      "commandExpired",
      false,
      "expired",
      { code: "operationExpired", recovery: "userAction", message: "expired" },
    ],
    [
      "commandFailed",
      true,
      "failed",
      { code: "sourceUnavailable", recovery: "retry", message: "failed" },
    ],
    [
      "commandIndeterminate",
      true,
      "indeterminate",
      { code: "operationIndeterminate", recovery: "requery", message: "unknown" },
    ],
  ] as const)(
    "persists %s as an exhaustive terminal state",
    async (type, accepted, state, error) => {
      const operations = new MemoryV2OperationStore();
      const { socket, session } = setup(undefined, operations);
      await makeLive(socket, session);
      const terminal = session.command(`operation-${state}`, {
        kind: "thread.delete",
        threadId: "thread-1",
      });
      await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
      const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
      if (accepted)
        socket.emit({
          type: "commandAccepted",
          requestId,
          operationId: `operation-${state}`,
          acceptedAt: "2026-08-27T12:00:00Z",
        });
      socket.emit({
        type,
        ...(accepted ? {} : { requestId }),
        operationId: `operation-${state}`,
        error,
      });
      await expect(terminal).resolves.toEqual(expect.objectContaining({ type }));
      const persisted = await operations.get(savedServerA, `operation-${state}`);
      expect(persisted?.state).toBe(state);
      expect(persisted?.command).toBeNull();
      expect(persisted).not.toHaveProperty("error");
      expect(persisted).not.toHaveProperty("result");
      session.stop();
    },
  );

  it("recovers only unconfirmed sent operations after response loss and restart", async () => {
    const operations = new MemoryV2OperationStore();
    const first = setup(undefined, operations);
    await makeLive(first.socket, first.session);
    void first.session
      .command("lost-response", { kind: "thread.delete", threadId: "thread-1" })
      .catch(() => undefined);
    await waitFor(() => first.socket.sent.some((frame) => frame.type === "command"));
    first.socket.close(1006, "lost");
    expect((await operations.get(savedServerA, "lost-response"))?.state).toBe("sent");

    const second = setup(undefined, operations);
    await makeLive(
      second.socket,
      second.session,
      snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" }),
    );
    await waitFor(() => second.socket.sent.some((frame) => frame.type === "command"));
    const requestId = second.socket.sent.find((frame) => frame.type === "command")?.requestId;
    second.socket.emit({
      type: "commandAccepted",
      requestId,
      operationId: "lost-response",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    second.socket.emit({
      type: "commandCompleted",
      operationId: "lost-response",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    await waitFor(
      async () => (await operations.get(savedServerA, "lost-response"))?.state === "completed",
    );
    second.session.stop();
  });

  it("never resends an acceptance recorded before disconnect", async () => {
    const operations = new MemoryV2OperationStore();
    const first = setup(undefined, operations);
    await makeLive(first.socket, first.session);
    void first.session
      .command("accepted", { kind: "thread.delete", threadId: "thread-1" })
      .catch(() => undefined);
    await waitFor(() => first.socket.sent.some((frame) => frame.type === "command"));
    const requestId = first.socket.sent.find((frame) => frame.type === "command")?.requestId;
    first.socket.emit({
      type: "commandAccepted",
      requestId,
      operationId: "accepted",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    await waitFor(
      async () => (await operations.get(savedServerA, "accepted"))?.state === "accepted",
    );
    first.socket.close(1006, "lost");

    const second = setup(undefined, operations);
    await makeLive(
      second.socket,
      second.session,
      snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" }),
    );
    await Promise.resolve();
    expect(second.socket.sent.some((frame) => frame.type === "command")).toBe(false);
    second.session.stop();
  });

  it("reconciles an accepted operation by receipt after SourceGap without resending it", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("accepted-gap", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const sent = socket.sent.find((frame) => frame.type === "command");
    socket.emit({
      type: "commandAccepted",
      requestId: sent?.requestId,
      operationId: "accepted-gap",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    await waitFor(
      async () => (await operations.get(savedServerA, "accepted-gap"))?.state === "accepted",
    );
    socket.emit({ type: "reinitialize", epochId: "epoch-1", reason: "sourceGap" });
    await waitFor(() => session.state === "reinitializing");
    await makeNextEpochLive(socket, session);
    await waitFor(() =>
      socket.sent.some((frame) => {
        if (frame.type !== "query") return false;
        const query = frame.query as Record<string, unknown> | undefined;
        return query?.kind === "operation.get";
      }),
    );
    const query = socket.sent.find((frame) => {
      if (frame.type !== "query") return false;
      const value = frame.query as Record<string, unknown> | undefined;
      return value?.kind === "operation.get";
    });
    socket.emit({
      type: "queryCompleted",
      requestId: query?.requestId,
      result: {
        kind: "operation.get",
        operationId: "accepted-gap",
        receipt: {
          state: "completed",
          acceptedAt: "2026-08-27T12:00:00Z",
          result: { kind: "thread.delete", threadId: "thread-1" },
        },
      },
    });
    await expect(terminal).resolves.toMatchObject({
      operationId: "accepted-gap",
      type: "commandCompleted",
    });
    expect(socket.sent.filter((frame) => frame.type === "command")).toHaveLength(1);
    session.stop();
  });

  it("keeps the same durable command promise across an explicit reconnect", async () => {
    const operations = new MemoryV2OperationStore();
    const sockets = [new FakeV2Socket(), new FakeV2Socket()];
    let socketIndex = 0;
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => sockets[socketIndex++]! },
      intent: {
        catalog: { activeLimit: 2, archivedLimit: 1 },
        currentThread: { threadId: "thread-1", turnLimit: 36 },
      },
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: operations,
      reconnectDelayMs: 0,
    });
    await makeLive(sockets[0]!, session);
    const terminal = session.command("accepted-reconnect", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => sockets[0]!.sent.some((frame) => frame.type === "command"));
    const sent = sockets[0]!.sent.find((frame) => frame.type === "command");
    sockets[0]!.emit({
      type: "commandAccepted",
      requestId: sent?.requestId,
      operationId: "accepted-reconnect",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    await waitFor(
      async () => (await operations.get(savedServerA, "accepted-reconnect"))?.state === "accepted",
    );

    session.reconnect();
    await waitFor(() => sockets[1]!.listenerCount("open") > 0);
    sockets[1]!.open();
    const next = snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" });
    sockets[1]!.emit(next);
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "snapshotCommitted"));
    sockets[1]!.emit({ type: "live", epochId: next.epochId, watermark: next.watermark });
    await waitFor(() =>
      sockets[1]!.sent.some((frame) => {
        if (frame.type !== "query") return false;
        const query = frame.query as Record<string, unknown> | undefined;
        return query?.kind === "operation.get";
      }),
    );
    const query = sockets[1]!.sent.find((frame) => frame.type === "query");
    sockets[1]!.emit({
      type: "queryCompleted",
      requestId: query?.requestId,
      result: {
        kind: "operation.get",
        operationId: "accepted-reconnect",
        receipt: {
          state: "completed",
          acceptedAt: "2026-08-27T12:00:00Z",
          result: { kind: "thread.delete", threadId: "thread-1" },
        },
      },
    });
    await expect(terminal).resolves.toMatchObject({
      operationId: "accepted-reconnect",
      type: "commandCompleted",
    });
    session.stop();
  });

  it("keeps the same durable command promise while changing projection intent", async () => {
    const operations = new MemoryV2OperationStore();
    const sockets = [new FakeV2Socket(), new FakeV2Socket()];
    let socketIndex = 0;
    const session = new SyncV2Session({
      savedServerId: savedServerA,
      transportLease: { openSync: () => sockets[socketIndex++]! },
      intent: {
        catalog: { activeLimit: 2, archivedLimit: 1 },
        currentThread: null,
      },
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: operations,
      reconnectDelayMs: 0,
    });
    await makeLive(sockets[0]!, session);
    const terminal = session.command("accepted-intent-change", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => sockets[0]!.sent.some((frame) => frame.type === "command"));
    const sent = sockets[0]!.sent.find((frame) => frame.type === "command");
    sockets[0]!.emit({
      type: "commandAccepted",
      requestId: sent?.requestId,
      operationId: "accepted-intent-change",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    await waitFor(
      async () =>
        (await operations.get(savedServerA, "accepted-intent-change"))?.state === "accepted",
    );

    session.updateIntent({
      catalog: { activeLimit: 2, archivedLimit: 1 },
      currentThread: { threadId: "thread-1", turnLimit: 36 },
    });
    await waitFor(() => sockets[1]!.listenerCount("open") > 0);
    sockets[1]!.open();
    expect(sockets[1]!.sent.find((frame) => frame.type === "open")).toMatchObject({
      intent: { currentThread: { threadId: "thread-1", turnLimit: 36 } },
    });
    const next = snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" });
    sockets[1]!.emit(next);
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "snapshotCommitted"));
    sockets[1]!.emit({ type: "live", epochId: next.epochId, watermark: next.watermark });
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "query"));
    const query = sockets[1]!.sent.find((frame) => frame.type === "query");
    sockets[1]!.emit({
      type: "queryCompleted",
      requestId: query?.requestId,
      result: {
        kind: "operation.get",
        operationId: "accepted-intent-change",
        receipt: {
          state: "completed",
          acceptedAt: "2026-08-27T12:00:00Z",
          result: { kind: "thread.delete", threadId: "thread-1" },
        },
      },
    });
    await expect(terminal).resolves.toMatchObject({
      operationId: "accepted-intent-change",
      type: "commandCompleted",
    });
    expect(sockets[0]!.sent.filter((frame) => frame.type === "command")).toHaveLength(1);
    expect(sockets[1]!.sent.filter((frame) => frame.type === "command")).toHaveLength(0);
    session.stop();
  });

  it("rejects a post-admission terminal frame before acceptance", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    void session
      .command("terminal-before-acceptance", { kind: "thread.delete", threadId: "thread-1" })
      .catch(() => undefined);
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    socket.emit({
      type: "commandCompleted",
      operationId: "terminal-before-acceptance",
      result: { kind: "thread.delete", threadId: "thread-1" },
    });
    await waitFor(() => socket.closes.at(-1)?.reason === "command_terminal_out_of_phase");
    expect(socket.closes.at(-1)?.code).toBe(1008);
    expect((await operations.get(savedServerA, "terminal-before-acceptance"))?.state).toBe("sent");
    session.stop();
  });

  it("rejects acceptance after a pre-admission terminal state", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("acceptance-after-terminal", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({
      type: "commandRejected",
      requestId,
      operationId: "acceptance-after-terminal",
      error: { code: "invalidRequest", recovery: "none", message: "rejected" },
    });
    await expect(terminal).resolves.toMatchObject({ type: "commandRejected" });
    socket.emit({
      type: "commandAccepted",
      requestId,
      operationId: "acceptance-after-terminal",
      acceptedAt: "2026-08-27T12:00:00Z",
    });
    await waitFor(() => socket.closes.at(-1)?.reason === "command_acceptance_out_of_phase");
    expect((await operations.get(savedServerA, "acceptance-after-terminal"))?.state).toBe(
      "rejected",
    );
    session.stop();
  });

  it.each([
    [
      "duplicate",
      {
        type: "commandCompleted",
        operationId: "duplicate-terminal",
        result: { kind: "thread.delete", threadId: "thread-1" },
      },
    ],
    [
      "conflicting",
      {
        type: "commandFailed",
        operationId: "duplicate-terminal",
        error: { code: "sourceUnavailable", recovery: "retry", message: "failed" },
      },
    ],
  ] as const)(
    "rejects a %s terminal frame after the operation is terminal",
    async (_kind, secondTerminal) => {
      const operations = new MemoryV2OperationStore();
      const { socket, session } = setup(undefined, operations);
      await makeLive(socket, session);
      const terminal = session.command("duplicate-terminal", {
        kind: "thread.delete",
        threadId: "thread-1",
      });
      await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
      const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
      socket.emit({
        type: "commandAccepted",
        requestId,
        operationId: "duplicate-terminal",
        acceptedAt: "2026-08-27T12:00:00Z",
      });
      socket.emit({
        type: "commandCompleted",
        operationId: "duplicate-terminal",
        result: { kind: "thread.delete", threadId: "thread-1" },
      });
      await expect(terminal).resolves.toMatchObject({ type: "commandCompleted" });
      socket.emit(secondTerminal);
      await waitFor(() => socket.closes.at(-1)?.reason === "command_terminal_out_of_phase");
      expect((await operations.get(savedServerA, "duplicate-terminal"))?.state).toBe("completed");
      session.stop();
    },
  );

  it("deletes content-free receipt metadata after the 30-day maximum", async () => {
    const store = new MemoryV2OperationStore();
    await store.create(
      savedServerA,
      "operation",
      { kind: "thread.delete", threadId: "thread-1" },
      0,
    );
    await store.transition(savedServerA, "operation", ["created"], { state: "sent" }, 0);
    await store.transition(
      savedServerA,
      "operation",
      ["sent"],
      { state: "accepted", acceptedAt: "1970-01-01T00:00:00Z" },
      0,
    );
    await store.transition(savedServerA, "operation", ["accepted"], { state: "failed" }, 0);
    await store.prune(savedServerA, V2_OPERATION_RECEIPT_MAX_AGE_MS + 1);
    expect(await store.get(savedServerA, "operation")).toBeNull();
  });

  it("purges exactly one saved-server partition on explicit deletion", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    await projections.commitSnapshot(savedServerA, snapshot());
    await projections.commitSnapshot(
      savedServerB,
      snapshot({ epochId: "epoch-b", revision: "sync-v2-revision:b" }),
    );
    const command: V2Command = { kind: "thread.delete", threadId: "thread-a" };
    await operations.create(savedServerA, "same-id", command);
    await operations.create(savedServerB, "same-id", { ...command, threadId: "thread-b" });
    await Promise.all([
      projections.deleteSavedServer(savedServerA),
      operations.deleteSavedServer(savedServerA),
    ]);
    expect(await projections.active(savedServerA)).toBeNull();
    expect(await operations.get(savedServerA, "same-id")).toBeNull();
    expect(await projections.active(savedServerB)).not.toBeNull();
    expect((await operations.get(savedServerB, "same-id"))?.command).toEqual(
      expect.objectContaining({ threadId: "thread-b" }),
    );
  });
});
