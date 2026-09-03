import {
  v2SavedServerId,
  type V2AggregateProjection,
  type V2Projection,
  type V2Query,
  type V2QueryResult,
  type V2ThreadSummary,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { AggregateThreadCatalogResource } from "../src/v2/application/resources/aggregateThreadCatalogResource";
import { ObservableResource } from "../src/v2/application/resources/resource";
import { savedServerId } from "../src/v2/domain/ids";

describe("AggregateThreadCatalogResource", () => {
  it("pages every incomplete saved-server partition without collapsing ownership", async () => {
    const source = sourceWith([
      projection("server-a", "generation-a", thread("a-current"), false),
      projection("server-b", "generation-b", thread("b-current"), false),
    ]);
    const execute = vi.fn(
      async (savedServerId: string, query: V2Query): Promise<V2QueryResult> => ({
        kind: "catalog.page",
        next: null,
        threads: [thread(`${savedServerId}-older`, false, query.kind)],
      }),
    );
    const resource = new AggregateThreadCatalogResource({
      availability: availability("server-a", "server-b"),
      execute,
      source,
    });

    await resource.loadMore("active");

    expect(execute).toHaveBeenCalledTimes(2);
    expect(resource.snapshot().value.active.map((entry) => entry.savedServerId)).toEqual([
      "server-a",
      "server-a",
      "server-b",
      "server-b",
    ]);
    expect(resource.snapshot().value.active.map((entry) => entry.thread.id)).toEqual([
      "a-current",
      "server-a-older",
      "b-current",
      "server-b-older",
    ]);
    expect(resource.snapshot().value.canLoadMore.active).toBe(false);
  });

  it("preserves outside-scope coverage so the UI can keep cached rows non-actionable", () => {
    const outside = thread("outside");
    const source = sourceWith([
      projection("server-a", "generation-a", thread("current"), true, outside),
    ]);
    const resource = new AggregateThreadCatalogResource({
      availability: availability("server-a"),
      execute: vi.fn(),
      source,
    });

    expect(
      resource.snapshot().value.active.map((entry) => [entry.thread.id, entry.coverage]),
    ).toEqual([
      ["current", "current"],
      ["outside", "outsideCurrentScope"],
    ]);
  });

  it("never opens a pagination query for an unavailable saved server", async () => {
    const source = sourceWith([
      projection("server-a", "generation-a", thread("a-current"), false),
      projection("server-b", "generation-b", thread("b-current"), false),
    ]);
    const execute = vi.fn((savedServerId: string): Promise<V2QueryResult> =>
      Promise.resolve({
        kind: "catalog.page",
        next: null,
        threads: [thread(`${savedServerId}-older`)],
      }),
    );
    const resource = new AggregateThreadCatalogResource({
      availability: availability("server-a"),
      execute,
      source,
    });

    await resource.loadMore("active");

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("server-a", expect.any(Object));
    expect(resource.snapshot().value.canLoadMore.active).toBe(false);
  });

  it("keeps cached rows visible while surfacing an aggregate source failure", () => {
    const source = sourceWith([projection("server-a", "generation-a", thread("cached"), true)]);
    const resource = new AggregateThreadCatalogResource({
      availability: availability("server-a"),
      execute: vi.fn(),
      source,
    });
    source.publish({
      message: "Could not load threads",
      status: "error",
      value: source.snapshot().value,
    });
    const unsubscribe = resource.subscribe(() => undefined);

    expect(resource.snapshot()).toMatchObject({
      message: "Could not load threads",
      status: "error",
    });
    expect(resource.snapshot().value.active[0]?.thread.id).toBe("cached");
    unsubscribe();
  });
});

function availability(...ids: string[]) {
  const source = new ObservableResource(
    new Map(ids.map((id) => [savedServerId(id), { detail: null, state: "connected" as const }])),
  );
  source.publish({ status: "ready", value: source.snapshot().value });
  return source;
}

function sourceWith(
  servers: V2AggregateProjection["servers"],
): ObservableResource<V2AggregateProjection> {
  const source = new ObservableResource<V2AggregateProjection>({
    selection: { kind: "all" },
    servers,
    threads: [],
  });
  source.publish({ status: "ready", value: source.snapshot().value });
  return source;
}

function projection(
  savedServerId: string,
  generationId: string,
  current: V2ThreadSummary,
  complete: boolean,
  outside?: V2ThreadSummary,
): V2AggregateProjection["servers"][number] {
  const catalog: V2Projection["catalog"] = [
    { coverage: "current", thread: current },
    ...(outside === undefined
      ? []
      : [{ coverage: "outsideCurrentScope" as const, thread: outside }]),
  ];
  return {
    projection: {
      accountsRevision: null,
      catalog,
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
        active: { complete, limit: 40, returned: 1 },
        archived: { complete: true, limit: 40, returned: 0 },
      },
      sourceGeneration: "1",
      watermark: "1",
    },
    savedServerId: v2SavedServerId(savedServerId),
  };
}

function thread(id: string, archived = false, preview = id): V2ThreadSummary {
  return {
    archived,
    createdAt: "2026-09-01T00:00:00Z",
    headTurnId: null,
    id,
    lastActivityAt: "2026-09-01T00:00:00Z",
    parentId: null,
    preview,
    readState: {
      kind: "read",
      latestActivityMarker: null,
      readThroughMarker: null,
      unreadCount: 0,
    },
    settings: null,
    state: "completed",
    title: id,
    updatedAt: "2026-09-01T00:00:00Z",
    workspace: "/workspace",
  };
}
