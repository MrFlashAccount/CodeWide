import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  persisted: [] as Array<{ type: string; key?: string; value?: { id: string } }>,
  loadResolvedWindow: vi.fn(),
}));

vi.mock("../src/data/thread-detail-sqlite.native", () => ({
  createThreadDetailSqlite: (onCommit: (changes: readonly unknown[]) => void) => {
    let transaction: Array<{ type: string; key?: string; value?: { id: string } }> | null = null;
    return {
      prepare: async () => undefined,
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
      loadResolvedWindow: harness.loadResolvedWindow,
      loadAuthoritativeFacts: async () => [],
      loadPrependFacts: async () => [],
    };
  },
}));

vi.mock("../src/data/persistent-collection.native", () => ({
  createPersistentCollectionModel: () => ({
    collection: {
      preload: async () => undefined,
      get: () => undefined,
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
  const turn = {
    id: "remote-turn",
    status: "completed",
    startedAt: 1,
    completedAt: 2,
    items: [{ type: "userMessage", id: "user", clientId: commandId, content: [] }],
  } as unknown as Turn;
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

describe("thread detail ownership races", () => {
  beforeEach(() => {
    harness.persisted.length = 0;
    harness.loadResolvedWindow.mockReset().mockResolvedValue({
      historyEpoch: 0,
      latestSealedOrdinal: null,
      earliestSealedOrdinal: null,
      requestedMaxOrdinal: null,
      turnRows: [],
      detailRows: [],
      liveRows: [],
    });
  });

  it("drops a superseded press preload and transfers the winner to the mounted conversation", async () => {
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => { releaseFirst = resolve; });
    harness.loadResolvedWindow.mockImplementation(async ({ connectionId, threadId, residentTurnLimit }) => {
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
        requestedMaxOrdinal: null,
        turnRows: [row],
        detailRows: [],
        liveRows: [],
        residentTurnLimit,
      };
    });
    const details = createThreadDetailDatabase();
    await details.prepare();
    const request = (threadId: string) => ({
      connectionId: "server",
      threadId,
      anchorTurnId: null,
      residentHistoryEpoch: null,
      residentMaxOrdinal: undefined,
      residentTurnLimit: 10,
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

    await details.replaceThread("server", authoritativeThread("command"));
    optimistic.rollback();
    await details.commitPendingMutation({ upserts: [], deletes: [pending.id] }, { durable: true });

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual(["remote-turn"]);
    expect(harness.persisted.some((change) => change.type === "delete" && change.key === pending.id)).toBe(false);
    await details.close();
  });

  it("persists work accepted before close seals the queue", async () => {
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

    expect(harness.persisted.some((change) => change.value?.id === pending.id)).toBe(true);
  });
});
