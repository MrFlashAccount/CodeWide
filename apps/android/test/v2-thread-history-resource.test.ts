import type {
  SyncV2SessionSnapshot,
  V2Projection,
  V2Query,
  V2QueryResult,
  V2ThreadWindow,
  V2TurnView,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import {
  ThreadHistoryResource,
  THREAD_HISTORY_RESIDENT_LIMIT,
} from "../src/v2/application/resources/threadHistoryResource";

describe("ThreadHistoryResource", () => {
  it("slides one bounded resident window older and back newer with server cursors", async () => {
    const source = new ProjectionSource(projection("generation-1", threadWindow(36, 36, "older-1", null)));
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute
      .mockResolvedValueOnce(historyPage(0, 36, "older-2", "newer-1"))
      .mockResolvedValueOnce(historyPage(35, 36, "older-1", "newer-2"))
      .mockResolvedValueOnce(historyPage(70, 2, "older-1", null));
    const resource = new ThreadHistoryResource({
      execute,
      source,
      threadId: "thread-1",
    });

    expect(resource.snapshot().value.turns.map(({ id }) => id)).toEqual(turnIds(36, 36));
    await resource.loadOlder();
    expect(resource.snapshot().value.turns).toHaveLength(72);
    resource.settle("older");
    expect(resource.snapshot().value.turns.map(({ id }) => id)).toEqual(turnIds(0, 36));
    expect(resource.snapshot().value.canLoadNewer).toBe(true);

    await resource.loadNewer();
    expect(resource.snapshot().value.turns.length).toBeLessThanOrEqual(
      THREAD_HISTORY_RESIDENT_LIMIT * 2,
    );
    resource.settle("newer");
    expect(resource.snapshot().value.turns.map(({ id }) => id)).toEqual(turnIds(35, 36));
    expect(resource.snapshot().value.canLoadNewer).toBe(true);

    await resource.loadNewer();
    resource.settle("newer");
    expect(resource.snapshot().value.turns.map(({ id }) => id)).toEqual(turnIds(36, 36));
    expect(resource.snapshot().value.canLoadNewer).toBe(false);
    expect(execute.mock.calls.map(([query]) => query)).toEqual([
      {
        cursor: "older-1",
        detail: "summary",
        direction: "older",
        kind: "history.page",
        limit: THREAD_HISTORY_RESIDENT_LIMIT,
        threadId: "thread-1",
      },
      {
        cursor: "newer-1",
        detail: "summary",
        direction: "newer",
        kind: "history.page",
        limit: THREAD_HISTORY_RESIDENT_LIMIT,
        threadId: "thread-1",
      },
      {
        cursor: "newer-2",
        detail: "summary",
        direction: "newer",
        kind: "history.page",
        limit: THREAD_HISTORY_RESIDENT_LIMIT,
        threadId: "thread-1",
      },
    ]);
  });

  it("keeps an older resident range stable while live tail changes arrive", () => {
    const source = new ProjectionSource(projection("generation-1", threadWindow(0, 36, "older-2", "newer-1")));
    const resource = new ThreadHistoryResource({
      execute: vi.fn(),
      source,
      threadId: "thread-1",
    });
    resource.start();

    source.publish(projection("generation-1", threadWindow(40, 36, "older-1", null)));

    expect(resource.snapshot().value.turns.map(({ id }) => id)).toEqual(turnIds(0, 36));
    resource.stop();
  });

  it("resets stale cursors and rows at a new authoritative generation", () => {
    const source = new ProjectionSource(projection("generation-1", threadWindow(0, 36, "older-2", "newer-1")));
    const resource = new ThreadHistoryResource({
      execute: vi.fn(),
      source,
      threadId: "thread-1",
    });
    resource.start();

    source.publish(projection("generation-2", threadWindow(100, 12, null, null)));

    expect(resource.snapshot().value.turns.map(({ id }) => id)).toEqual(turnIds(100, 12));
    expect(resource.snapshot().value.canLoadOlder).toBe(false);
    expect(resource.snapshot().value.canLoadNewer).toBe(false);
    resource.stop();
  });
});

class ProjectionSource {
  readonly #listeners = new Set<() => void>();
  #value: SyncV2SessionSnapshot;

  constructor(value: SyncV2SessionSnapshot) {
    this.#value = value;
  }

  publish(value: SyncV2SessionSnapshot): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }

  snapshot = (): { value: SyncV2SessionSnapshot } => ({ value: this.#value });

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

function projection(generationId: string, currentThread: V2ThreadWindow): SyncV2SessionSnapshot {
  const value: V2Projection = {
    accountsRevision: null,
    catalog: [],
    currentThread,
    epochId: generationId,
    generationId,
    invalidations: [],
    limits: {
      catalogPerPartitionMax: 100,
      historyPageMax: 100,
      queueMaxBytes: 4_194_304,
      queueMaxEvents: 2_048,
      turnWindowMax: 36,
    },
    pendingRequests: [],
    queueRevisions: {},
    resourceRevisions: {},
    revision: `sync-v2-revision:${generationId}`,
    scope: {
      active: { complete: true, limit: 0, returned: 0 },
      archived: { complete: true, limit: 0, returned: 0 },
    },
    sourceGeneration: "1",
    watermark: "1",
  };
  return {
    operations: [],
    projections: { live: value, retained: value },
    state: "live",
    version: 1,
  };
}

function threadWindow(
  start: number,
  count: number,
  olderCursor: string | null,
  newerCursor: string | null,
): V2ThreadWindow {
  return {
    newerCursor,
    olderCursor,
    thread: {
      archived: false,
      createdAt: "2026-09-01T00:00:00Z",
      headTurnId: `turn-${start + count - 1}`,
      id: "thread-1",
      lastActivityAt: "2026-09-01T00:00:00Z",
      parentId: null,
      preview: "Thread",
      settings: null,
      state: "completed",
      title: "Thread",
      updatedAt: "2026-09-01T00:00:00Z",
      workspace: "/workspace",
    },
    turns: turns(start, count),
  };
}

function historyPage(
  start: number,
  count: number,
  olderCursor: string | null,
  newerCursor: string | null,
): V2QueryResult {
  return {
    kind: "history.page",
    newerCursor,
    olderCursor,
    threadId: "thread-1",
    turns: turns(start, count),
  };
}

function turns(start: number, count: number): V2TurnView[] {
  return turnIds(start, count).map((id) => ({
    activity: null,
    completedAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    durationMs: 1,
    id,
    items: [{ id: `${id}-text`, kind: "assistantText", text: id }],
    state: "completed",
    threadId: "thread-1",
    usage: null,
  }));
}

function turnIds(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => `turn-${start + offset}`);
}
