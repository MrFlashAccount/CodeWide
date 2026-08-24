import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  persisted: [] as Array<{ type: string; key?: string; value?: { id: string } }>,
  loadBoundary: vi.fn(),
  loadResolvedWindow: vi.fn(),
  loadAdjacentWindow: vi.fn(),
  invalidations: new Map<string, { id: string; connectionId: string; threadId: string; cursor: number }>(),
}));

vi.mock("../src/data/thread-detail-sqlite.native", () => ({
  createThreadDetailSqlite: (onCommit: (changes: readonly unknown[]) => void) => {
    let transaction: Array<{ type: string; key?: string; value?: { id: string } }> | null = null;
    return {
      prepare: async () => undefined,
      diagnostics: async () => ({
        rowCount: 0,
        payloadBytes: 0,
        historyPayloadBytes: 0,
        pendingRows: 0,
        pendingDeliveryRows: 0,
        physicalBytes: 0,
        reusableBytes: 0,
        mainFileBytes: 0,
        walFileBytes: 0,
        shmFileBytes: 0,
        staleDeliveryRowsRemoved: 0,
        historyFamiliesEvicted: 0,
        historyBytesEvicted: 0,
      }),
      begin: () => { transaction = []; },
      write: (change: { type: string; key?: string; value?: { id: string } }) => { transaction?.push(change); },
      commit: async () => {
        const changes = transaction ?? [];
        transaction = null;
        harness.persisted.push(...changes);
        onCommit(changes);
      },
      flush: async () => undefined,
      close: async () => undefined,
      loadBoundary: harness.loadBoundary,
      loadResolvedWindow: harness.loadResolvedWindow,
      loadAdjacentWindow: harness.loadAdjacentWindow,
      loadAuthoritativeFacts: async () => [],
      loadPrependFacts: async () => [],
    };
  },
}));

vi.mock("../src/data/persistent-collection.native", () => ({
  createPersistentCollectionModel: () => ({
    collection: {
      preload: async () => undefined,
      get: (id: string) => harness.invalidations.get(id),
      insert: (row: { id: string; connectionId: string; threadId: string; cursor: number }) => {
        harness.invalidations.set(row.id, row);
        return { isPersisted: { promise: Promise.resolve() } };
      },
      update: (id: string, mutate: (row: { cursor: number }) => void) => {
        const row = harness.invalidations.get(id)!;
        const next = { ...row };
        mutate(next);
        harness.invalidations.set(id, next);
        return { isPersisted: { promise: Promise.resolve() } };
      },
      delete: (id: string) => {
        harness.invalidations.delete(id);
        return { isPersisted: { promise: Promise.resolve() } };
      },
    },
    close: () => undefined,
  }),
}));

vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => ({}),
  registerUiCacheCollectionFlusher: () => () => undefined,
}));

import { createThreadDetailDatabase } from "../src/data/thread-detail-database.native";

function authoritativeThread(commandId: string): Thread {
  const turn = completedTurn("remote-turn", commandId);
  return {
    id: "thread",
    name: "Thread",
    preview: "hello",
    cwd: "/repo",
    updatedAt: 2,
    status: { type: "idle" },
    ephemeral: false,
    turns: [turn],
  } as unknown as Thread;
}

function completedTurn(id: string, commandId: string): Turn {
  return {
    id,
    status: "completed",
    startedAt: 1,
    completedAt: 2,
    items: [{ type: "userMessage", id: "user", clientId: commandId, content: [] }],
  } as unknown as Turn;
}

function sealedTurnRow(ordinal: number) {
  return {
    id: `turn:server:thread:turn-${ordinal}`,
    kind: "turn",
    connectionId: "server",
    remoteThreadId: "thread",
    remoteTurnId: `turn-${ordinal}`,
    historyEpoch: 0,
    ordinal,
    sessionId: null,
    lastOpenedAt: 0,
    sealed: true,
    thread: null,
    turn: null,
    turnMetadata: null,
    activityItems: null,
    pending: null,
  } as const;
}

function resolvedWindow(firstOrdinal: number, lastOrdinal: number) {
  return {
    historyEpoch: 0,
    latestSealedOrdinal: 47,
    earliestSealedOrdinal: 0,
    turnRows: Array.from(
      { length: lastOrdinal - firstOrdinal + 1 },
      (_, index) => sealedTurnRow(lastOrdinal - index),
    ),
    detailRows: [],
    liveRows: [],
  };
}

describe("thread detail ownership races", () => {
  beforeEach(() => {
    harness.persisted.length = 0;
    harness.invalidations.clear();
    harness.loadBoundary.mockReset().mockImplementation(async (
      _connectionId: string,
      _threadId: string,
      _historyEpoch: number,
      direction: "asc" | "desc",
    ) => sealedTurnRow(direction === "asc" ? 0 : 47));
    harness.loadAdjacentWindow.mockReset().mockResolvedValue({ turnRows: [], detailRows: [], liveRows: [] });
    harness.loadResolvedWindow.mockReset().mockResolvedValue({
      historyEpoch: 0,
      latestSealedOrdinal: null,
      earliestSealedOrdinal: null,
      turnRows: [],
      detailRows: [],
      liveRows: [],
    });
  });

  it("keeps three pages resident and trims only after the gesture without dropping the mutable head", async () => {
    harness.loadResolvedWindow.mockResolvedValue(resolvedWindow(24, 47));
    harness.loadAdjacentWindow.mockImplementation(async ({ boundaryOrdinal, direction }) => {
      if (direction === "older" && boundaryOrdinal === 24) return { ...resolvedWindow(12, 23), liveRows: [] };
      if (direction === "older" && boundaryOrdinal === 12) return { ...resolvedWindow(0, 11), liveRows: [] };
      if (direction === "newer" && boundaryOrdinal === 35) return { ...resolvedWindow(36, 47), liveRows: [] };
      return { turnRows: [], detailRows: [], liveRows: [] };
    });
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "live-delivery",
      method: "turn/start",
      presentation: "delivery",
      text: "still live",
      attachments: [],
      state: "accepted",
      attempts: 1,
      lastError: null,
      createdAt: 24,
      updatedAt: 24,
    });
    await details.commitPending(pending, { durable: true });

    const before = details.chat.window$("server", "thread").peek();
    expect(before.turnRowIds).toHaveLength(24);
    expect(before.liveRowIds).toEqual([pending.id]);
    const pulled = await details.pullRange("server", "thread", "older");
    const older = details.chat.window$("server", "thread").peek();

    expect(pulled).toBe(true);
    expect(older.status).toBe("ready");
    expect(older.turnRowIds).toHaveLength(36);
    expect(older.liveRowIds).toEqual([pending.id]);
    expect(details.chat.residentRowCount()).toBe(37);
    expect(harness.loadAdjacentWindow.mock.calls[0]?.[0]).toMatchObject({
      boundaryOrdinal: 24,
      direction: "older",
      turnLimit: 12,
    });

    expect(await details.pullRange("server", "thread", "older")).toBe(true);
    const expandedOlder = details.chat.window$("server", "thread").peek();
    expect(expandedOlder.turnRowIds).toHaveLength(48);
    expect(await details.trimRange("server", "thread", "older")).toBe(true);
    const oldest = details.chat.window$("server", "thread").peek();
    expect(oldest.turnRowIds).toHaveLength(36);
    expect(oldest.liveRowIds).toEqual([pending.id]);
    expect(details.chat.residentRowCount()).toBe(37);

    expect(await details.pullRange("server", "thread", "newer")).toBe(true);
    expect(details.chat.window$("server", "thread").peek().turnRowIds).toHaveLength(48);
    expect(await details.trimRange("server", "thread", "newer")).toBe(true);
    const latest = details.chat.window$("server", "thread").peek();
    expect(latest.turnRowIds).toHaveLength(36);
    expect(latest.liveRowIds).toEqual([pending.id]);
    expect(details.chat.residentRowCount()).toBe(37);
    await details.close();
  });

  it("coalesces repeated edge callbacks into one SQLite range pull", async () => {
    let releaseOlder!: () => void;
    const olderRead = new Promise<void>((resolve) => { releaseOlder = resolve; });
    harness.loadResolvedWindow.mockResolvedValue(resolvedWindow(24, 47));
    harness.loadAdjacentWindow.mockImplementation(async () => {
      await olderRead;
      return { ...resolvedWindow(12, 23), liveRows: [] };
    });
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });

    const first = details.pullRange("server", "thread", "older");
    const second = details.pullRange("server", "thread", "older");
    await vi.waitFor(() => expect(harness.loadAdjacentWindow).toHaveBeenCalledTimes(1));
    releaseOlder();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(harness.loadAdjacentWindow).toHaveBeenCalledTimes(1);
    await details.close();
  });

  it("replaces an expanded historical range with the bounded latest window", async () => {
    harness.loadResolvedWindow
      .mockResolvedValueOnce(resolvedWindow(0, 35))
      .mockResolvedValueOnce(resolvedWindow(12, 47));
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: "turn-12" });

    expect(await details.pullRange("server", "thread", "latest")).toBe(true);
    const latest = details.chat.window$("server", "thread").peek();
    const remoteTurnIds = details.chat.readRows(latest.turnRowIds).map(({ remoteTurnId }) => remoteTurnId);
    expect(latest.turnRowIds).toHaveLength(36);
    expect(remoteTurnIds).toContain("turn-47");
    expect(remoteTurnIds).not.toContain("turn-0");
    await details.close();
  });

  it("publishes a remote older page in the same atomic range commit that persists it", async () => {
    harness.loadResolvedWindow.mockResolvedValue(resolvedWindow(24, 47));
    harness.loadAdjacentWindow.mockResolvedValue({ turnRows: [], detailRows: [], liveRows: [] });
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });

    expect(await details.pullRange("server", "thread", "older")).toBe(false);
    const remotePage = Array.from({ length: 12 }, (_, index) => completedTurn(`turn-${12 + index}`, `command-${index}`));
    const result = await details.prependTurns("server", "thread", 0, remotePage, "older-page-2");
    const range = details.chat.window$("server", "thread").peek();

    expect(result).toMatchObject({ accepted: true, extendedMinimum: true });
    expect(range.turnRowIds).toHaveLength(36);
    expect(details.chat.readRows(range.turnRowIds).map(({ remoteTurnId }) => remoteTurnId)).toContain("turn-12");
    expect(range.turnRowIds).toContain("turn:server:thread:turn-47");
    expect(harness.persisted.length).toBeGreaterThan(0);
    await details.close();
  });

  it("drops a superseded press preload and transfers the winner to the mounted conversation", async () => {
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => { releaseFirst = resolve; });
    harness.loadResolvedWindow.mockImplementation(async ({ connectionId, threadId, turnLimit }) => {
      if (threadId === "first") await firstRead;
      const row = {
        id: `turn:${connectionId}:${threadId}:turn-1`,
        kind: "turn",
        connectionId,
        remoteThreadId: threadId,
        remoteTurnId: "turn-1",
        historyEpoch: 0,
        ordinal: 1,
        sessionId: null,
        lastOpenedAt: 0,
        sealed: true,
        thread: null,
        turn: null,
        turnMetadata: null,
        activityItems: null,
        pending: null,
      };
      return {
        historyEpoch: 0,
        latestSealedOrdinal: 1,
        earliestSealedOrdinal: 1,
        turnRows: [row],
        detailRows: [],
        liveRows: [],
        residentTurnLimit: turnLimit,
      };
    });
    const details = createThreadDetailDatabase();
    await details.prepare();
    const request = (threadId: string) => ({
      connectionId: "server",
      threadId,
      anchorTurnId: null,
    });

    const cancelFirst = details.preloadWindow(request("first"));
    await vi.waitFor(() => expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(1));
    const cancelSecond = details.preloadWindow(request("second"));
    const secondResource = details.windowResource(request("second"));
    releaseFirst();
    await secondResource.ready$.peek();

    expect(harness.loadResolvedWindow.mock.calls.map(([input]) => input.threadId)).toEqual(["first", "second"]);
    expect(details.chat.window$("server", "second").peek().turnRowIds).toEqual(["turn:server:second:turn-1"]);
    const releaseMounted = details.retainWindow("server", "second");
    cancelFirst();
    cancelSecond();
    expect(details.chat.residentRowCount()).toBe(1);
    releaseMounted();
    expect(details.chat.residentRowCount()).toBe(0);
    await details.close();
  });

  it("does not let an optimistic rollback or tombstone clobber an authoritative same-key turn", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "command",
      method: "turn/start",
      presentation: "delivery",
      text: "hello",
      attachments: [],
      state: "sending",
      attempts: 0,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
    const optimistic = details.stagePendingMutation({ upserts: [pending], deletes: [] });

    await details.importThreadSnapshot("server", authoritativeThread("command"), "recovery");
    optimistic.rollback();
    await details.commitPendingMutation({ upserts: [], deletes: [pending.id] }, { durable: true });

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual(["remote-turn"]);
    expect(harness.persisted.some((change) => change.type === "delete" && change.key === pending.id)).toBe(false);
    await details.close();
  });

  it("keeps a sent receipt until the authoritative turn takes over its stable key", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "command",
      method: "turn/start",
      presentation: "delivery",
      text: "hello",
      attachments: [],
      state: "delivered",
      attempts: 1,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_001,
    });
    await details.commitPending(pending, { durable: true });
    await details.applyCommandDelivery({
      connectionId: "server",
      commandId: "command",
      targetCommandId: null,
      method: "turn/start",
      threadId: "thread",
      text: "hello",
      attachments: [],
      state: "delivered",
      attempts: 1,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_002,
    });

    expect(details.hasPendingDelivery("server", "thread", "command")).toBe(true);
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds))
      .toContainEqual(expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({ state: "delivered" }),
      }));

    await details.importThreadSnapshot("server", authoritativeThread("command"), "recovery");

    expect(details.hasPendingDelivery("server", "thread", "command")).toBe(false);
    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual(["remote-turn"]);
    await details.close();
  });

  it("does not materialize a missing optimistic row from a transient outbox delta", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");
    const delivery = {
      connectionId: "server",
      commandId: "historical-replay",
      targetCommandId: null,
      method: "turn/start" as const,
      threadId: "thread",
      text: "old prompt",
      attachments: [],
      state: "sending" as const,
      attempts: 2,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_001,
    };

    await details.applyCommandDelivery(delivery);
    expect(details.hasPendingDelivery("server", "thread", delivery.commandId)).toBe(false);

    await details.reconcileNativeCommands("server", "thread", [delivery]);
    expect(details.hasPendingDelivery("server", "thread", delivery.commandId)).toBe(true);
    await details.close();
  });

  it("does not reconstruct historical direct deliveries from a companion queue snapshot", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");

    await details.replaceQueued("server", "thread", [
      {
        commandId: "historical-direct",
        remoteThreadId: "thread",
        params: { threadId: "thread", input: [{ type: "text", text: "old prompt" }] },
        presentation: "delivery",
        workspaceRequestId: null,
        state: "uncertain",
        order: 1,
        createdAt: 1_000_000,
        lastError: null,
      },
      {
        commandId: "queued-prompt",
        remoteThreadId: "thread",
        params: { threadId: "thread", input: [{ type: "text", text: "next prompt" }] },
        presentation: "queue",
        workspaceRequestId: null,
        state: "queued",
        order: 2,
        createdAt: 1_000_001,
        lastError: null,
      },
    ]);

    expect(details.hasPendingDelivery("server", "thread", "historical-direct")).toBe(false);
    expect(details.listQueued("server", "thread").map(({ commandId }) => commandId)).toEqual(["queued-prompt"]);
    await details.close();
  });

  it("lets a companion delivery receipt advance only an existing optimistic row", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "current-direct",
      method: "turn/start",
      presentation: "delivery",
      text: "current prompt",
      attachments: [],
      state: "sending",
      attempts: 0,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
    await details.commitPending(pending);

    await details.replaceQueued("server", "thread", [{
      commandId: "current-direct",
      remoteThreadId: "thread",
      params: { threadId: "thread", input: [{ type: "text", text: "current prompt" }] },
      presentation: "delivery",
      workspaceRequestId: null,
      state: "delivered",
      order: 1,
      createdAt: 1_000_000,
      lastError: null,
    }]);

    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds))
      .toContainEqual(expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({ commandId: "current-direct", state: "delivered" }),
      }));
    await details.close();
  });

  it("protects only an in-flight staged send and cannot resurrect it after cleanup", async () => {
    harness.loadResolvedWindow.mockResolvedValue(resolvedWindow(24, 47));
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "in-flight",
      method: "turn/start",
      presentation: "delivery",
      text: "new prompt",
      attachments: [],
      state: "sending",
      attempts: 0,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
    const optimistic = details.stagePendingMutation({ upserts: [pending], deletes: [] });

    await details.reconcileNativeCommands("server", "thread", []);
    expect(details.hasPendingDelivery("server", "thread", pending.pending!.commandId)).toBe(true);

    optimistic.complete();
    await details.reconcileNativeCommands("server", "thread", []);
    expect(details.hasPendingDelivery("server", "thread", pending.pending!.commandId)).toBe(false);

    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds))
      .not.toContainEqual(expect.objectContaining({ kind: "pending" }));
    await details.close();
  });

  it("appends canonical turns by stable id without replacing sealed history", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("first"), "initial");
    const first = details.getThread("server", "thread")!.turns[0]!;

    await details.appendTurns("server", "thread", [completedTurn("second", "second")]);
    await details.appendTurns("server", "thread", [
      completedTurn("second", "second"),
      completedTurn("third", "third"),
    ]);

    const turns = details.getThread("server", "thread")!.turns;
    expect(turns.map(({ id }) => id)).toEqual(["remote-turn", "second", "third"]);
    expect(turns[0]).toBe(first);
    await details.close();
  });

  it("persists the older-history cursor with the durable thread epoch", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("first"), "initial", null, "older-1");

    expect(details.historyCursor("server", "thread")).toBe("older-1");
    await details.appendTurns("server", "thread", [completedTurn("second", "second")], null, "tail-refresh");
    expect(details.historyCursor("server", "thread")).toBe("older-1");

    await details.prependTurns("server", "thread", 0, [], "older-2");
    expect(details.historyCursor("server", "thread")).toBe("older-2");
    expect(harness.persisted.some((change) => change.value?.historyCursor === "older-2")).toBe(true);
    await details.close();
  });

  it("turns a replay-expiry snapshot into one lazy cursor catch-up", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const thread = authoritativeThread("first");
    await details.importThreadSnapshot("server", thread, "initial");

    await details.applySnapshot("server", [{ thread, archived: false }], 99);
    expect(details.captureRefreshCursor("server", "thread")).toBe(99);

    await details.appendTurns("server", "thread", [], 99);
    expect(details.captureRefreshCursor("server", "thread")).toBeNull();
    await details.close();
  });

  it("keeps direct delivery volatile after Kotlin durably accepts it", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "accepted-before-close",
      method: "turn/start",
      presentation: "delivery",
      text: "hello",
      attachments: [],
      state: "accepted",
      attempts: 1,
      lastError: null,
      createdAt: 2,
      updatedAt: 2,
    });

    const accepted = details.commitPending(pending, { durable: true });
    const closed = details.close();
    await expect(accepted).resolves.toBe(true);
    await closed;

    expect(harness.persisted.some((change) => change.value?.id === pending.id)).toBe(false);
  });
});
