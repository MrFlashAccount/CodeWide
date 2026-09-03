import type {
  SyncV2SessionSnapshot,
  V2Projection,
  V2ProjectionChange,
  V2Query,
  V2QueryResult,
  V2ThreadSummary,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import {
  ThreadCatalogResource,
  THREAD_CATALOG_PAGE_LIMIT,
} from "../src/v2/application/resources/threadCatalogResource";

describe("ThreadCatalogResource", () => {
  it("continues each snapshot partition from its authoritative tail anchor", async () => {
    const source = new ProjectionSource(
      snapshot(
        "generation-1",
        [thread("active-1"), thread("active-2")],
        [thread("archived-1", true)],
        false,
        true,
      ),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute.mockResolvedValue({
      kind: "catalog.page",
      next: null,
      threads: [thread("active-3")],
    });
    const resource = new ThreadCatalogResource({ execute, source });

    await resource.loadMore("active");

    expect(execute).toHaveBeenCalledWith({
      before: {
        lastActivityAt: "2026-09-01T00:00:00Z",
        threadId: "active-2",
        updatedAt: "2026-09-01T00:00:00Z",
      },
      kind: "catalog.page",
      limit: THREAD_CATALOG_PAGE_LIMIT,
      partition: "active",
    });
    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual([
      "active-1",
      "active-2",
      "active-3",
    ]);
    expect(resource.snapshot().value.canLoadMore.active).toBe(false);
    expect(resource.snapshot().value.canLoadMore.archived).toBe(false);
  });

  it("merges live catalog changes without dropping directly loaded older pages", async () => {
    const source = new ProjectionSource(
      snapshot("generation-1", [thread("active-1")], [], false, true),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute.mockResolvedValue({
      kind: "catalog.page",
      next: null,
      threads: [thread("loaded-older")],
    });
    const resource = new ThreadCatalogResource({ execute, source });
    resource.start();
    await resource.loadMore("active");

    source.publish(
      snapshot(
        "generation-1",
        [thread("new-live"), thread("active-1", false, "Updated")],
        [],
        false,
        true,
      ),
    );

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual([
      "new-live",
      "active-1",
      "loaded-older",
    ]);
    expect(resource.snapshot().value.active[1]?.title).toBe("Updated");
    resource.stop();
  });

  it("removes deleted source rows and moves archived rows between partitions", () => {
    const source = new ProjectionSource(
      snapshot("generation-1", [thread("active-1"), thread("moving")], [], true, true),
    );
    const resource = new ThreadCatalogResource({ execute: vi.fn(), source });
    resource.start();

    source.publish(
      snapshot("generation-1", [thread("active-1")], [thread("moving", true)], true, true),
    );
    source.publish(snapshot("generation-1", [], [thread("moving", true)], true, true));

    expect(resource.snapshot().value.active).toEqual([]);
    expect(resource.snapshot().value.archived.map((value) => value.id)).toEqual(["moving"]);
    resource.stop();
  });

  it("removes a directly paged row when its live delete arrives", async () => {
    const source = new ProjectionSource(
      snapshot("generation-1", [thread("active-1")], [], false, true),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute.mockResolvedValue({
      kind: "catalog.page",
      next: null,
      threads: [thread("loaded-older")],
    });
    const resource = new ThreadCatalogResource({ execute, source });
    resource.start();
    await resource.loadMore("active");

    source.publishChange({ kind: "threadRemoved", reason: "deleted", threadId: "loaded-older" });

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual(["active-1"]);
    resource.stop();
  });

  it("never exposes child threads from snapshots, pages, or live catalog changes", async () => {
    const source = new ProjectionSource(
      snapshot("generation-1", [thread("root"), childThread("snapshot-child")], [], false, true),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute.mockResolvedValue({
      kind: "catalog.page",
      next: null,
      threads: [childThread("paged-child"), thread("older-root")],
    });
    const resource = new ThreadCatalogResource({ execute, source });
    resource.start();

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual(["root"]);

    await resource.loadMore("active");
    source.publishChange({ kind: "threadUpserted", thread: childThread("live-child") });

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual([
      "root",
      "older-root",
    ]);
    resource.stop();
  });

  it("resets loaded pages and cursors when authority moves to a new generation", async () => {
    const source = new ProjectionSource(
      snapshot("generation-1", [thread("active-1")], [], false, true),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute.mockResolvedValue({
      kind: "catalog.page",
      next: null,
      threads: [thread("loaded-older")],
    });
    const resource = new ThreadCatalogResource({ execute, source });
    resource.start();
    await resource.loadMore("active");

    source.publish(snapshot("generation-2", [thread("fresh")], [], true, true));

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual(["fresh"]);
    expect(resource.snapshot().value.canLoadMore.active).toBe(false);
    resource.stop();
  });

  it("keeps rows visible after a paging error and allows an explicit retry", async () => {
    const source = new ProjectionSource(
      snapshot("generation-1", [thread("active-1")], [], false, true),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute
      .mockRejectedValueOnce(new Error("stale cursor"))
      .mockResolvedValueOnce({ kind: "catalog.page", next: null, threads: [thread("active-2")] });
    const resource = new ThreadCatalogResource({ execute, source });

    await resource.loadMore("active");

    expect(resource.snapshot()).toMatchObject({ status: "error" });
    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual(["active-1"]);
    expect(resource.snapshot().value.errors.active).toBe("stale cursor");

    await resource.loadMore("active");

    expect(resource.snapshot().status).toBe("ready");
    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual([
      "active-1",
      "active-2",
    ]);
  });

  it("keeps the selected root thread visible when it falls outside the catalog window", () => {
    const source = new ProjectionSource(
      snapshotWithSelected("generation-1", [thread("recent")], thread("selected-older")),
    );
    const resource = new ThreadCatalogResource({ execute: vi.fn(), source });

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual([
      "selected-older",
      "recent",
    ]);
  });

  it("drops an out-of-window selection when authority selects another thread", () => {
    const source = new ProjectionSource(
      snapshotWithSelected("generation-1", [thread("recent")], thread("selected-a")),
    );
    const resource = new ThreadCatalogResource({ execute: vi.fn(), source });
    resource.start();

    source.publish(snapshotWithSelected("generation-1", [thread("recent")], thread("selected-b")));

    expect(resource.snapshot().value.active.map((value) => value.id)).toEqual([
      "selected-b",
      "recent",
    ]);
    resource.stop();
  });

  it("publishes coverage changes for a retained row even when its thread object is unchanged", () => {
    const shared = thread("shared");
    const source = new ProjectionSource(snapshotWithCoverage("generation-1", shared));
    const resource = new ThreadCatalogResource({ execute: vi.fn(), source });
    const listener = vi.fn();
    const unsubscribe = resource.subscribe(listener);

    expect(resource.coverage(shared.id)).toBe("outsideCurrentScope");
    source.publish(snapshot("generation-1", [shared], [], true, true));

    expect(resource.coverage(shared.id)).toBe("current");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

class ProjectionSource {
  readonly #changeListeners = new Set<(change: V2ProjectionChange) => void>();
  readonly #listeners = new Set<() => void>();
  #value: SyncV2SessionSnapshot;

  constructor(value: SyncV2SessionSnapshot) {
    this.#value = value;
  }

  publish(value: SyncV2SessionSnapshot): void {
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }

  publishChange(change: V2ProjectionChange): void {
    for (const listener of this.#changeListeners) listener(change);
  }

  snapshot = (): { value: SyncV2SessionSnapshot } => ({ value: this.#value });

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  subscribeChange = (listener: (change: V2ProjectionChange) => void): (() => void) => {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  };
}

function snapshot(
  generationId: string,
  active: V2ThreadSummary[],
  archived: V2ThreadSummary[],
  activeComplete: boolean,
  archivedComplete: boolean,
): SyncV2SessionSnapshot {
  const projection: V2Projection = {
    accountsRevision: null,
    catalog: [
      ...active.map((value) => ({ coverage: "current" as const, thread: value })),
      ...archived.map((value) => ({ coverage: "current" as const, thread: value })),
    ],
    currentThread: null,
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
      active: { complete: activeComplete, limit: 40, returned: active.length },
      archived: { complete: archivedComplete, limit: 40, returned: archived.length },
    },
    sourceGeneration: "1",
    watermark: "1",
  };
  return {
    operations: [],
    projections: { live: projection, retained: projection },
    state: "live",
    version: 1,
  };
}

function thread(id: string, archived = false, title = id): V2ThreadSummary {
  return {
    archived,
    createdAt: "2026-09-01T00:00:00Z",
    headTurnId: null,
    id,
    lastActivityAt: "2026-09-01T00:00:00Z",
    parentId: null,
    preview: title,
    readState: {
      kind: "read",
      latestActivityMarker: null,
      readThroughMarker: null,
      unreadCount: 0,
    },
    settings: null,
    state: "completed",
    title,
    updatedAt: "2026-09-01T00:00:00Z",
    workspace: "/workspace",
  };
}

function snapshotWithSelected(
  generationId: string,
  active: V2ThreadSummary[],
  selected: V2ThreadSummary,
): SyncV2SessionSnapshot {
  const value = snapshot(generationId, active, [], true, true);
  const projection = value.projections.live;
  if (projection === null) throw new Error("Expected a live projection");
  projection.currentThread = {
    newerCursor: null,
    olderCursor: null,
    thread: selected,
    turns: [],
  };
  return value;
}

function snapshotWithCoverage(
  generationId: string,
  outside: V2ThreadSummary,
): SyncV2SessionSnapshot {
  const value = snapshot(generationId, [outside], [], true, true);
  const projection = value.projections.live;
  if (projection === null) throw new Error("Expected a live projection");
  const covered: V2Projection = {
    ...projection,
    catalog: [{ coverage: "outsideCurrentScope", thread: outside }],
  };
  return {
    ...value,
    projections: { live: covered, retained: covered },
  };
}

function childThread(id: string): V2ThreadSummary {
  const value = thread(id);
  value.parentId = "root";
  return value;
}
