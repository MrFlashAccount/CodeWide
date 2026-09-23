import type { Thread, Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  authoritativeTimelineRowId,
  type ThreadDetailRow,
} from "../src/data/thread-detail-projection";
import { residentThreadWindow } from "../src/data/resident-thread-window";
import { ThreadSyncLane } from "../src/data/thread-cursor-sync";

const harness = vi.hoisted(() => ({
  persisted: [] as Array<{ type: string; key?: string; value?: { id: string } }>,
  commits: [] as Array<{ durable?: boolean } | undefined>,
  loadBoundary: vi.fn(),
  loadResolvedWindow: vi.fn(),
  loadAdjacentWindow: vi.fn(),
  failNextWrite: false,
  rollbacks: 0,
}));

vi.mock("../src/data/thread-detail-sqlite.native", () => ({
  createThreadDetailSqlite: (onCommit: (changes: readonly unknown[]) => void) => {
    let transaction: Array<{ type: string; key?: string; value?: { id: string } }> | null = null;
    return {
      prepare: async () => undefined,
      confirmCommandReceipts: async () => [],
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
      begin: () => {
        if (transaction !== null)
          throw new Error("Thread detail SQLite transaction is already open");
        transaction = [];
      },
      write: (change: { type: string; key?: string; value?: { id: string } }) => {
        if (harness.failNextWrite) {
          harness.failNextWrite = false;
          throw new TypeError("simulated projection failure");
        }
        transaction?.push(change);
      },
      rollback: () => {
        transaction = null;
        harness.rollbacks += 1;
      },
      commit: async (options?: { durable?: boolean }) => {
        const changes = transaction ?? [];
        transaction = null;
        harness.commits.push(options);
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

vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => ({}),
  registerUiCacheCollectionFlusher: () => () => undefined,
}));

import {
  createThreadDetailDatabase,
  threadWindowCoverage,
} from "../src/data/thread-detail-database.native";

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
    items: [
      { type: "userMessage", id: `${id}-user`, clientId: commandId, content: [] },
      { type: "agentMessage", id: `${id}-agent`, text: "done", phase: "final_answer" },
    ],
  } as unknown as Turn;
}

function sparseCompletedTurn(id: string, commandId: string): Turn {
  return {
    ...completedTurn(id, commandId),
    items: [{ type: "userMessage", id: `${id}-user`, clientId: commandId, content: [] }],
  } as unknown as Turn;
}

function liveThread(commandId: string): Thread {
  return {
    ...authoritativeThread(commandId),
    status: { type: "active", activeFlags: [] },
    turns: [
      {
        ...sparseCompletedTurn("remote-turn", commandId),
        status: "inProgress",
        completedAt: null,
      } as Turn,
    ],
  } as unknown as Thread;
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

function mutableTurnRow(turn: Turn, ordinal = 2): ThreadDetailRow {
  return {
    ...sealedTurnRow(ordinal),
    id: `turn:server:thread:${turn.id}`,
    remoteTurnId: turn.id,
    sealed: false,
    turn,
  };
}

function resolvedWindow(firstOrdinal: number, lastOrdinal: number) {
  return {
    historyEpoch: 0,
    latestSealedOrdinal: 47,
    earliestSealedOrdinal: 0,
    turnRows: Array.from({ length: lastOrdinal - firstOrdinal + 1 }, (_, index) =>
      sealedTurnRow(lastOrdinal - index),
    ),
    detailRows: [],
    liveRows: [],
  };
}

function completeResolvedWindow() {
  const turn = completedTurn("turn-1", "command-1");
  return {
    historyEpoch: 0,
    latestSealedOrdinal: 1,
    earliestSealedOrdinal: 1,
    turnRows: [{ ...sealedTurnRow(1), turn }],
    detailRows: [],
    liveRows: [
      {
        ...sealedTurnRow(-1),
        id: "server\u0000thread\u0000thread",
        kind: "thread" as const,
        remoteTurnId: null,
        sealed: false,
        historyCursor: "older-page",
        historyHadTurns: true,
        historyCoverageMinOrdinal: 1,
        historyCoverageMaxOrdinal: 1,
        thread: { ...authoritativeThread("command-1"), turns: [] },
        turn: null,
      },
    ],
  };
}

function completeEmptyResolvedWindow() {
  const metadata = completeResolvedWindow().liveRows[0]!;
  return {
    historyEpoch: 0,
    latestSealedOrdinal: null,
    earliestSealedOrdinal: null,
    turnRows: [],
    detailRows: [],
    liveRows: [
      {
        ...metadata,
        historyCursor: null,
        historyHadTurns: false,
        historyCoverageMinOrdinal: null,
        historyCoverageMaxOrdinal: null,
        thread: { ...authoritativeThread("unused"), turns: [] },
      },
    ],
  };
}

describe("thread detail ownership races", () => {
  beforeEach(() => {
    harness.persisted.length = 0;
    harness.commits.length = 0;
    harness.failNextWrite = false;
    harness.rollbacks = 0;
    harness.loadBoundary
      .mockReset()
      .mockImplementation(
        async (
          _connectionId: string,
          _threadId: string,
          _historyEpoch: number,
          direction: "asc" | "desc",
        ) => sealedTurnRow(direction === "asc" ? 0 : 47),
      );
    harness.loadAdjacentWindow
      .mockReset()
      .mockResolvedValue({ turnRows: [], detailRows: [], liveRows: [] });
    harness.loadResolvedWindow.mockReset().mockResolvedValue({
      historyEpoch: 0,
      latestSealedOrdinal: null,
      earliestSealedOrdinal: null,
      turnRows: [],
      detailRows: [],
      liveRows: [],
    });
  });

  it("rolls back a failed cold import so the next thread writer can proceed", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    harness.failNextWrite = true;

    await expect(
      details.importThreadSnapshot("server", authoritativeThread("command-1"), "recovery"),
    ).rejects.toThrow("simulated projection failure");
    expect(harness.rollbacks).toBe(1);
    expect(details.getThread("server", "thread")).toBeNull();

    await expect(
      details.importThreadSnapshot("server", authoritativeThread("command-1"), "recovery"),
    ).resolves.toBeUndefined();
    expect(details.getThread("server", "thread")?.turns).toHaveLength(1);
    await details.close();
  });

  it("hydrates a cold thread without a browser structuredClone global", async () => {
    const originalStructuredClone = globalThis.structuredClone;
    Object.defineProperty(globalThis, "structuredClone", { configurable: true, value: undefined });
    const details = createThreadDetailDatabase();
    const coldThread = authoritativeThread("command-1");
    coldThread.turns = [
      {
        ...coldThread.turns[0]!,
        itemsView: "full",
        items: [
          coldThread.turns[0]!.items[0]!,
          {
            type: "reasoning",
            id: "reasoning-1",
            summary: ["thought"],
          } as unknown as Turn["items"][number],
          coldThread.turns[0]!.items[1]!,
        ],
      },
    ];
    try {
      await details.prepare();
      await expect(
        details.importThreadSnapshot("server", coldThread, "recovery"),
      ).resolves.toBeUndefined();
      expect(details.getThread("server", "thread")?.turns).toHaveLength(1);
    } finally {
      await details.close();
      Object.defineProperty(globalThis, "structuredClone", {
        configurable: true,
        value: originalStructuredClone,
      });
    }
  });

  it("reveals a complete SQLite window immediately and refreshes its bounded head on activation", async () => {
    let releaseRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    harness.loadResolvedWindow.mockResolvedValue(completeResolvedWindow());
    const hydrateWindow = vi.fn(async () => await refresh);
    const details = createThreadDetailDatabase();
    const reconcilePending = vi.fn(
      async ({ connectionId, threadId }: { connectionId: string; threadId: string }) => {
        await details.reconcileNativeCommands(connectionId, threadId, [
          {
            connectionId,
            commandId: "pending-command",
            targetCommandId: null,
            method: "turn/start",
            threadId,
            text: "pending prompt",
            attachments: [],
            state: "accepted",
            attempts: 0,
            lastError: null,
            createdAt: 1_000_000,
            updatedAt: 1_000_001,
          },
        ]);
      },
    );
    details.setRemoteLoader({
      reconcilePending,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    const resource = details.windowResource({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    });
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));

    expect(hydrateWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        cachedThread: expect.objectContaining({ id: "thread" }),
        requireAuthoritative: true,
        reason: "activation",
      }),
    );
    expect(reconcilePending).toHaveBeenCalledWith({ connectionId: "server", threadId: "thread" });
    expect(details.hasPendingDelivery("server", "thread", "pending-command")).toBe(true);
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({ commandId: "pending-command", text: "pending prompt" }),
      }),
    );
    expect(details.chat.window$("server", "thread").peek().status).toBe("ready");
    expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(true);
    releaseRefresh();
    await vi.waitFor(() =>
      expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(false),
    );
    await details.close();
  });

  it("marks a revealed cached window stale when its authoritative repair fails", async () => {
    harness.loadResolvedWindow.mockResolvedValue(completeResolvedWindow());
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => {
        throw new Error("upstream unavailable");
      },
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    const resource = details.windowResource({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    });
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));
    await vi.waitFor(() =>
      expect(details.chat.window$("server", "thread").peek()).toEqual(
        expect.objectContaining({
          backendRefreshing: false,
          error: "upstream unavailable",
          status: "background-retrying",
        }),
      ),
    );
    expect(details.readWindowRows(resource.window$.peek()).turnRows).not.toHaveLength(0);
    await details.close();
  });

  it("does not reveal a cached empty thread before its activation refresh confirms the head", async () => {
    const refresh = Promise.withResolvers<void>();
    harness.loadResolvedWindow
      .mockResolvedValueOnce(completeEmptyResolvedWindow())
      .mockResolvedValueOnce(completeResolvedWindow());
    const hydrateWindow = vi.fn(async () => await refresh.promise);
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    const resource = details.windowResource({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    });
    await vi.waitFor(() => expect(hydrateWindow).toHaveBeenCalledTimes(1));

    expect(resource.ready$.peek()).not.toBe(true);
    expect(details.chat.window$("server", "thread").peek()).toEqual(
      expect.objectContaining({ status: "initial-loading", turnRowIds: [] }),
    );

    refresh.resolve();
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));
    expect(details.chat.window$("server", "thread").peek()).toEqual(
      expect.objectContaining({
        status: "ready",
        turnRowIds: ["turn:server:thread:turn-1"],
      }),
    );
    await details.close();
  });

  it("falls back to a cached empty thread when its activation refresh is unavailable", async () => {
    harness.loadResolvedWindow.mockResolvedValue(completeEmptyResolvedWindow());
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => {
        throw new Error("offline");
      },
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    const resource = details.windowResource({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    });
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));

    expect(details.chat.window$("server", "thread").peek()).toEqual(
      expect.objectContaining({ status: "ready", turnRowIds: [] }),
    );
    await details.close();
  });

  it("clears Updating after installing its snapshot while a later invalidation is still refreshing", async () => {
    harness.loadResolvedWindow.mockResolvedValue(completeResolvedWindow());
    const lane = new ThreadSyncLane<void>();
    const snapshot = Promise.withResolvers<void>();
    const followUpSnapshot = Promise.withResolvers<void>();
    const hydrateWindow = vi.fn(
      async () =>
        await lane.run("server/thread", async () => await snapshot.promise, "afterCurrent"),
    );
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();
    const resource = details.windowResource({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    });
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));
    expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(true);

    let followUpInstalled = false;
    const followUp = lane.run(
      "server/thread",
      async () => {
        await followUpSnapshot.promise;
        followUpInstalled = true;
      },
      "afterCurrent",
    );
    snapshot.resolve();
    await vi.waitFor(() =>
      expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(false),
    );
    expect(details.chat.window$("server", "thread").peek().status).toBe("ready");
    expect(followUpInstalled).toBe(false);

    followUpSnapshot.resolve();
    await followUp;
    expect(followUpInstalled).toBe(true);
    await details.close();
  });

  it("does not refresh a complete cached head for a repeated resource read", async () => {
    harness.loadResolvedWindow.mockResolvedValue(completeResolvedWindow());
    const hydrateWindow = vi.fn(async () => undefined);
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    const request = {
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    };
    const first = details.windowResource(request);
    await vi.waitFor(() => expect(hydrateWindow).toHaveBeenCalledTimes(1));

    const repeated = details.windowResource(request);

    expect(repeated.ready$).toBe(first.ready$);
    expect(hydrateWindow).toHaveBeenCalledTimes(1);
    expect(hydrateWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requireAuthoritative: true,
        reason: "activation",
      }),
    );
    expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(1);
    await details.close();
  });

  it("does not mistake a live head or a hole in resident history for a complete window", async () => {
    const details = createThreadDetailDatabase();
    const cached = completeResolvedWindow();
    const meta = cached.liveRows[0]!;
    const rows: ThreadDetailRow[] = [
      { ...meta, historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 2 },
      { ...sealedTurnRow(0), turn: completedTurn("turn-0", "command-0") },
      { ...sealedTurnRow(2), turn: completedTurn("turn-2", "command-2") },
      mutableTurnRow(liveThread("live-command").turns[0]!),
    ];
    const request = { connectionId: "server", threadId: "thread", anchorTurnId: null };
    const previous = details.chat.window$("server", "thread").peek();
    expect(residentThreadWindow(request, rows, previous)).toBeNull();
    const missing = { ...sealedTurnRow(1), turn: completedTurn("turn-1", "command-1") };
    rows.push(missing);
    const complete = residentThreadWindow(request, rows, previous);
    expect(complete?.turnRows.map((row) => row.ordinal)).toEqual([2, 1, 0]);
    expect(complete?.turnRows[1]).toBe(missing);
    expect(complete?.liveRows).toContainEqual(
      expect.objectContaining({ sealed: false, kind: "turn" }),
    );
    expect(
      residentThreadWindow({ ...request, anchorTurnId: "not-resident" }, rows, previous),
    ).toBeNull();
    await details.close();
  });

  it("selects a bounded saved-anchor window without including the rest of the resident history", async () => {
    const details = createThreadDetailDatabase();
    const rows: ThreadDetailRow[] = [
      {
        ...completeResolvedWindow().liveRows[0]!,
        historyCoverageMinOrdinal: 0,
        historyCoverageMaxOrdinal: 99,
      },
    ];
    for (let ordinal = 0; ordinal < 100; ordinal += 1) {
      rows.push({
        ...sealedTurnRow(ordinal),
        turn: completedTurn(`turn-${ordinal}`, `command-${ordinal}`),
      });
    }
    const window = residentThreadWindow(
      { connectionId: "server", threadId: "thread", anchorTurnId: "turn-30" },
      rows,
      details.chat.window$("server", "thread").peek(),
    );
    expect(window?.turnRows).toHaveLength(15);
    expect(window?.turnRows.map((row) => row.ordinal)).toEqual(
      Array.from({ length: 15 }, (_, index) => 35 - index),
    );
    expect(window?.turnRows.some((row) => row.remoteTurnId === "turn-30")).toBe(true);
    expect(window?.turnRows.some((row) => row.remoteTurnId === "turn-99")).toBe(false);
    expect(window?.latestSealedOrdinal).toBe(99);
    expect(window?.earliestSealedOrdinal).toBe(0);
    await details.close();
  });

  it("publishes a cold server hydration from committed memory without rereading SQLite", async () => {
    const details = createThreadDetailDatabase();
    const hydrateWindow = vi.fn(async () => {
      await details.replaceThreadSnapshot(
        "server",
        authoritativeThread("fresh-command"),
        "recovery",
        null,
      );
    });
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(1);
    const rows = details.readWindowRows(details.chat.window$("server", "thread").peek());
    expect(rows.turnRows.map((row) => row.turn?.id)).toEqual(["remote-turn"]);
    expect(rows.turnRows[0]?.turn?.items).toContainEqual(
      expect.objectContaining({ clientId: "fresh-command" }),
    );
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({ value: expect.objectContaining({ kind: "turn" }) }),
    );
    await details.close();
  });

  it("keeps the selected chat fresh when hydration changes its resident rows", async () => {
    harness.loadResolvedWindow.mockResolvedValue(completeResolvedWindow());
    const details = createThreadDetailDatabase();
    const hydrateWindow = vi.fn(async () => {
      await details.replaceThreadSnapshot(
        "server",
        authoritativeThread("other-device-command"),
        "recovery",
        null,
      );
    });
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    const resource = details.windowResource({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: null,
    });
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));
    await vi.waitFor(() => expect(resource.window$.peek().backendRefreshing).toBe(false));
    expect(hydrateWindow).toHaveBeenCalledOnce();
    expect(harness.loadResolvedWindow).toHaveBeenCalledOnce();
    const rows = details.readWindowRows(resource.window$.peek());
    expect(rows.turnRows.map((row) => row.turn?.id)).toEqual(["remote-turn"]);
    expect(rows.turnRows[0]?.turn?.items).toContainEqual(
      expect.objectContaining({ clientId: "other-device-command" }),
    );
    await details.close();
  });

  it("rereads storage when hydration has not supplied the missing resident rows", async () => {
    harness.loadResolvedWindow
      .mockResolvedValueOnce({
        historyEpoch: 0,
        latestSealedOrdinal: null,
        earliestSealedOrdinal: null,
        turnRows: [],
        detailRows: [],
        liveRows: [],
      })
      .mockResolvedValueOnce(completeResolvedWindow());
    const hydrateWindow = vi.fn(async () => undefined);
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });

    expect(hydrateWindow).toHaveBeenCalledOnce();
    expect(hydrateWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        cachedThread: null,
        requireAuthoritative: true,
        reason: "metadata-missing",
      }),
    );
    expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(2);
    expect(details.chat.window$("server", "thread").peek().turnRowIds).toEqual([
      "turn:server:thread:turn-1",
    ]);
    await details.close();
  });

  it("rejects a cold hydration that still has no authoritative range", async () => {
    const empty = {
      historyEpoch: 0,
      latestSealedOrdinal: null,
      earliestSealedOrdinal: null,
      turnRows: [],
      detailRows: [],
      liveRows: [],
    };
    harness.loadResolvedWindow.mockResolvedValue(empty);
    const hydrateWindow = vi.fn(async () => undefined);
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();

    await expect(
      details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null }),
    ).rejects.toThrow("Authoritative thread hydration left no readable turns");

    expect(hydrateWindow).toHaveBeenCalledOnce();
    expect(details.chat.window$("server", "thread").peek().status).toBe("initial-error");
    expect(details.chat.window$("server", "thread").peek().turnRowIds).toEqual([]);
    await details.close();
  });

  it("reveals a cached SQLite window before its authoritative repair resolves", async () => {
    let releaseRepair!: () => void;
    const repair = new Promise<void>((resolve) => {
      releaseRepair = resolve;
    });
    const cached = completeResolvedWindow();
    const live = liveThread("command-2").turns[0]!;
    harness.loadResolvedWindow
      .mockResolvedValueOnce({ ...cached, liveRows: [...cached.liveRows, mutableTurnRow(live)] })
      .mockResolvedValueOnce(completeResolvedWindow());
    const hydrateWindow = vi.fn(async () => await repair);
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();
    const request = { connectionId: "server", threadId: "thread", anchorTurnId: null };

    const resource = details.windowResource(request);
    await vi.waitFor(() => expect(hydrateWindow).toHaveBeenCalledOnce());
    expect(hydrateWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        requireAuthoritative: true,
        reason: "mutable-head",
      }),
    );
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));

    expect(details.chat.window$("server", "thread").peek().status).toBe("ready");
    expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(true);
    expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(1);

    releaseRepair();
    await vi.waitFor(() =>
      expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(false),
    );
    expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(1);
    await details.close();
  });

  it("publishes completed hydration after an adopted preload is superseded by another gesture", async () => {
    const hydration = Promise.withResolvers<void>();
    const cached = completeResolvedWindow();
    const live = liveThread("command-live").turns[0]!;
    const shortWindow = {
      ...cached,
      earliestSealedOrdinal: null,
      latestSealedOrdinal: null,
      turnRows: [],
      liveRows: [
        {
          ...cached.liveRows[0]!,
          historyCursor: null,
          historyCoverageMinOrdinal: null,
          historyCoverageMaxOrdinal: null,
          historyHadTurns: true,
        },
        mutableTurnRow(live),
      ],
    };
    const completeWindow = {
      ...cached,
      earliestSealedOrdinal: 1,
      latestSealedOrdinal: 3,
      turnRows: [3, 2, 1].map((ordinal) => ({
        ...sealedTurnRow(ordinal),
        turn: completedTurn(`turn-${ordinal}`, `command-${ordinal}`),
      })),
      liveRows: [
        {
          ...cached.liveRows[0]!,
          historyCursor: null,
          historyCoverageMinOrdinal: 1,
          historyCoverageMaxOrdinal: 3,
        },
      ],
    };
    harness.loadResolvedWindow.mockImplementation(async ({ threadId }) =>
      threadId === "thread" && harness.loadResolvedWindow.mock.calls.length === 1
        ? shortWindow
        : completeWindow,
    );
    const hydrateWindow = vi.fn(async ({ request }) => {
      if (request.threadId === "thread") {
        await hydration.promise;
      }
    });
    const details = createThreadDetailDatabase();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.prepare();
    const request = {
      anchorTurnId: null,
      connectionId: "server",
      threadId: "thread",
    };

    const resource = details.windowResource(request);
    await vi.waitFor(() => expect(resource.ready$.peek()).toBe(true));
    await vi.waitFor(() => expect(hydrateWindow).toHaveBeenCalledOnce());
    const releaseMounted = resource.retain(() => undefined);
    expect(details.readWindowRows(resource.window$.peek()).liveRows).toContainEqual(
      expect.objectContaining({ remoteTurnId: "remote-turn" }),
    );

    const other = details.windowResource({
      anchorTurnId: null,
      connectionId: "server",
      threadId: "other",
    });
    await other.ready$.peek();
    hydration.resolve();

    await vi.waitFor(() =>
      expect(details.chat.window$("server", "thread").peek().backendRefreshing).toBe(false),
    );
    expect(
      details.readWindowRows(details.chat.window$("server", "thread").peek()).turnRows,
    ).toHaveLength(3);
    releaseMounted();
    await details.close();
  });

  it("distinguishes a server-proven empty tail from metadata-only or evicted history", () => {
    const metadata = {
      ...sealedTurnRow(-1),
      id: "meta",
      kind: "thread" as const,
      remoteTurnId: null,
      sealed: false,
      historyCursor: null,
      historyCoverageMinOrdinal: null,
      historyCoverageMaxOrdinal: null,
      thread: { id: "thread", turns: [] } as unknown as Thread,
    };
    const rows = { turnRows: [], liveRows: [metadata] };

    expect(threadWindowCoverage({ anchorTurnId: null }, rows)).toEqual({
      complete: false,
      reason: "history-evicted",
    });
    expect(
      threadWindowCoverage(
        { anchorTurnId: null },
        {
          ...rows,
          liveRows: [{ ...metadata, historyHadTurns: false }],
        },
      ),
    ).toEqual({ complete: true, reason: "complete" });
    expect(
      threadWindowCoverage(
        { anchorTurnId: null },
        {
          ...rows,
          liveRows: [{ ...metadata, historyHadTurns: true }],
        },
      ),
    ).toEqual({ complete: false, reason: "history-evicted" });
  });

  it("rejects an unproven or gapped cached range", () => {
    const metadata = completeResolvedWindow().liveRows[0]!;
    expect(
      threadWindowCoverage(
        { anchorTurnId: null },
        {
          turnRows: [{ ...sealedTurnRow(3), turn: completedTurn("turn-3", "command-3") }],
          liveRows: [
            {
              ...metadata,
              historyCoverageMinOrdinal: undefined,
              historyCoverageMaxOrdinal: undefined,
            },
          ],
        },
      ),
    ).toEqual({ complete: false, reason: "coverage-unproven" });
    expect(
      threadWindowCoverage(
        { anchorTurnId: null },
        {
          turnRows: [
            { ...sealedTurnRow(3), turn: completedTurn("turn-3", "command-3") },
            { ...sealedTurnRow(1), turn: completedTurn("turn-1", "command-1") },
          ],
          liveRows: [{ ...metadata, historyCoverageMinOrdinal: 1, historyCoverageMaxOrdinal: 3 }],
        },
      ),
    ).toEqual({ complete: false, reason: "history-evicted" });
  });

  it("requires authoritative repair while the cached tail still has a mutable turn", () => {
    const cached = completeResolvedWindow();
    const live = liveThread("command-2").turns[0]!;

    expect(
      threadWindowCoverage(
        { anchorTurnId: null },
        {
          turnRows: cached.turnRows,
          liveRows: [...cached.liveRows, mutableTurnRow(live)],
        },
      ),
    ).toEqual({ complete: false, reason: "mutable-head" });
  });

  it("keeps three pages resident and trims only after the gesture without dropping the mutable head", async () => {
    harness.loadResolvedWindow.mockResolvedValue(resolvedWindow(38, 47));
    harness.loadAdjacentWindow.mockImplementation(async ({ boundaryOrdinal, direction }) => {
      if (direction === "older" && boundaryOrdinal === 38)
        return { ...resolvedWindow(33, 37), liveRows: [] };
      if (direction === "older" && boundaryOrdinal === 33)
        return { ...resolvedWindow(28, 32), liveRows: [] };
      if (direction === "newer" && boundaryOrdinal === 42)
        return { ...resolvedWindow(43, 47), liveRows: [] };
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
    expect(before.turnRowIds).toHaveLength(10);
    expect(before.liveRowIds).toEqual([pending.id]);
    const pulled = await details.pullRange("server", "thread", "older");
    const older = details.chat.window$("server", "thread").peek();

    expect(pulled).toBe(true);
    expect(older.status).toBe("ready");
    expect(older.turnRowIds).toHaveLength(15);
    expect(older.liveRowIds).toEqual([pending.id]);
    expect(details.chat.residentRowCount()).toBe(16);
    expect(harness.loadAdjacentWindow.mock.calls[0]?.[0]).toMatchObject({
      boundaryOrdinal: 38,
      direction: "older",
      turnLimit: 5,
    });

    expect(await details.pullRange("server", "thread", "older")).toBe(true);
    const expandedOlder = details.chat.window$("server", "thread").peek();
    expect(expandedOlder.turnRowIds).toHaveLength(20);
    expect(await details.trimRange("server", "thread", "older")).toBe(true);
    const oldest = details.chat.window$("server", "thread").peek();
    expect(oldest.turnRowIds).toHaveLength(15);
    expect(oldest.liveRowIds).toEqual([pending.id]);
    expect(details.chat.residentRowCount()).toBe(16);

    expect(await details.pullRange("server", "thread", "newer")).toBe(true);
    expect(details.chat.window$("server", "thread").peek().turnRowIds).toHaveLength(20);
    expect(await details.trimRange("server", "thread", "newer")).toBe(true);
    const latest = details.chat.window$("server", "thread").peek();
    expect(latest.turnRowIds).toHaveLength(15);
    expect(latest.liveRowIds).toEqual([pending.id]);
    expect(details.chat.residentRowCount()).toBe(16);
    await details.close();
  });

  it("coalesces repeated edge callbacks into one SQLite range pull", async () => {
    let releaseOlder!: () => void;
    const olderRead = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
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

  it("loads a missing newer range from Companion after SQLite reaches its boundary", async () => {
    const first = completedTurn("turn-1", "command-1");
    const second = completedTurn("turn-2", "command-2");
    const third = completedTurn("turn-3", "command-3");
    const initial = completeResolvedWindow();
    initial.turnRows = [
      {
        ...sealedTurnRow(1),
        id: authoritativeTimelineRowId("server", "thread", first),
        turn: first,
      },
    ];
    initial.liveRows = [
      {
        ...initial.liveRows[0]!,
        thread: { ...authoritativeThread("command-1"), turns: [] },
      },
    ];
    harness.loadResolvedWindow.mockResolvedValue(initial);
    harness.loadAdjacentWindow
      .mockResolvedValueOnce({ turnRows: [], detailRows: [], liveRows: [] })
      .mockResolvedValueOnce({
        turnRows: [
          {
            ...sealedTurnRow(3),
            id: authoritativeTimelineRowId("server", "thread", third),
            turn: third,
          },
          {
            ...sealedTurnRow(2),
            id: authoritativeTimelineRowId("server", "thread", second),
            turn: second,
          },
        ],
        detailRows: [],
        liveRows: [],
      });
    const details = createThreadDetailDatabase();
    const loadNewer = vi.fn(
      async ({ afterTurnId, historyEpoch }: { afterTurnId: string; historyEpoch: number }) => {
        const persisted = await details.appendTurnsAfter(
          "server",
          "thread",
          historyEpoch,
          afterTurnId,
          [second, third],
          "source",
          () => true,
          undefined,
        );
        return persisted.accepted
          ? { status: "persisted" as const, lastTurnId: "turn-3", hasMore: false }
          : { status: "superseded" as const };
      },
    );
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => undefined,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer,
    });
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });

    await expect(details.pullRange("server", "thread", "newer")).resolves.toBe(true);
    expect(loadNewer).toHaveBeenCalledWith({
      connectionId: "server",
      threadId: "thread",
      afterTurnId: "turn-1",
      historyEpoch: 0,
    });
    const window = details.chat.window$("server", "thread").peek();
    expect(
      details.chat.readRows(window.turnRowIds).map(({ remoteTurnId }) => remoteTurnId),
    ).toEqual(["turn-3", "turn-2", "turn-1"]);
    await expect(details.pullRange("server", "thread", "newer")).resolves.toBe(false);
    expect(loadNewer).toHaveBeenCalledOnce();
    await details.close();
  });

  it("fills a newer SQLite gap instead of jumping to the retained island", async () => {
    const first = completedTurn("turn-1", "command-1");
    const second = completedTurn("turn-2", "command-2");
    const third = completedTurn("turn-3", "command-3");
    const fourth = completedTurn("turn-4", "command-4");
    const firstRow = {
      ...sealedTurnRow(1),
      id: authoritativeTimelineRowId("server", "thread", first),
      turn: first,
    };
    const fourthRow = {
      ...sealedTurnRow(4),
      id: authoritativeTimelineRowId("server", "thread", fourth),
      turn: fourth,
    };
    const initial = completeResolvedWindow();
    initial.latestSealedOrdinal = 4;
    initial.turnRows = [firstRow];
    initial.liveRows = [
      {
        ...initial.liveRows[0]!,
        historyCoverageMaxOrdinal: 4,
        thread: { ...authoritativeThread("command-1"), turns: [] },
      },
    ];
    harness.loadResolvedWindow.mockResolvedValue(initial);
    harness.loadAdjacentWindow
      .mockResolvedValueOnce({ turnRows: [fourthRow], detailRows: [], liveRows: [] })
      .mockResolvedValueOnce({
        turnRows: [
          fourthRow,
          {
            ...sealedTurnRow(3),
            id: authoritativeTimelineRowId("server", "thread", third),
            turn: third,
          },
          {
            ...sealedTurnRow(2),
            id: authoritativeTimelineRowId("server", "thread", second),
            turn: second,
          },
        ],
        detailRows: [],
        liveRows: [],
      });
    const details = createThreadDetailDatabase();
    const loadNewer = vi.fn(
      async ({ afterTurnId, historyEpoch }: { afterTurnId: string; historyEpoch: number }) => {
        const persisted = await details.appendTurnsAfter(
          "server",
          "thread",
          historyEpoch,
          afterTurnId,
          [second, third, fourth],
          "source",
          () => true,
          undefined,
        );
        return persisted.accepted
          ? { status: "persisted" as const, lastTurnId: "turn-4", hasMore: false }
          : { status: "superseded" as const };
      },
    );
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => undefined,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer,
    });
    await details.prepare();
    await details.loadWindow({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: "turn-1",
    });

    await expect(details.pullRange("server", "thread", "newer")).resolves.toBe(true);
    expect(loadNewer).toHaveBeenCalledOnce();
    const window = details.chat.window$("server", "thread").peek();
    expect(
      details.chat.readRows(window.turnRowIds).map(({ remoteTurnId }) => remoteTurnId),
    ).toEqual(["turn-4", "turn-3", "turn-2", "turn-1"]);
    await details.close();
  });

  it("replaces an expanded historical range with the bounded latest window", async () => {
    harness.loadResolvedWindow
      .mockResolvedValueOnce(resolvedWindow(0, 35))
      .mockResolvedValueOnce(resolvedWindow(12, 47));
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: "turn-12",
    });

    expect(await details.pullRange("server", "thread", "latest")).toBe(true);
    const latest = details.chat.window$("server", "thread").peek();
    const remoteTurnIds = details.chat
      .readRows(latest.turnRowIds)
      .map(({ remoteTurnId }) => remoteTurnId);
    expect(latest.turnRowIds).toHaveLength(15);
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
    const remotePage = Array.from({ length: 12 }, (_, index) =>
      completedTurn(`turn-${12 + index}`, `command-${index}`),
    );
    const result = await details.prependTurns("server", "thread", 0, remotePage, "older-page-2");
    const range = details.chat.window$("server", "thread").peek();

    expect(result).toMatchObject({ accepted: true, extendedMinimum: true });
    expect(range.turnRowIds).toHaveLength(36);
    expect(
      details.chat.readRows(range.turnRowIds).map(({ remoteTurnId }) => remoteTurnId),
    ).toContain("turn-12");
    expect(range.turnRowIds).toContain("turn:server:thread:turn-47");
    expect(harness.persisted.length).toBeGreaterThan(0);
    await details.close();
  });

  it("keeps the selected resource retained while another route load settles", async () => {
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
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

    const firstResource = details.windowResource(request("first"));
    await vi.waitFor(() => expect(harness.loadResolvedWindow).toHaveBeenCalledTimes(1));
    const secondResource = details.windowResource(request("second"));
    const releaseMounted = secondResource.retain(() => undefined);
    releaseFirst();
    await Promise.all([firstResource.ready$.peek(), secondResource.ready$.peek()]);

    expect(harness.loadResolvedWindow.mock.calls.map(([input]) => input.threadId)).toEqual([
      "first",
      "second",
    ]);
    expect(details.chat.window$("server", "second").peek().turnRowIds).toEqual([
      "turn:server:second:turn-1",
    ]);
    expect(details.chat.residentRowCount()).toBe(2);
    releaseMounted();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(details.chat.residentRowCount()).toBe(2);
    expect(details.chat.window$("server", "second").peek().turnRowIds).toEqual([
      "turn:server:second:turn-1",
    ]);
    await details.close();
    expect(details.chat.residentRowCount()).toBe(0);
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

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual([
      "remote-turn",
    ]);
    expect(
      harness.persisted.some((change) => change.type === "delete" && change.key === pending.id),
    ).toBe(false);
    await details.close();
  });

  it("publishes a staged send into the already visible chat before native admission settles", async () => {
    harness.loadResolvedWindow.mockResolvedValue(completeResolvedWindow());
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    const pending = details.createPending({
      attachments: [],
      attempts: 0,
      commandId: "fresh-command",
      connectionId: "server",
      createdAt: 1_000_000,
      lastError: null,
      method: "turn/start",
      presentation: "delivery",
      state: "queued",
      text: "fresh message",
      threadId: "thread",
      updatedAt: 1_000_000,
    });

    const staged = details.stagePendingMutation({ deletes: [], upserts: [pending] });
    const snapshot = details.chat.window$("server", "thread").peek();

    expect(snapshot.liveRowIds).toContain(pending.id);
    expect(details.chat.readRows(snapshot.liveRowIds)).toContain(pending);
    staged.complete();
    await details.close();
  });

  it("keeps the Companion receipt until the authoritative turn takes over its stable key", async () => {
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
      state: "companionAccepted",
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
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({ state: "companionAccepted" }),
      }),
    );

    await details.importThreadSnapshot("server", authoritativeThread("command"), "recovery");

    expect(details.hasPendingDelivery("server", "thread", "command")).toBe(false);
    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual([
      "remote-turn",
    ]);
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

  it("does not reconstruct a bare historical native delivery receipt", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");
    const delivery = {
      connectionId: "server",
      commandId: "accepted-before-sqlite",
      targetCommandId: null,
      method: "turn/start" as const,
      threadId: "thread",
      text: "recover me",
      attachments: [],
      state: "delivered" as const,
      attempts: 1,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_001,
    };

    await details.applyCommandDelivery(delivery);
    expect(details.hasPendingDelivery("server", "thread", delivery.commandId)).toBe(false);

    await details.reconcileNativeCommands("server", "thread", [delivery]);
    expect(details.hasPendingDelivery("server", "thread", delivery.commandId)).toBe(false);
    await details.close();
  });

  it("keeps an edited prompt in the queue after the native edit receipt is delivered", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const queued = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "queued-prompt",
      method: "turn/start",
      presentation: "queue",
      text: "edited prompt",
      attachments: [],
      state: "queued",
      attempts: 0,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_001,
    });
    await details.commitPending(queued);

    await details.applyCommandDelivery({
      connectionId: "server",
      commandId: "queue-edit-receipt",
      targetCommandId: "queued-prompt",
      method: "companion/queue/edit",
      threadId: null,
      text: "edited prompt",
      attachments: [],
      state: "delivered",
      attempts: 1,
      lastError: null,
      createdAt: 1_000_001,
      updatedAt: 1_000_002,
    });

    expect(details.listQueued("server", "thread")).toEqual([
      expect.objectContaining({
        commandId: "queued-prompt",
        state: "queued",
        text: "edited prompt",
      }),
    ]);
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
        updatedAt: 1_000_000,
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
        updatedAt: 1_000_001,
        lastError: null,
      },
    ]);

    expect(details.hasPendingDelivery("server", "thread", "historical-direct")).toBe(false);
    expect(details.listQueued("server", "thread").map(({ commandId }) => commandId)).toEqual([
      "queued-prompt",
    ]);
    await details.close();
  });

  it("hands a delivered explicit queue entry to the optimistic chat projection", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");
    const queued = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "queued-prompt",
      method: "turn/start",
      presentation: "queue",
      text: "next prompt",
      attachments: [],
      state: "queued",
      attempts: 0,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
    await details.commitPending(queued);

    await details.replaceQueued("server", "thread", [
      {
        commandId: "queued-prompt",
        remoteThreadId: "thread",
        params: { threadId: "thread", input: [{ type: "text", text: "next prompt" }] },
        presentation: "queue",
        workspaceRequestId: null,
        state: "delivered",
        order: 1,
        createdAt: 1_000_000,
        updatedAt: 1_000_001,
        lastError: null,
      },
    ]);

    expect(details.listQueued("server", "thread")).toEqual([]);
    // The queue admission command has finished; there is no direct native
    // turn/start receipt for this handoff, but its prompt must remain visible.
    await details.reconcileNativeCommands("server", "thread", []);
    expect(details.hasPendingDelivery("server", "thread", "queued-prompt")).toBe(true);
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({
          commandId: "queued-prompt",
          presentation: "delivery",
          state: "appServerAccepted",
        }),
      }),
    );

    await details.importThreadSnapshot("server", authoritativeThread("queued-prompt"), "recovery");
    expect(details.hasPendingDelivery("server", "thread", "queued-prompt")).toBe(false);
    await details.close();
  });

  it("does not resurrect a historical delivered queue receipt without a local queue row", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");

    await details.replaceQueued("server", "thread", [
      {
        commandId: "restored-queue-prompt",
        remoteThreadId: "thread",
        params: { threadId: "thread", input: [{ type: "text", text: "restored prompt" }] },
        presentation: "queue",
        workspaceRequestId: null,
        state: "delivered",
        order: 1,
        createdAt: 1_000_000,
        updatedAt: 1_000_001,
        lastError: null,
      },
    ]);

    expect(details.listQueued("server", "thread")).toEqual([]);
    expect(details.hasPendingDelivery("server", "thread", "restored-queue-prompt")).toBe(false);
    await details.close();
  });

  it("projects every delivery checkpoint until canonical history takes ownership", async () => {
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

    await details.applyCommandDelivery({
      connectionId: "server",
      commandId: "current-direct",
      targetCommandId: null,
      method: "turn/start",
      threadId: "thread",
      text: "current prompt",
      attachments: [],
      state: "delivered",
      attempts: 1,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_001,
    });
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({
          commandId: "current-direct",
          state: "companionAccepted",
        }),
      }),
    );

    await details.replaceQueued("server", "thread", [
      {
        commandId: "current-direct",
        remoteThreadId: "thread",
        params: { threadId: "thread", input: [{ type: "text", text: "current prompt" }] },
        presentation: "delivery",
        workspaceRequestId: null,
        state: "delivered",
        order: 1,
        createdAt: 1_000_000,
        updatedAt: 1_000_002,
        lastError: null,
      },
    ]);

    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({
          commandId: "current-direct",
          state: "appServerAccepted",
        }),
      }),
    );

    await details.applyCommandDelivery({
      connectionId: "server",
      commandId: "current-direct",
      targetCommandId: null,
      method: "turn/start",
      threadId: "thread",
      text: "current prompt",
      attachments: [],
      state: "delivered",
      attempts: 1,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_003,
    });
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({
          commandId: "current-direct",
          state: "appServerAccepted",
        }),
      }),
    );

    await details.importThreadSnapshot("server", authoritativeThread("current-direct"), "recovery");
    expect(details.hasPendingDelivery("server", "thread", "current-direct")).toBe(false);
    await details.close();
  });

  it("keeps a host rejection and its error after Companion acceptance", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("canonical"), "initial");
    const pending = details.createPending({
      connectionId: "server",
      threadId: "thread",
      commandId: "rejected-direct",
      method: "turn/start",
      presentation: "delivery",
      text: "current prompt",
      attachments: [],
      state: "companionAccepted",
      attempts: 1,
      lastError: null,
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
    await details.commitPending(pending, { durable: true });

    await details.replaceQueued("server", "thread", [
      {
        commandId: "rejected-direct",
        remoteThreadId: "thread",
        params: { threadId: "thread", input: [{ type: "text", text: "current prompt" }] },
        presentation: "delivery",
        workspaceRequestId: null,
        state: "failed",
        order: 1,
        createdAt: 1_000_000,
        updatedAt: 1_000_001,
        lastError: "thread not found",
      },
    ]);

    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).toContainEqual(
      expect.objectContaining({
        kind: "pending",
        pending: expect.objectContaining({ state: "failed", lastError: "thread not found" }),
      }),
    );
    await details.close();
  });

  it.each(["turn/start", "turn/steer"] as const)(
    "keeps a committed %s when a pre-enqueue ledger read arrives before the canonical user item",
    async (method) => {
      const details = createThreadDetailDatabase();
      await details.prepare();
      await details.importThreadSnapshot("server", authoritativeThread("previous"), "initial");
      const pending = details.createPending({
        connectionId: "server",
        threadId: "thread",
        commandId: "new-command",
        method,
        presentation: "delivery",
        text: "New prompt",
        attachments: [],
        state: "queued",
        attempts: 0,
        lastError: null,
        createdAt: 3_000,
        updatedAt: 3_000,
      });
      const staged = details.stagePendingMutation({ upserts: [pending], deletes: [] });
      await details.commitPending(pending, { durable: true });
      staged.complete();

      // listNativeCommands began before enqueue; its empty result arrives after
      // the durable send. Absence from that snapshot is not delivery evidence.
      await details.reconcileNativeCommands("server", "thread", []);
      expect(details.hasPendingDelivery("server", "thread", "new-command")).toBe(true);
      expect(details.chat.row$(pending.id).peek()?.pending?.text).toBe("New prompt");
      const streaming: Turn = {
        ...completedTurn("new-turn", "new-command"),
        status: "inProgress",
        startedAt: 3,
        items: [
          {
            delivery: null,
            questions: null,
            type: "agentMessage",
            id: "answer",
            text: "Working",
            phase: "commentary",
            memoryCitation: null,
          },
        ],
      };
      await details.replaceActiveThread("server", {
        ...authoritativeThread("previous"),
        turns: [streaming],
      });
      expect(details.hasPendingDelivery("server", "thread", "new-command")).toBe(true);
      expect(details.chat.row$(pending.id).peek()?.pending?.text).toBe("New prompt");
      expect(
        details.getThread("server", "thread")?.turns.find((turn) => turn.id === "new-turn")?.items,
      ).toEqual(streaming.items);

      const canonical: Turn = {
        ...streaming,
        items: [
          {
            type: "userMessage",
            id: "user",
            clientId: "new-command",
            content: [{ type: "text", text: "New prompt", text_elements: [] }],
          },
          ...streaming.items,
        ],
      };
      await details.replaceActiveThread("server", {
        ...authoritativeThread("previous"),
        turns: [canonical],
      });
      expect(details.hasPendingDelivery("server", "thread", "new-command")).toBe(false);
      expect(
        details.getThread("server", "thread")?.turns.find((turn) => turn.id === "new-turn")?.items,
      ).toEqual(canonical.items);
      await details.close();
    },
  );

  it("keeps staged and committed sends until canonical handoff, without resurrecting them on reload", async () => {
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

    await details.commitPending(pending, { durable: true });
    optimistic.complete();
    await details.reconcileNativeCommands("server", "thread", []);
    expect(details.hasPendingDelivery("server", "thread", pending.pending!.commandId)).toBe(true);

    await details.importThreadSnapshot(
      "server",
      {
        ...authoritativeThread("canonical"),
        turns: [completedTurn("new-turn", "in-flight")],
      },
      "recovery",
    );
    expect(details.hasPendingDelivery("server", "thread", pending.pending!.commandId)).toBe(false);

    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(
      details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds),
    ).not.toContainEqual(expect.objectContaining({ kind: "pending" }));
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

  it("overlays a complete canonical tail onto a short cached window idempotently", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const tail = Array.from({ length: 15 }, (_, index) =>
      completedTurn(`turn-${index}`, `command-${index}`),
    );
    await details.importThreadSnapshot(
      "server",
      {
        ...authoritativeThread("partial"),
        turns: tail.slice(-4),
      },
      "initial",
      "stale-older-page",
    );
    harness.persisted.length = 0;

    await details.mergeTailTurns("server", "thread", tail, "canonical-older-page");
    await details.mergeTailTurns("server", "thread", tail, "canonical-older-page");

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual(
      tail.map(({ id }) => id),
    );
    expect(details.historyCursor("server", "thread")).toBe("canonical-older-page");
    await expect(
      details.prependTurns("server", "thread", 1, [], "next-older-page"),
    ).resolves.toMatchObject({ accepted: true, historyEpoch: 1 });
    expect(harness.persisted).not.toContainEqual(expect.objectContaining({ type: "delete" }));
    await details.close();
  });

  it("keeps a concurrently projected active turn when a disconnected tail becomes current", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const active = liveThread("active-command").turns[0]!;
    await details.importThreadSnapshot(
      "server",
      {
        ...authoritativeThread("active-command"),
        status: { type: "active", activeFlags: [] },
        turns: [active],
      },
      "initial",
      "stale-page",
    );
    const tail = Array.from({ length: 15 }, (_, index) =>
      completedTurn(`sealed-${index}`, `sealed-command-${index}`),
    );

    await details.mergeTailTurns("server", "thread", tail, "canonical-page");

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual([
      ...tail.map(({ id }) => id),
      active.id,
    ]);
    expect(details.getThread("server", "thread")?.turns.at(-1)).toEqual(active);
    await details.close();
  });

  it("projects consecutive user items into the same active turn", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", liveThread("initial"), "initial");

    const events = [
      { cursor: 1, id: "user-test", clientId: "android-test", text: "Test" },
      { cursor: 2, id: "user-test-2", clientId: "android-test-2", text: "Test2" },
    ].map(({ cursor, id, clientId, text }) => {
      const item = {
        type: "userMessage",
        id,
        clientId,
        content: [{ type: "text", text, text_elements: [] }],
      } as Turn["items"][number];
      return {
        cursor,
        payload: {
          method: "item/completed",
          params: { threadId: "thread", turnId: "remote-turn", item },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "itemUpsert", itemPhase: "completed", turnId: "remote-turn", item },
          },
        },
      };
    });
    const projected = await details.applyEvents("server", events);
    await projected.checkpoint;

    const userItems = details
      .getThread("server", "thread")
      ?.turns[0]?.items.filter((item) => item.type === "userMessage");
    expect(userItems).toEqual([
      expect.objectContaining({ clientId: "initial" }),
      expect.objectContaining({
        clientId: "android-test",
        content: [expect.objectContaining({ text: "Test" })],
      }),
      expect.objectContaining({
        clientId: "android-test-2",
        content: [expect.objectContaining({ text: "Test2" })],
      }),
    ]);
    await details.close();
  });

  it("replaces a missing live item from a cursor-fenced snapshot and skips its covered delta", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", liveThread("initial"), "initial");
    const recoveredAgent = {
      delivery: null,
      questions: null,
      type: "agentMessage",
      id: "recovered-agent",
      text: "recovered",
      phase: null,
      memoryCitation: null,
    } satisfies Turn["items"][number];
    let repaired = false;
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => undefined,
      async repairProjection() {
        const finishSnapshot = details.beginProjectionSnapshot("server", "thread");
        try {
          await details.synchronizeThread({
            connectionId: "server",
            thread: {
              ...liveThread("initial"),
              turns: [
                {
                  ...liveThread("initial").turns[0]!,
                  items: [...liveThread("initial").turns[0]!.items, recoveredAgent],
                },
              ],
            },
            mode: "merge",
            historyCursor: null,
            throughCursor: 1,
            expectedLiveRevision: details.liveRevision("server", "thread"),
          });
        } finally {
          finishSnapshot();
        }
        repaired = true;
      },
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });

    const projected = await details.applyEvents("server", [
      {
        cursor: 1,
        payload: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread",
            turnId: "remote-turn",
            itemId: "recovered-agent",
            delta: " delta",
          },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "itemTextDelta", itemType: "agentMessage" },
          },
        },
      },
    ]);
    await projected.checkpoint;

    expect(repaired).toBe(true);
    expect(details.getThread("server", "thread")?.turns[0]?.items).toContainEqual(
      expect.objectContaining({ id: "recovered-agent", text: "recovered" }),
    );
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({ kind: "thread", projectionCursor: 1 }),
      }),
    );
    expect(harness.commits.at(-1)).toEqual({ durable: true });
    await details.close();
  });

  it("defers projection-gap repair for a background conversation", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", liveThread("initial"), "initial");
    const repairProjection = vi.fn(async () => undefined);
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => undefined,
      shouldRepairProjection: () => false,
      repairProjection,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });

    const projected = await details.applyEvents("server", [
      {
        cursor: 1,
        payload: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread",
            turnId: "remote-turn",
            itemId: "background-agent",
            delta: "new",
          },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "itemTextDelta", itemType: "agentMessage" },
          },
        },
      },
    ]);
    await projected.checkpoint;

    expect(repairProjection).not.toHaveBeenCalled();
    expect(details.getThread("server", "thread")?.turns[0]?.items).not.toContainEqual(
      expect.objectContaining({ id: "background-agent" }),
    );
    await details.close();
  });

  it("holds the event tail until the cursor-fenced thread snapshot is durable", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", liveThread("initial"), "initial");
    const tailItem = {
      delivery: null,
      questions: null,
      type: "agentMessage",
      id: "tail-agent",
      text: "after snapshot",
      phase: null,
      memoryCitation: null,
    } satisfies Turn["items"][number];
    const finishSnapshot = details.beginProjectionSnapshot("server", "thread");
    const pendingProjection = details.applyEvents("server", [
      {
        cursor: 2,
        payload: {
          method: "item/completed",
          params: { threadId: "thread", turnId: "remote-turn", item: tailItem },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: {
              kind: "itemUpsert",
              itemPhase: "completed",
              turnId: "remote-turn",
              item: tailItem,
            },
          },
        },
      },
    ]);

    await Promise.resolve();
    expect(details.getThread("server", "thread")?.turns[0]?.items).not.toContainEqual(
      expect.objectContaining({ id: "tail-agent" }),
    );
    await details.synchronizeThread({
      connectionId: "server",
      thread: liveThread("initial"),
      mode: "merge",
      historyCursor: null,
      throughCursor: 1,
      expectedLiveRevision: details.liveRevision("server", "thread"),
    });
    finishSnapshot();
    const projected = await pendingProjection;
    await projected.checkpoint;

    expect(details.getThread("server", "thread")?.turns[0]?.items).toContainEqual(
      expect.objectContaining({ id: "tail-agent", text: "after snapshot" }),
    );
    await details.close();
  });

  it("keeps sealed content metadata and ordinal as one immutable fact family", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const stable = {
      ...completedTurn("remote-turn", "command"),
      codewide: { diff: "stable" },
    } as Turn;
    await details.importThreadSnapshot(
      "server",
      {
        ...authoritativeThread("command"),
        turns: [stable],
      },
      "initial",
    );

    const conflicting = {
      ...completedTurn("remote-turn", "command"),
      codewide: { diff: "replacement" },
    } as Turn;
    await details.appendTurns("server", "thread", [conflicting]);

    expect(
      (details.getThread("server", "thread")!.turns[0] as Turn & { codewide?: { diff?: string } })
        .codewide?.diff,
    ).toBe("stable");
    await details.close();
  });

  it("keeps live tool activity across summary sealing and SQLite rematerialization", async () => {
    const user = {
      type: "userMessage",
      id: "remote-turn-user",
      clientId: "command",
      content: [],
    } as Turn["items"][number];
    const tool = {
      type: "commandExecution",
      id: "remote-turn-tool",
      command: "pnpm test",
      status: "completed",
    } as Turn["items"][number];
    const final = {
      type: "agentMessage",
      id: "remote-turn-agent",
      text: "done",
      phase: "final_answer",
    } as Turn["items"][number];
    const live = {
      ...completedTurn("remote-turn", "command"),
      itemsView: "full",
      status: "inProgress",
      completedAt: null,
      items: [user, tool],
    } as Turn;
    const summary = {
      ...completedTurn("remote-turn", "command"),
      itemsView: "summary",
      items: [user, final],
    } as Turn;
    const details = createThreadDetailDatabase();
    await details.prepare();
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => undefined,
      repairProjection: async () => undefined,
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.importThreadSnapshot(
      "server",
      {
        ...authoritativeThread("command"),
        status: { type: "active", activeFlags: [] },
        turns: [live],
      },
      "initial",
    );

    expect(details.getThread("server", "thread")?.turns[0]?.items.map(({ id }) => id)).toEqual([
      "remote-turn-user",
      "remote-turn-tool",
    ]);

    const completedFull = {
      ...live,
      status: "completed",
      completedAt: 2,
      items: [user, tool, final],
    } as Turn;
    const projected = await details.applyEvents("server", [
      {
        cursor: 1,
        payload: {
          method: "turn/completed",
          params: { threadId: "thread", turn: completedFull },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "turnCompleted", turn: completedFull },
          },
        },
      },
    ]);
    await projected.checkpoint;

    expect(details.getThread("server", "thread")?.turns[0]).toMatchObject({
      itemsView: "full",
      items: expect.arrayContaining([expect.objectContaining({ id: "remote-turn-tool" })]),
    });
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: "turn",
          remoteTurnId: "remote-turn",
          sealed: false,
          turn: expect.objectContaining({
            itemsView: "full",
            items: expect.arrayContaining([expect.objectContaining({ id: "remote-turn-tool" })]),
          }),
        }),
      }),
    );

    await details.appendTurns("server", "thread", [summary]);

    expect(details.getThread("server", "thread")?.turns[0]).toMatchObject({
      itemsView: "full",
      items: expect.arrayContaining([expect.objectContaining({ id: "remote-turn-tool" })]),
    });
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: "activity",
          remoteTurnId: "remote-turn",
          sealed: true,
          activityItems: expect.arrayContaining([
            expect.objectContaining({ id: "remote-turn-tool" }),
          ]),
        }),
      }),
    );
    await details.close();
  });

  it("repairs a sparse completion authoritatively before acknowledging it", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const sparse = sparseCompletedTurn("remote-turn", "command");
    const repaired = completedTurn("remote-turn", "command");
    details.setRemoteLoader({
      reconcilePending: async () => undefined,
      hydrateWindow: async () => undefined,
      async repairProjection() {
        const finishSnapshot = details.beginProjectionSnapshot("server", "thread");
        try {
          await details.synchronizeThread({
            connectionId: "server",
            thread: { ...authoritativeThread("command"), turns: [repaired] },
            mode: "merge",
            historyCursor: null,
            throughCursor: 1,
            expectedLiveRevision: details.liveRevision("server", "thread"),
          });
        } finally {
          finishSnapshot();
        }
      },
      loadOlder: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
    });
    await details.importThreadSnapshot("server", liveThread("command"), "initial");
    const projected = await details.applyEvents("server", [
      {
        cursor: 1,
        payload: {
          method: "turn/completed",
          params: { threadId: "thread", turn: sparse },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "turnCompleted", turn: sparse },
          },
        },
      },
    ]);
    await projected.checkpoint;

    expect(details.getThread("server", "thread")?.turns).toEqual([repaired]);
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({ kind: "turn", remoteTurnId: "remote-turn", sealed: true }),
      }),
    );
    await details.close();
  });

  it("keeps a metadata-only turn local to Conversation until complete history repairs it", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const incomplete = {
      id: "remote-turn",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1_000,
      itemsView: "notLoaded",
    } as unknown as Turn;

    await expect(
      details.importThreadSnapshot(
        "server",
        {
          ...authoritativeThread("command"),
          turns: [incomplete],
        },
        "recovery",
      ),
    ).resolves.toBeUndefined();

    expect(details.getThread("server", "thread")?.turns).toEqual([
      {
        ...incomplete,
        items: [],
      },
    ]);
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: "turn",
          remoteTurnId: "remote-turn",
          sealed: false,
          turn: expect.objectContaining({ items: [], itemsView: "notLoaded" }),
        }),
      }),
    );

    const repaired = completedTurn("remote-turn", "command");
    await details.appendTurns("server", "thread", [repaired]);

    expect(details.getThread("server", "thread")?.turns).toEqual([repaired]);
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({ kind: "turn", remoteTurnId: "remote-turn", sealed: true }),
      }),
    );
    await details.close();
  });

  it("keeps a materialized not-loaded history turn mutable until complete history repairs it", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const incomplete = {
      ...completedTurn("remote-turn", "command"),
      items: [],
      itemsView: "notLoaded",
    } satisfies Turn;

    await expect(
      details.importThreadSnapshot(
        "server",
        {
          ...authoritativeThread("command"),
          turns: [incomplete],
        },
        "recovery",
      ),
    ).resolves.toBeUndefined();

    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: "turn",
          remoteTurnId: "remote-turn",
          sealed: false,
          turn: incomplete,
        }),
      }),
    );

    const repaired = completedTurn("remote-turn", "command");
    await details.appendTurns("server", "thread", [repaired]);

    expect(details.getThread("server", "thread")?.turns).toEqual([repaired]);
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({ kind: "turn", remoteTurnId: "remote-turn", sealed: true }),
      }),
    );
    await details.close();
  });

  it("keeps resident items when a reconnect refresh carries materialized turn metadata", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const complete = authoritativeThread("command");
    await details.importThreadSnapshot("server", complete, "initial");
    const incomplete = {
      ...complete.turns[0]!,
      items: [],
      itemsView: "notLoaded",
    } satisfies Turn;

    await expect(
      details.importThreadSnapshot(
        "server",
        {
          ...complete,
          turns: [incomplete],
        },
        "reconnect",
      ),
    ).resolves.toBeUndefined();

    expect(details.getThread("server", "thread")?.turns[0]?.items).toEqual(
      complete.turns[0]?.items,
    );
    await details.close();
  });

  it("keeps the active projection when a catalog snapshot updates metadata", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", liveThread("command"), "initial");

    await details.applySnapshot(
      "server",
      [
        {
          thread: { ...authoritativeThread("command"), name: "Renamed", turns: [] },
          archived: false,
        },
      ],
      17,
    );

    expect(details.getThread("server", "thread")).toMatchObject({
      name: "Renamed",
      status: { type: "active" },
    });
    expect(details.getThread("server", "thread")?.turns).toEqual(liveThread("command").turns);
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: "turn",
          remoteTurnId: "remote-turn",
          sealed: false,
        }),
      }),
    );

    const repaired = completedTurn("remote-turn", "command");
    await details.appendTurns("server", "thread", [repaired]);

    expect(details.getThread("server", "thread")?.turns).toEqual([repaired]);
    await details.close();
  });

  it("does not acknowledge live projection updates before their durable SQLite commit", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot(
      "server",
      authoritativeThread("command"),
      "initial",
      "older",
    );

    harness.commits.length = 0;
    const semanticBoundary = await details.applyEvents("server", [
      {
        cursor: 1,
        payload: {
          method: "diagnostic/not-a-boundary",
          params: { threadId: "thread", status: { type: "active", activeFlags: [] } },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "threadStatus", status: { type: "active", activeFlags: [] } },
          },
        },
      },
    ]);
    await semanticBoundary.checkpoint;
    expect(harness.commits).toEqual([{ durable: true }]);

    harness.commits.length = 0;
    const rawBoundary = await details.applyEvents("server", [
      {
        cursor: 2,
        payload: {
          method: "thread/status/changed",
          params: { threadId: "thread", threadName: "Raw method is irrelevant" },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "threadName", threadName: "Raw method is irrelevant" },
          },
        },
      },
    ]);
    await rawBoundary.checkpoint;
    expect(harness.commits).toEqual([{ durable: true }]);
    await details.close();
  });

  it("persists the authoritative active turn before exposing it as recovered", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("sealed"), "initial");
    harness.commits.length = 0;

    const live = liveThread("streaming");
    const active: Thread = {
      ...live,
      turns: live.turns.map((turn) => ({ ...turn, id: "active-turn" })),
    };
    await details.replaceActiveThread("server", active);

    expect(details.getThread("server", "thread")?.status).toEqual(active.status);
    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual([
      "remote-turn",
      "active-turn",
    ]);
    expect(harness.commits).toEqual([{ durable: true }]);
    await details.close();
  });

  it("commits sealed history and the active head atomically without overwriting a concurrent live patch", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const active = {
      ...liveThread("streaming").turns[0]!,
      id: "active-turn",
    } satisfies Turn;
    const stale = {
      ...authoritativeThread("sealed"),
      status: { type: "active", activeFlags: [] },
      turns: [completedTurn("sealed-turn", "sealed"), active],
    } satisfies Thread;
    await details.importThreadSnapshot("server", stale, "initial", "older");
    const revision = details.liveRevision("server", "thread");
    const item = {
      type: "agentMessage",
      id: "streamed-agent",
      text: "newer live text",
      phase: null,
    } as Turn["items"][number];

    const projected = await details.applyEvents("server", [
      {
        cursor: 1,
        payload: {
          method: "item/completed",
          params: { threadId: "thread", turnId: "active-turn", item },
          codewideThreadPatch: {
            version: 1,
            threadId: "thread",
            operation: { kind: "itemUpsert", itemPhase: "completed", turnId: "active-turn", item },
          },
        },
      },
    ]);
    await projected.checkpoint;
    harness.commits.length = 0;

    await details.synchronizeThread({
      connectionId: "server",
      thread: stale,
      mode: "merge",
      historyCursor: "older",
      throughCursor: 1,
      expectedLiveRevision: revision,
    });

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual([
      "sealed-turn",
      "active-turn",
    ]);
    expect(details.getThread("server", "thread")?.turns[1]?.items).toContainEqual(
      expect.objectContaining({ id: "streamed-agent", text: "newer live text" }),
    );
    expect(harness.commits).toHaveLength(1);
    await details.close();
  });

  it("replaces a disconnected sealed history when the server returns reset", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot(
      "server",
      authoritativeThread("stale"),
      "initial",
      "stale-older",
    );
    const replacement: Thread = {
      ...authoritativeThread("fresh"),
      turns: [completedTurn("fresh-turn", "fresh")],
    };
    const commitsBeforeReset = harness.commits.length;

    await details.replaceThreadSnapshot("server", replacement, "recovery", "fresh-older");

    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual([
      "fresh-turn",
    ]);
    expect(details.historyCursor("server", "thread")).toBe("fresh-older");
    expect(harness.commits).toHaveLength(commitsBeforeReset + 1);
    await details.close();
  });

  it("repairs sealed messages in the same turn after a projection reset", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", authoritativeThread("prompt-client"), "initial", null);
    const correctedTurn: Turn = {
      ...completedTurn("remote-turn", "prompt-client"),
      itemsView: "summary",
      items: [
        { type: "userMessage", id: "prompt", clientId: "prompt-client", content: [{ type: "text", text: "Original question", text_elements: [] }] },
        { type: "userMessage", id: "reply", clientId: "reply-client", content: [{ type: "text", text: "Reply with logs", text_elements: [] }] },
      ],
    };
    await details.synchronizeThread({
      connectionId: "server",
      thread: { ...authoritativeThread("prompt-client"), turns: [correctedTurn] },
      mode: "reset",
      historyCursor: null,
      throughCursor: 1,
      expectedLiveRevision: details.liveRevision("server", "thread"),
    });

    const repaired = details.getThread("server", "thread");
    expect(repaired?.turns.map(({ id }) => id)).toEqual(["remote-turn"]);
    expect(repaired?.turns[0]?.items).toEqual(correctedTurn.items);
    await details.close();
  });

  it("rolls back the complete server reset when its atomic write fails", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const stale = authoritativeThread("stale");
    await details.importThreadSnapshot("server", stale, "initial", "stale-older");
    const replacement: Thread = {
      ...authoritativeThread("fresh"),
      turns: [completedTurn("fresh-turn", "fresh")],
    };
    harness.failNextWrite = true;

    await expect(
      details.replaceThreadSnapshot("server", replacement, "recovery", "fresh-older"),
    ).rejects.toThrow("simulated projection failure");

    expect(details.getThread("server", "thread")?.turns).toEqual(stale.turns);
    expect(details.historyCursor("server", "thread")).toBe("stale-older");
    await details.close();
  });

  it("persists the older-history cursor with the durable thread epoch", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot(
      "server",
      authoritativeThread("first"),
      "initial",
      "older-1",
    );

    expect(details.historyCursor("server", "thread")).toBe("older-1");
    expect(harness.persisted).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({ kind: "thread", historyHadTurns: true }),
      }),
    );
    await details.appendTurns(
      "server",
      "thread",
      [completedTurn("second", "second")],
      "tail-refresh",
    );
    expect(details.historyCursor("server", "thread")).toBe("older-1");

    await details.prependTurns("server", "thread", 0, [], "older-2");
    expect(details.historyCursor("server", "thread")).toBe("older-2");
    expect(harness.persisted.some((change) => change.value?.historyCursor === "older-2")).toBe(
      true,
    );
    await details.close();
  });

  it("keeps an unknown history cursor unknown across a current snapshot", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const current = authoritativeThread("current");
    await details.importThreadSnapshot("server", current, "initial");

    await details.synchronizeThread({
      connectionId: "server",
      thread: current,
      mode: "merge",
      historyCursor: undefined,
      throughCursor: 1,
      expectedLiveRevision: details.liveRevision("server", "thread"),
    });

    expect(details.historyCursor("server", "thread")).toBeUndefined();
    await details.close();
  });

  it("persists direct delivery after Kotlin durably accepts it", async () => {
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
