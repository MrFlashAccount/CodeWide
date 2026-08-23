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
  residentHistoryEpoch: null,
  residentMaxOrdinal: null,
  residentTurnLimit: 30,
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
  requestedMaxOrdinal: number | null = null,
  loadedRequest: ThreadChatWindowRequest = request,
): LoadedThreadChatWindow {
  return {
    scope: threadChatScope(loadedRequest.connectionId, loadedRequest.threadId),
    requestKey: threadChatRequestKey(loadedRequest),
    historyEpoch: 0,
    latestSealedOrdinal: 2,
    earliestSealedOrdinal: 0,
    requestedMaxOrdinal,
    residentTurnLimit: loadedRequest.residentTurnLimit,
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

  it("does not suspend a neighbouring range requested in the committed window's first draw", async () => {
    const model = createThreadChatModel();
    const olderRequest = { ...request, residentMaxOrdinal: 1 };
    let neighbouringReady: ReturnType<typeof model.resource>["ready$"] | null = null;
    const initial = model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("turn-2", 2)]));
      // LegendList can synchronously report its first draw before this loader
      // promise reaches its `.then`. The committed snapshot must already make
      // the next range stale-while-revalidate rather than a new Suspense load.
      neighbouringReady = model.resource(olderRequest, async () => undefined).ready$;
    });

    await initial.ready$.peek();

    expect(neighbouringReady).toBe(initial.ready$);
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual(["turn-2"]);
  });

  it("keeps the last complete range ready while a different range loads", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const firstGeneration = model.startWindow(request);
    expect(model.commitWindow(request, firstGeneration, loaded(rows))).toBe(true);

    const olderRequest = { ...request, residentMaxOrdinal: 1 };
    model.startWindow(olderRequest);
    const refreshing = model.window$(request.connectionId, request.threadId).peek();

    expect(refreshing.status).toBe("loading-history");
    expect(refreshing.turnRowIds).toEqual(["turn-1", "turn-2"]);
    expect(model.readRows(refreshing.turnRowIds)).toEqual(rows);
  });

  it("adopts the resolved anchor boundary without loading the same SQLite range twice", async () => {
    const model = createThreadChatModel();
    const anchorRequest = { ...request, anchorTurnId: "turn-1", residentHistoryEpoch: null, residentMaxOrdinal: undefined };
    let loads = 0;
    const initial = model.resource(anchorRequest, async () => {
      loads += 1;
      const generation = model.startWindow(anchorRequest);
      model.commitWindow(anchorRequest, generation, loaded([row("turn-1", 1)], 6, anchorRequest));
    });
    await initial.ready$.peek();

    const resolvedRequest = { ...anchorRequest, residentHistoryEpoch: 0, residentMaxOrdinal: 6 };
    const resolved = model.resource(resolvedRequest, async () => {
      loads += 1;
      const generation = model.startWindow(resolvedRequest);
      model.commitWindow(resolvedRequest, generation, loaded([row("turn-1", 1)], 6, resolvedRequest));
    });

    expect(resolved.ready$).toBe(initial.ready$);
    expect(loads).toBe(1);
    expect(model.window$(request.connectionId, request.threadId).peek()).toMatchObject({
      requestKey: threadChatRequestKey(anchorRequest),
      requestedMaxOrdinal: 6,
      status: "ready",
    });
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

  it("keeps the latest initial range promise authoritative when the request changes", async () => {
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

  it("retries a failed background range and atomically installs the replacement", async () => {
    const model = createThreadChatModel();
    await model.resource(request, async () => {
      const generation = model.startWindow(request);
      model.commitWindow(request, generation, loaded([row("turn-2", 2)]));
    }).ready$.peek();
    const olderRequest = { ...request, residentMaxOrdinal: 1 };
    let attempts = 0;
    model.resource(olderRequest, async () => {
      attempts += 1;
      const generation = model.startWindow(olderRequest);
      if (attempts === 1) {
        model.failWindow(olderRequest, generation, new Error("disk busy"));
        throw new Error("disk busy");
      }
      model.commitWindow(olderRequest, generation, {
        ...loaded([row("turn-1", 1)], 1),
        requestKey: threadChatRequestKey(olderRequest),
      });
    });

    await vi.waitFor(() => expect(model.window$(request.connectionId, request.threadId).peek().error).toBe("disk busy"));
    expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual(["turn-2"]);
    await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 1_000 });
    await vi.waitFor(() => expect(model.window$(request.connectionId, request.threadId).peek().turnRowIds).toEqual(["turn-1"]));
  });

  it("rejects an obsolete range result after a newer request wins", () => {
    const model = createThreadChatModel();
    const firstGeneration = model.startWindow(request);
    const newerRequest = { ...request, residentMaxOrdinal: 10 };
    const newerGeneration = model.startWindow(newerRequest);

    expect(model.commitWindow(request, firstGeneration, loaded([row("stale", 0)]))).toBe(false);
    expect(model.commitWindow(newerRequest, newerGeneration, {
      ...loaded([row("fresh", 10)], 10),
      requestKey: threadChatRequestKey(newerRequest),
    })).toBe(true);
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

  it("keeps the last complete range ready when a refresh fails", () => {
    const model = createThreadChatModel();
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const initialGeneration = model.startWindow(request);
    model.commitWindow(request, initialGeneration, loaded(rows));

    const olderRequest = { ...request, residentMaxOrdinal: 1 };
    const generation = model.startWindow(olderRequest);
    model.failWindow(olderRequest, generation, new Error("transient read failure"));
    const snapshot = model.window$(request.connectionId, request.threadId).peek();

    expect(snapshot.status).toBe("background-retrying");
    expect(snapshot.error).toBe("transient read failure");
    expect(snapshot.turnRowIds).toEqual(["turn-1", "turn-2"]);
  });

  it("recovers an initially failed local range when authoritative rows arrive", () => {
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

  it("keeps mounted consumers and evicts each window on release", () => {
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
    expect(evicted).toEqual(["connection/thread-0"]);
    releaseSecond();
    expect(evicted).toEqual(["connection/thread-0", "connection/thread-1"]);
  });

  it("does not evict a newly observed conversation while releasing the previous one", () => {
    const evicted: string[] = [];
    const model = createThreadChatModel({
      onEvictWindow: (connectionId, threadId) => evicted.push(`${connectionId}/${threadId}`),
    });
    const releasePrevious = model.retainWindow("connection", "thread-0");
    model.startWindow({ ...request, threadId: "thread-0" });
    const nextWindow = model.window$("connection", "thread-1");

    releasePrevious();

    expect(evicted).toEqual(["connection/thread-0"]);
    expect(model.window$("connection", "thread-1")).toBe(nextWindow);
  });

  it("drops resident row objects when the last consumer releases", () => {
    const model = createThreadChatModel();
    const release = model.retainWindow(request.connectionId, request.threadId);
    const rows = [row("turn-1", 1), row("turn-2", 2)];
    const generation = model.startWindow(request);
    model.commitWindow(request, generation, loaded(rows));

    expect(model.residentRowCount()).toBe(2);
    release();
    expect(model.residentRowCount()).toBe(0);
  });
});
