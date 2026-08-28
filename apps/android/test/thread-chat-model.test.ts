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

function row(id: string, ordinal: number, overrides: Partial<ThreadDetailRow> = {}): ThreadDetailRow {
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

  it("revalidates a resident window once for each explicit chat opening", async () => {
    const model = createThreadChatModel();
    const firstRequest = { ...request, openGeneration: 1 };
    let loads = 0;
    const initial = model.resource(firstRequest, async () => {
      loads += 1;
      const generation = model.startWindow(firstRequest);
      model.commitWindow(firstRequest, generation, loaded([row("turn-1", 1)], firstRequest));
    });
    await initial.ready$.peek();

    let finishSecond!: () => void;
    const secondFinished = new Promise<void>((resolve) => { finishSecond = resolve; });
    const secondRequest = { ...request, openGeneration: 2 };
    const reopened = model.resource(secondRequest, async () => {
      loads += 1;
      const generation = model.startWindow(secondRequest);
      model.commitWindow(secondRequest, generation, loaded([row("turn-1", 1)], secondRequest));
      finishSecond();
    });
    await secondFinished;

    expect(reopened.ready$).toBe(initial.ready$);
    expect(loads).toBe(2);
    expect(reopened.window$.peek().requestKey).toBe(threadChatRequestKey(secondRequest));
  });

  it("does not let a superseded backend refresh clear the active opening indicator", () => {
    const model = createThreadChatModel();
    const firstRequest = { ...request, openGeneration: 1 };
    const firstGeneration = model.startWindow(firstRequest);
    model.setBackendRefreshing(firstRequest, firstGeneration, true);
    expect(model.window$(request.connectionId, request.threadId).peek().backendRefreshing).toBe(true);

    const secondRequest = { ...request, openGeneration: 2 };
    const secondGeneration = model.startWindow(secondRequest);
    model.setBackendRefreshing(secondRequest, secondGeneration, true);
    model.setBackendRefreshing(firstRequest, firstGeneration, false);
    expect(model.window$(request.connectionId, request.threadId).peek().backendRefreshing).toBe(true);

    model.setBackendRefreshing(secondRequest, secondGeneration, false);
    expect(model.window$(request.connectionId, request.threadId).peek().backendRefreshing).toBe(false);
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
    expect(model.commitRange(request.connectionId, request.threadId, {
      historyEpoch: before.historyEpoch,
      layoutRevision: before.layoutRevision,
    }, loaded([row("turn-1", 1)]))).toBe(true);

    expect(model.resource(request, async () => undefined).ready$).toBe(initial.ready$);
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual(["turn-1"]);
  });

  it("replaces window membership atomically and keeps the window ready", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const firstGeneration = model.startWindow(request);
    expect(model.commitWindow(request, firstGeneration, loaded(rows))).toBe(true);
    const before = model.window$(request.connectionId, request.threadId).peek();
    expect(model.commitRange(request.connectionId, request.threadId, before, loaded([row("turn-0", 0), row("turn-1", 1)]))).toBe(true);
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

    const resolved = model.resource(anchorRequest, async () => { loads += 1; });

    expect(resolved.ready$).toBe(initial.ready$);
    expect(loads).toBe(1);
    expect(model.window$(request.connectionId, request.threadId).peek()).toMatchObject({
      requestKey: threadChatRequestKey(anchorRequest),
      status: "ready",
    });
  });

  it("keeps an initial load failure stable until an explicit reopen", async () => {
    const model = createThreadChatModel();
    const failedLoader = vi.fn(async () => { throw new Error("cold load failed"); });
    const initial = model.resource(request, failedLoader);
    const initialPromise = initial.ready$.peek();

    await expect(initialPromise).rejects.toThrow("cold load failed");
    const repeatedRender = model.resource(request, failedLoader);
    expect(repeatedRender.ready$).toBe(initial.ready$);
    expect(failedLoader).toHaveBeenCalledTimes(1);

    const reopenedRequest = { ...request, openGeneration: 1 };
    const reopenedLoader = vi.fn(async () => undefined);
    const reopened = model.resource(reopenedRequest, reopenedLoader);
    const reopenedPromise = reopened.ready$.peek();
    await expect(reopenedPromise).resolves.toBe(true);
    expect(Object.is(reopenedPromise, initialPromise)).toBe(false);
    expect(reopenedLoader).toHaveBeenCalledTimes(1);
  });

  it("structurally shares an equivalent SQLite revalidation", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-1", 1, { turnMetadata: { tokenUsage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2 } } })];
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

  it("publishes one initial window and coalesces navigation-time repairs until first draw", () => {
    const model = createThreadChatModel();
    const initialRows = [row("turn-1", 1)];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(initialRows));
    const initialSnapshot = model.window$(request.connectionId, request.threadId).peek();

    model.beginPresentation(request.connectionId, request.threadId);
    const repairedRows = [row("turn-1", 1, { lastOpenedAt: 10 })];
    expect(model.commitWindow(request, generation, loaded(repairedRows))).toBe(true);
    const streamedRows = [row("turn-1", 1, { lastOpenedAt: 20 })];
    model.publishChanges([{ type: "update", value: streamedRows[0] }]);
    model.refreshThread(request.connectionId, request.threadId, streamedRows);

    expect(model.window$(request.connectionId, request.threadId).peek()).toBe(initialSnapshot);

    model.finishPresentation(request.connectionId, request.threadId);
    const presented = model.window$(request.connectionId, request.threadId).peek();
    expect(presented.revision).toBeGreaterThan(initialSnapshot.revision);
    expect(model.readRows(presented.turnRowIds)[0]?.lastOpenedAt).toBe(20);
  });

  it("does not hold the first usable window behind the presentation barrier", () => {
    const model = createThreadChatModel();
    model.beginPresentation(request.connectionId, request.threadId);
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
    const firstLoad = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const latestLoad = new Promise<void>((resolve) => { resolveLatest = resolve; });
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
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual(["fresh"]);
  });

  it("rejects an obsolete range commit after a newer range wins", () => {
    const model = createThreadChatModel();
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded([row("initial", 2)]));
    const expected = model.window$(request.connectionId, request.threadId).peek();
    expect(model.commitRange(request.connectionId, request.threadId, expected, loaded([row("fresh", 1)]))).toBe(true);
    expect(model.commitRange(request.connectionId, request.threadId, expected, loaded([row("stale", 0)]))).toBe(false);
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual(["fresh"]);
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
      items: [{ type: "agentMessage", id: "message-1", text, phase: "commentary", memoryCitation: null }],
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

  it("evicts an unowned window as soon as another conversation starts", () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });

    model.startWindow({ ...request, threadId: "thread-0" });
    model.startWindow({ ...request, threadId: "thread-1" });

    expect(evicted).toEqual(["connection/thread-0"]);
  });

  it("keeps mounted consumers and evicts each window after release settles", async () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const releaseFirst = model.retainWindow("connection", "thread-0");
    model.startWindow({ ...request, threadId: "thread-0" });
    const releaseSecond = model.retainWindow("connection", "thread-1");
    model.startWindow({ ...request, threadId: "thread-1" });

    expect(evicted).toEqual([]);
    releaseFirst();
    await Promise.resolve();
    expect(evicted).toEqual(["connection/thread-0"]);
    releaseSecond();
    await Promise.resolve();
    expect(evicted).toEqual(["connection/thread-0", "connection/thread-1"]);
  });

  it("preserves one window across a same-thread responsive owner handoff", async () => {
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
  });

  it("does not evict a newly observed conversation while releasing the previous one", async () => {
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
  });

  it("drops resident row objects when the last consumer release settles", async () => {
    const model = createThreadChatModel();
    const release = model.retainWindow(request.connectionId, request.threadId);
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(rows));

    expect(model.residentRowCount()).toBe(2);
    release();
    await Promise.resolve();
    expect(model.residentRowCount()).toBe(0);
  });
});
