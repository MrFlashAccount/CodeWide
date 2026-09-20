import { describe, expect, it, vi } from "vitest";

import {
  createThreadChatModel,
  threadChatRequestKey,
  threadChatScope,
  type LoadedThreadChatWindow,
  type ThreadChatWindowRequest,
} from "../src/data/thread-chat-model";
import type { ThreadDetailRow } from "../src/data/thread-detail-projection";

const request: ThreadChatWindowRequest = {
  connectionId: "connection",
  threadId: "thread",
  anchorTurnId: null,
};

function row(
  id: string,
  ordinal: number,
  overrides: Partial<ThreadDetailRow> = {},
): ThreadDetailRow {
  return {
    id,
    kind: "turn",
    connectionId: "connection",
    remoteThreadId: "thread",
    remoteTurnId: id,
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
    ...overrides,
  };
}

function loaded(
  rows: readonly ThreadDetailRow[],
  loadedRequest: ThreadChatWindowRequest = request,
): LoadedThreadChatWindow {
  return {
    scope: threadChatScope(loadedRequest.connectionId, loadedRequest.threadId),
    requestKey: threadChatRequestKey(loadedRequest),
    historyEpoch: 0,
    latestSealedOrdinal: 2,
    earliestSealedOrdinal: 0,
    residentTurnLimit: 24,
    turnRowIds: rows.filter(({ kind }) => kind === "turn").map(({ id }) => id),
    detailRowIds: [],
    liveRowIds: [],
    rows,
  };
}

describe("Legend thread chat model", () => {
  it("preserves an expanded latest range across a page metadata refresh without importing lookup islands", () => {
    const model = createThreadChatModel();
    const resident = Array.from({ length: 20 }, (_, index) =>
      row(`turn-${40 - index}`, 40 - index),
    );
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, {
      ...loaded(resident),
      latestSealedOrdinal: 40,
      residentTurnLimit: 15,
    });
    const before = model.window$("connection", "thread").peek();
    model.refreshThread("connection", "thread", [
      row("far-newer", 100),
      ...resident,
      row("older-page", 20),
    ]);
    const after = model.window$("connection", "thread").peek();
    expect(after.turnRowIds).toEqual(before.turnRowIds);
    expect(after.turnRowIds).toHaveLength(20);
    expect(after.latestSealedOrdinal).toBe(100);
  });

  it("bounds rolling live completions at the committed expanded capacity", () => {
    const model = createThreadChatModel();
    let resident = Array.from({ length: 20 }, (_, index) => row(`turn-${40 - index}`, 40 - index));
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, {
      ...loaded(resident),
      latestSealedOrdinal: 40,
      residentTurnLimit: 15,
    });
    for (let ordinal = 41; ordinal <= 65; ordinal += 1) {
      model.refreshThread("connection", "thread", [row(`turn-${ordinal}`, ordinal), ...resident]);
      const snapshot = model.window$("connection", "thread").peek();
      resident = model.readRows(snapshot.turnRowIds);
      expect(resident).toHaveLength(20);
      expect(resident[0]?.ordinal).toBe(ordinal);
    }
    expect(resident.at(-1)?.ordinal).toBe(46);
  });

  it("does not jump a historical range to a distant live completion", () => {
    const model = createThreadChatModel();
    const resident = [row("old-2", 2), row("old-1", 1)];
    const live = row("live", 101, { sealed: false });
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, {
      ...loaded(resident),
      latestSealedOrdinal: 100,
      liveRowIds: [live.id],
      rows: [...resident, live],
    });
    model.refreshThread("connection", "thread", [...resident, { ...live, sealed: true }]);
    expect(model.window$("connection", "thread").peek().turnRowIds).toEqual(["old-2", "old-1"]);
  });

  it("bounds a replacement epoch independently of the previous expanded range", () => {
    const model = createThreadChatModel();
    const oldRows = Array.from({ length: 20 }, (_, index) => row(`old-${index}`, index));
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, {
      ...loaded(oldRows),
      latestSealedOrdinal: 19,
      residentTurnLimit: 15,
    });
    const nextRows = Array.from({ length: 30 }, (_, index) =>
      row(`new-${index}`, index, { historyEpoch: 1 }),
    );
    model.refreshThread("connection", "thread", [
      row("meta", 0, { kind: "thread", sealed: false, historyEpoch: 1 }),
      ...nextRows,
    ]);
    const next = model.window$("connection", "thread").peek();
    expect(next.historyEpoch).toBe(1);
    expect(next.turnRowIds).toHaveLength(15);
    expect(model.readRows(next.turnRowIds).map((turn) => turn.ordinal)).toEqual(
      Array.from({ length: 15 }, (_, index) => 29 - index),
    );
  });

  it("reveals a cached live chat while a neighbouring range refresh is still blocked", async () => {
    const model = createThreadChatModel();
    const first = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, {
        ...loaded([]),
        rows: [row("live", 1, { sealed: false })],
        liveRowIds: ["live"],
      });
    });
    await first.ready$.peek();
    const other = { ...request, threadId: "other" };
    await model
      .resource(other, async () => {
        const generation = model.startWindow(other);
        model.commitWindow(other, generation, loaded([], other));
      })
      .ready$.peek();
    const reopened = { ...request, anchorTurnId: "live" };
    const refresh = Promise.withResolvers<void>();
    const result = model.resource(reopened, async () => {
      const generation = model.startWindow(reopened);
      await refresh.promise;
      model.commitWindow(reopened, generation, loaded([row("live", 1)], reopened));
    });
    expect(result.window$).toBe(first.window$);
    expect(model.readRows(result.window$.peek().liveRowIds).map((item) => item.id)).toEqual([
      "live",
    ]);
    await Promise.resolve();
    expect(result.window$.peek().status).toBe("loading-history");
    refresh.resolve();
    await vi.waitFor(() => expect(result.window$.peek().turnRowIds).toEqual(["live"]));
    model.close();
  });

  it("evicts the least recently selected inactive window, not the one receiving events", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (_connectionId, threadId) => {
        evicted.push(threadId);
      },
    });
    async function open(threadId: string, anchorTurnId: string | null = null) {
      const target = { ...request, anchorTurnId, threadId };
      const resource = model.resource(target, async () => {
        const generation = model.startWindow(target);
        model.commitWindow(
          target,
          generation,
          loaded([row(threadId, 1, { remoteThreadId: threadId })], target),
        );
      });
      await resource.ready$.peek();
      return resource;
    }
    await open("a");
    await open("b");
    await open("c");
    await open("d");
    expect(evicted).toEqual([]);
    await open("a", "a");
    model.refreshThread("connection", "b", [row("b", 2, { remoteThreadId: "b" })]);
    const background = model.window$("connection", "b").peek();
    expect(model.readRows(background.turnRowIds)[0]?.ordinal).toBe(2);
    await open("e");
    expect(evicted).toEqual(["b"]);
    expect(model.residentRowCount()).toBe(4);
    model.close();
    expect(model.residentRowCount()).toBe(0);
  });

  it("keeps cached messages readable when neighbouring-range validation fails", async () => {
    const model = createThreadChatModel();
    const initial = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("cached", 1)]));
    });
    await initial.ready$.peek();
    const other = { ...request, threadId: "other" };
    await model
      .resource(other, async () => {
        const generation = model.startWindow(other);
        model.commitWindow(other, generation, loaded([], other));
      })
      .ready$.peek();
    const reopened = { ...request, anchorTurnId: "cached" };
    const result = model.resource(reopened, async () => {
      const generation = model.startWindow(reopened);
      const error = new Error("offline");
      model.failWindow(reopened, generation, error);
      throw error;
    });
    await vi.waitFor(() => expect(result.window$.peek().status).toBe("background-retrying"));
    expect(result.window$.peek().error).toBe("offline");
    expect(model.readRows(result.window$.peek().turnRowIds).map((item) => item.id)).toEqual([
      "cached",
    ]);
    model.close();
  });

  it("publishes hydrated messages after an empty cache without waiting for a nonexistent first draw", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded([]));
    model.commitWindow(request, generation, loaded([row("hydrated", 1)]));
    expect(
      model
        .readRows(model.window$(request.connectionId, request.threadId).peek().turnRowIds)
        .map((value) => value.id),
    ).toEqual(["hydrated"]);
    model.close();
  });

  it("replaces a reopened empty cache as soon as hydrated rows arrive", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded([]));
    model.commitWindow(request, generation, loaded([row("hydrated", 1)]));
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual([
      "hydrated",
    ]);
    model.close();
  });

  it("owns window retention through the render resource subscription", async () => {
    const releaseObservation = vi.fn();
    const onRetainWindow = vi.fn(() => releaseObservation);
    const model = createThreadChatModel({ onRetainWindow });
    const resource = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("turn", 1)]));
    });
    const release = resource.retain(() => undefined);

    await resource.ready$.peek();
    expect(onRetainWindow).toHaveBeenCalledWith("connection", "thread");
    release();
    expect(releaseObservation).toHaveBeenCalledOnce();
    model.close();
  });
  it("retains the previous window as data when another destination takes ownership", async () => {
    const model = createThreadChatModel();
    const resource = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("turn-1", 1)]));
    });
    await resource.ready$.peek();
    expect(model.residentRowCount()).toBe(1);
    const next = { ...request, threadId: "next" };
    const nextResource = model.resource(next, async () => {
      const generation = model.startWindow(next);
      model.commitWindow(next, generation, loaded([], next));
    });
    await nextResource.ready$.peek();
    expect(model.residentRowCount()).toBe(1);
    expect(model.readRows(resource.window$.peek().turnRowIds).map((item) => item.id)).toEqual([
      "turn-1",
    ]);
    expect(nextResource.window$.peek().status).toBe("ready");
    model.close();
  });
  it("does not mistake an older committed window for a completed range request", async () => {
    const model = createThreadChatModel();
    const initial = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("cached", 1)]));
    });
    await initial.ready$.peek();
    const next = { ...request, anchorTurnId: "cached" };
    const interrupted = Promise.withResolvers<void>();
    model.resource(next, async () => {
      model.startWindow(next);
      await interrupted.promise;
      // A cancelled load returns without committing, even with a cached window.
    });
    interrupted.resolve();
    await vi.waitFor(() => {
      const selected = model.resource(next, async () => {
        const generation = model.startWindow(next);
        model.commitWindow(next, generation, loaded([row("cached", 1), row("fresh", 2)], next));
      });
      expect(model.readRows(selected.window$.peek().turnRowIds).map((value) => value.id)).toEqual([
        "cached",
        "fresh",
      ]);
    });
    model.close();
  });
  it("keeps the current route resource live across a transient owner release", async () => {
    const model = createThreadChatModel();
    const release = model.retainWindow(request.connectionId, request.threadId);
    const resource = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, {
        ...loaded([row("turn-1", 1)]),
        latestSealedOrdinal: 1,
      });
    });
    await resource.ready$.peek();
    const window = resource.window$;
    release();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const optimistic = row("client-1", 2, {
      kind: "pending",
      remoteTurnId: null,
      sealed: false,
      pending: {
        attachments: [],
        attempts: 0,
        commandId: "client-1",
        createdAt: 2,
        lastError: null,
        method: "turn/start",
        presentation: "delivery",
        state: "queued",
        text: "voice message",
        updatedAt: 2,
      },
    });
    model.publishChanges([{ type: "insert", value: optimistic }]);
    model.refreshThread(request.connectionId, request.threadId, [row("turn-1", 1), optimistic]);

    expect(resource.window$.peek().liveRowIds).toContain("client-1");
    expect(model.readRows(resource.window$.peek().liveRowIds)).toContain(optimistic);

    const serverTurn = row("turn-2", 2);
    model.publishChanges([
      { key: optimistic.id, type: "delete" },
      { type: "insert", value: serverTurn },
    ]);
    model.refreshThread(request.connectionId, request.threadId, [row("turn-1", 1), serverTurn]);

    expect(resource.window$).toBe(window);
    expect(resource.window$.peek().liveRowIds).not.toContain("client-1");
    expect(model.readRows(resource.window$.peek().turnRowIds)).toContain(serverTurn);
    model.close();
    expect(model.residentRowCount()).toBe(0);
  });
  it("owns and deduplicates the initial SQLite window Promise", async () => {
    const model = createThreadChatModel();
    let loads = 0;
    const resource = model.resource(request, async () => {
      loads += 1;
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("turn-1", 1)]));
    });
    const same = model.resource(request, async () => {
      loads += 1;
    });

    await resource.ready$.peek();

    expect(same.ready$).toBe(resource.ready$);
    expect(loads).toBe(1);
    expect(resource.window$.peek().turnRowIds).toEqual(["turn-1"]);
  });

  it("keeps the backend refresh indicator until every overlapping recovery settles", () => {
    const model = createThreadChatModel();
    model.startWindow(request);
    const finishFirst = model.beginBackendRefresh(request.connectionId, request.threadId);
    expect(model.window$(request.connectionId, request.threadId).peek().backendRefreshing).toBe(
      true,
    );

    model.startWindow(request);
    const finishSecond = model.beginBackendRefresh(request.connectionId, request.threadId);
    finishFirst();
    expect(model.window$(request.connectionId, request.threadId).peek().backendRefreshing).toBe(
      true,
    );

    finishSecond();
    expect(model.window$(request.connectionId, request.threadId).peek().backendRefreshing).toBe(
      false,
    );
    model.close();
  });

  it("publishes a neighbouring range without creating another resource", async () => {
    const model = createThreadChatModel();
    const initial = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("turn-2", 2)]));
    });
    await initial.ready$.peek();
    const before = model.window$(request.connectionId, request.threadId).peek();
    expect(
      model.commitRange(
        request.connectionId,
        request.threadId,
        {
          historyEpoch: before.historyEpoch,
          layoutRevision: before.layoutRevision,
        },
        loaded([row("turn-1", 1)]),
      ),
    ).toBe(true);

    expect(model.resource(request, async () => undefined).ready$).toBe(initial.ready$);
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual([
      "turn-1",
    ]);
  });

  it("replaces window membership atomically and keeps the window ready", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const firstGeneration = model.startWindow(request);
    expect(model.commitWindow(request, firstGeneration, loaded(rows))).toBe(true);
    const before = model.window$(request.connectionId, request.threadId).peek();
    expect(
      model.commitRange(
        request.connectionId,
        request.threadId,
        before,
        loaded([row("turn-0", 0), row("turn-1", 1)]),
      ),
    ).toBe(true);
    const pulled = model.window$(request.connectionId, request.threadId).peek();
    expect(pulled.status).toBe("ready");
    expect(pulled.turnRowIds).toEqual(["turn-0", "turn-1"]);
  });

  it("keeps the initial semantic anchor in one stable resource key", async () => {
    const model = createThreadChatModel();
    const anchorRequest = { ...request, anchorTurnId: "turn-1" };
    let loads = 0;
    const initial = model.resource(anchorRequest, async () => {
      loads += 1;
      const generation = model.startWindow(anchorRequest);
      model.commitWindow(anchorRequest, generation, loaded([row("turn-1", 1)], anchorRequest));
    });
    await initial.ready$.peek();

    const resolved = model.resource(anchorRequest, async () => {
      loads += 1;
    });

    expect(resolved.ready$).toBe(initial.ready$);
    expect(loads).toBe(1);
    expect(model.window$(request.connectionId, request.threadId).peek()).toMatchObject({
      requestKey: threadChatRequestKey(anchorRequest),
      status: "ready",
    });
  });

  it("keeps an initial load failure stable until a different range is requested", async () => {
    const model = createThreadChatModel();
    const failedLoader = vi.fn(async () => {
      throw new Error("cold load failed");
    });
    const initial = model.resource(request, failedLoader);
    const initialPromise = initial.ready$.peek();

    await expect(initialPromise).rejects.toThrow("cold load failed");
    const repeatedRender = model.resource(request, failedLoader);
    expect(repeatedRender.ready$).toBe(initial.ready$);
    expect(failedLoader).toHaveBeenCalledTimes(1);

    const reopenedRequest = { ...request, anchorTurnId: "retry-anchor" };
    const reopenedLoader = vi.fn(async () => {
      const generation = model.startWindow(reopenedRequest);
      model.commitWindow(reopenedRequest, generation, loaded([], reopenedRequest));
    });
    const reopened = model.resource(reopenedRequest, reopenedLoader);
    const reopenedPromise = reopened.ready$.peek();
    await expect(reopenedPromise).resolves.toBe(true);
    expect(Object.is(reopenedPromise, initialPromise)).toBe(false);
    expect(reopenedLoader).toHaveBeenCalledTimes(1);
  });

  it("structurally shares an equivalent SQLite revalidation", () => {
    const model = createThreadChatModel();
    const rows = [
      row("turn-1", 1, {
        turnMetadata: { tokenUsage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2 } },
      }),
    ];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(rows));
    const previousSnapshot = model.window$(request.connectionId, request.threadId).peek();
    const previousRow = model.readRows(previousSnapshot.turnRowIds)[0];

    const clonedRows = structuredClone(rows);
    model.publishChanges([{ type: "update", value: clonedRows[0] }]);
    model.refreshThread(request.connectionId, request.threadId, clonedRows);
    const nextSnapshot = model.window$(request.connectionId, request.threadId).peek();

    expect(nextSnapshot).toBe(previousSnapshot);
    expect(nextSnapshot.turnRowIds).toBe(previousSnapshot.turnRowIds);
    expect(model.readRows(nextSnapshot.turnRowIds)[0]).toBe(previousRow);
    expect("rows" in nextSnapshot).toBe(false);
  });

  it("replaces only the changed row during revalidation", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-2", 2), row("turn-1", 1)];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(rows));
    const previousSnapshot = model.window$(request.connectionId, request.threadId).peek();
    const [previousFirst, previousSecond] = model.readRows(previousSnapshot.turnRowIds);
    const nextRows = structuredClone(rows);
    nextRows[0] = { ...nextRows[0], lastOpenedAt: 10 };

    model.refreshThread(request.connectionId, request.threadId, nextRows);
    const nextSnapshot = model.window$(request.connectionId, request.threadId).peek();
    const [nextFirst, nextSecond] = model.readRows(nextSnapshot.turnRowIds);

    expect(nextSnapshot.revision).toBe(previousSnapshot.revision + 1);
    expect(nextSnapshot.turnRowIds).toBe(previousSnapshot.turnRowIds);
    expect(nextFirst).not.toBe(previousFirst);
    expect(nextSecond).toBe(previousSecond);
  });

  it("publishes navigation repair and later live rows immediately", () => {
    const model = createThreadChatModel();
    const initialRows = [row("turn-1", 1)];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(initialRows));
    const initialSnapshot = model.window$(request.connectionId, request.threadId).peek();

    const repairedRows = [row("turn-1", 1, { lastOpenedAt: 10 })];
    expect(model.commitWindow(request, generation, loaded(repairedRows))).toBe(true);
    const repaired = model.window$(request.connectionId, request.threadId).peek();
    expect(repaired).not.toBe(initialSnapshot);
    expect(model.readRows(repaired.turnRowIds)[0]?.lastOpenedAt).toBe(10);

    const streamedRows = [row("turn-1", 1, { lastOpenedAt: 20 })];
    model.publishChanges([{ type: "update", value: streamedRows[0] }]);
    model.refreshThread(request.connectionId, request.threadId, streamedRows);

    const presented = model.window$(request.connectionId, request.threadId).peek();
    expect(presented.revision).toBeGreaterThan(repaired.revision);
    expect(model.readRows(presented.turnRowIds)[0]?.lastOpenedAt).toBe(20);
  });

  it("publishes an optimistic send into the active window immediately", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded([row("turn-1", 1)]));

    const pending = row("client-1", 2, {
      kind: "pending",
      pending: {
        attachments: [],
        attempts: 0,
        commandId: "client-1",
        createdAt: 2,
        lastError: null,
        method: "turn/start",
        presentation: "delivery",
        state: "queued",
        text: "visible immediately",
        updatedAt: 2,
      },
      remoteTurnId: null,
      sealed: false,
    });
    model.publishChanges([{ type: "insert", value: pending }]);
    model.refreshThread(request.connectionId, request.threadId, [row("turn-1", 1), pending]);

    const snapshot = model.window$(request.connectionId, request.threadId).peek();
    expect(snapshot.liveRowIds).toContain(pending.id);
    expect(model.readRows(snapshot.liveRowIds)).toContain(pending);
  });

  it("commits the first usable window immediately", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);

    expect(model.commitWindow(request, generation, loaded([row("turn-1", 1)]))).toBe(true);
    expect(model.window$(request.connectionId, request.threadId).peek()).toMatchObject({
      status: "ready",
      turnRowIds: ["turn-1"],
    });
  });

  it("keeps the latest initial window promise authoritative when the request changes", async () => {
    const model = createThreadChatModel();
    let resolveFirst!: () => void;
    let resolveLatest!: () => void;
    const firstLoad = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const latestLoad = new Promise<void>((resolve) => {
      resolveLatest = resolve;
    });
    const first = model.resource(request, async () => {
      const generation = model.startWindow(request);
      await firstLoad;
      model.commitWindow(request, generation, loaded([row("stale", 0)]));
    });
    const latestRequest = { ...request, anchorTurnId: "anchor" };
    const latest = model.resource(latestRequest, async () => {
      const generation = model.startWindow(latestRequest);
      await latestLoad;
      model.commitWindow(latestRequest, generation, {
        ...loaded([row("fresh", 1)]),
        requestKey: threadChatRequestKey(latestRequest),
      });
    });

    expect(latest.ready$).not.toBe(first.ready$);
    resolveFirst();
    await first.ready$.peek();
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual([]);
    resolveLatest();
    await latest.ready$.peek();
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual([
      "fresh",
    ]);
  });

  it("rejects an obsolete range commit after a newer range wins", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded([row("initial", 2)]));
    const expected = model.window$(request.connectionId, request.threadId).peek();
    expect(
      model.commitRange(
        request.connectionId,
        request.threadId,
        expected,
        loaded([row("fresh", 1)]),
      ),
    ).toBe(true);
    expect(
      model.commitRange(
        request.connectionId,
        request.threadId,
        expected,
        loaded([row("stale", 0)]),
      ),
    ).toBe(false);
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual([
      "fresh",
    ]);
  });

  it("keeps a completed live row resident when it seals", () => {
    const model = createThreadChatModel();
    const live = row("turn-live", 3, { sealed: false });
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, {
      ...loaded([]),
      liveRowIds: [live.id],
      rows: [live],
    });

    const sealed = { ...live, sealed: true };
    model.publishChanges([{ type: "update", value: sealed }]);
    model.refreshThread(request.connectionId, request.threadId, [sealed]);
    const snapshot = model.window$(request.connectionId, request.threadId).peek();

    expect(snapshot.liveRowIds).toEqual([]);
    expect(snapshot.turnRowIds).toEqual([sealed.id]);
    expect(model.readRows(snapshot.turnRowIds)).toEqual([sealed]);
  });

  it("separates streamed content revisions from structural window revisions", () => {
    const model = createThreadChatModel();
    const turn = (text: string): NonNullable<ThreadDetailRow["turn"]> => ({
      id: "turn-1",
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: 1,
      completedAt: null,
      durationMs: null,
      items: [
        { type: "agentMessage", id: "message-1", text, phase: "commentary", memoryCitation: null },
      ],
    });
    const initial = row("turn-1", 1, { sealed: false, turn: turn("Hello") });
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, {
      ...loaded([]),
      liveRowIds: [initial.id],
      rows: [initial],
    });
    const committed = model.window$(request.connectionId, request.threadId).peek();

    const streamed = { ...initial, turn: turn("Hello, streamed world") };
    model.publishChanges([{ type: "update", value: streamed }]);
    model.refreshThread(request.connectionId, request.threadId, [streamed]);
    const contentUpdate = model.window$(request.connectionId, request.threadId).peek();

    expect(contentUpdate.revision).toBe(committed.revision + 1);
    expect(contentUpdate.layoutRevision).toBe(committed.layoutRevision);
    expect(model.readRows(contentUpdate.liveRowIds)).toEqual([streamed]);

    const sealed = { ...streamed, sealed: true };
    model.publishChanges([{ type: "update", value: sealed }]);
    model.refreshThread(request.connectionId, request.threadId, [sealed]);
    const structuralUpdate = model.window$(request.connectionId, request.threadId).peek();

    expect(structuralUpdate.layoutRevision).toBe(contentUpdate.layoutRevision + 1);
    expect(structuralUpdate.turnRowIds).toEqual([sealed.id]);
  });

  it("keeps the last complete window ready when a refresh fails", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const initialGeneration = model.startWindow(request);
    model.commitWindow(request, initialGeneration, loaded(rows));

    const generation = model.startWindow(request);
    model.failWindow(request, generation, new Error("transient read failure"));
    const snapshot = model.window$(request.connectionId, request.threadId).peek();

    expect(snapshot.status).toBe("background-retrying");
    expect(snapshot.error).toBe("transient read failure");
    expect(snapshot.turnRowIds).toEqual(["turn-1", "turn-2"]);
  });

  it("recovers an initially failed local window when authoritative rows arrive", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);
    model.failWindow(request, generation, new Error("transient read failure"));

    model.refreshThread(request.connectionId, request.threadId, [row("turn-1", 1)]);
    const snapshot = model.window$(request.connectionId, request.threadId).peek();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.error).toBeNull();
    expect(snapshot.turnRowIds).toEqual(["turn-1"]);
  });

  it("evicts an unowned window only after the inactive budget is exceeded", () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });

    model.startWindow({ ...request, threadId: "thread-0" });
    model.startWindow({ ...request, threadId: "thread-1" });
    model.startWindow({ ...request, threadId: "thread-2" });
    model.startWindow({ ...request, threadId: "thread-3" });
    expect(evicted).toEqual([]);
    model.startWindow({ ...request, threadId: "thread-4" });
    expect(evicted).toEqual(["connection/thread-0"]);
    model.close();
  });

  it("protects mounted consumers from budget pressure until their release settles", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const releaseFirst = model.retainWindow("connection", "thread-0");
    model.startWindow({ ...request, threadId: "thread-0" });
    const releaseSecond = model.retainWindow("connection", "thread-1");
    model.startWindow({ ...request, threadId: "thread-1" });

    expect(evicted).toEqual([]);
    for (let index = 2; index <= 6; index += 1) {
      const target = { ...request, threadId: `thread-${index}` };
      await model
        .resource(target, async () => {
          const generation = model.startWindow(target);
          model.commitWindow(target, generation, loaded([], target));
        })
        .ready$.peek();
    }
    expect(evicted).toEqual(["connection/thread-2"]);
    releaseFirst();
    await Promise.resolve();
    expect(evicted).toEqual(["connection/thread-2", "connection/thread-0"]);
    releaseSecond();
    await Promise.resolve();
    expect(evicted).toEqual(["connection/thread-2", "connection/thread-0", "connection/thread-1"]);
    model.close();
  });

  it("preserves one window until the replacement responsive owner releases it", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const releaseMobile = model.retainWindow(request.connectionId, request.threadId);
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded([row("turn-1", 1)]));
    const window = model.window$(request.connectionId, request.threadId);

    releaseMobile();
    const releaseDesktop = model.retainWindow(request.connectionId, request.threadId);
    await Promise.resolve();

    expect(evicted).toEqual([]);
    expect(model.window$(request.connectionId, request.threadId)).toBe(window);
    expect(window.peek().turnRowIds).toEqual(["turn-1"]);

    releaseDesktop();
    await Promise.resolve();
    expect(evicted).toEqual(["connection/thread"]);
    expect(model.residentRowCount()).toBe(0);
    model.close();
  });

  it("keeps a pending window through a suspended replacement owner handoff", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const releasePrevious = model.retainWindow(request.connectionId, request.threadId);
    const gate = Promise.withResolvers<void>();
    const resource = model.resource(request, async () => {
      const generation = model.startWindow(request);
      await gate.promise;
      model.commitWindow(request, generation, loaded([row("turn-1", 1)]));
    });
    const window = resource.window$;

    releasePrevious();
    gate.resolve();
    await resource.ready$.peek();
    const releaseReplacement = model.retainWindow(request.connectionId, request.threadId);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(evicted).toEqual([]);
    expect(model.window$(request.connectionId, request.threadId)).toBe(window);
    expect(model.readRows(window.peek().turnRowIds).map((item) => item.id)).toEqual(["turn-1"]);

    releaseReplacement();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(evicted).toEqual([]);
    expect(model.window$(request.connectionId, request.threadId)).toBe(window);
    model.close();
  });

  it("evicts an off-screen projection and reloads it from the durable owner", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const release = model.retainWindow(request.connectionId, request.threadId);
    let loads = 0;
    const first = model.resource(request, async () => {
      loads += 1;
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("cached", 1)]));
    });
    await first.ready$.peek();

    release();
    const replacementRequest = { ...request, threadId: "replacement" };
    const replacement = model.resource(replacementRequest, async () => {
      const generation = model.startWindow(replacementRequest);
      model.commitWindow(replacementRequest, generation, loaded([], replacementRequest));
    });
    await replacement.ready$.peek();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(evicted).toEqual(["connection/thread"]);
    expect(model.residentRowCount()).toBe(0);

    const reopened = model.resource(request, async () => {
      loads += 1;
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("fresh", 2)]));
    });
    expect(reopened.window$.peek().turnRowIds).toEqual([]);
    await vi.waitFor(() => expect(loads).toBe(2));
    await vi.waitFor(() =>
      expect(model.readRows(reopened.window$.peek().turnRowIds).map((item) => item.id)).toEqual([
        "fresh",
      ]),
    );
    model.close();
  });

  it("evicts only the released conversation, not a newly observed one", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const releasePrevious = model.retainWindow("connection", "thread-0");
    model.startWindow({ ...request, threadId: "thread-0" });
    const nextWindow = model.window$("connection", "thread-1");

    releasePrevious();
    await Promise.resolve();

    expect(evicted).toEqual(["connection/thread-0"]);
    expect(model.window$("connection", "thread-1")).toBe(nextWindow);
    model.close();
  });

  it("reports resident membership through updates, deletion, reinsertion, eviction and close", () => {
    const reports: number[] = [];
    const model = createThreadChatModel({
      onResidentRowCountChange: (count) => {
        reports.push(count);
      },
    });
    model.row$("unloaded");
    expect(model.residentRowCount()).toBe(0);
    const first = row("a", 0);
    const second = row("b", 1);
    model.commitWindow(request, model.startWindow(request), loaded([first, second]));
    expect(model.residentRowCount()).toBe(2);
    reports.length = 0;
    model.publishChanges([{ type: "update", value: { ...first, lastOpenedAt: 10 } }]);
    expect(reports).toEqual([]);
    model.publishChanges([
      { type: "delete", key: first.id },
      { type: "delete", key: first.id },
    ]);
    expect(model.residentRowCount()).toBe(1);
    model.publishChanges([{ type: "insert", value: first }]);
    expect(model.residentRowCount()).toBe(2);
    for (let index = 0; index < 4; index += 1)
      model.startWindow({ ...request, threadId: `other-${index}` });
    expect(model.residentRowCount()).toBe(0);
    model.publishChanges([{ type: "insert", value: second }]);
    model.close();
    expect(model.residentRowCount()).toBe(0);
    expect(reports).toEqual([1, 2, 0, 1, 0]);
  });

  it("drops mounted row objects when leaving the chat", async () => {
    const model = createThreadChatModel();
    const release = model.retainWindow(request.connectionId, request.threadId);
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(rows));

    expect(model.residentRowCount()).toBe(2);
    release();
    await Promise.resolve();
    expect(model.residentRowCount()).toBe(0);
    model.close();
  });
});
