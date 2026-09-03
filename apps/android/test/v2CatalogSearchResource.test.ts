import type { V2Query, V2QueryResult, V2ThreadSummary } from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { CatalogSearchResource } from "../src/v2/application/resources/catalogSearchResource";
import { savedServerId, type SavedServerId } from "../src/v2/domain/ids";
import type { ResourceSnapshot } from "../src/v2/application/resources/resource";
import type { ServerConnectionStatus } from "../src/v2/application/resources/serverConnectionStatusesResource";

describe("CatalogSearchResource", () => {
  it("gets a nonresident long-catalog match directly from bounded indexed search", async () => {
    const execute = vi.fn(async (_server: string, query: V2Query): Promise<V2QueryResult> => {
      if (query.kind !== "catalog.search") throw new Error("Unexpected query");
      return {
        kind: "catalog.search",
        nextCursor: null,
        threads: query.partition === "active" ? [thread("thread-10000000", "Needle project")] : [],
      };
    });
    const resource = new CatalogSearchResource({ execute });

    await resource.search("  NEEDLE  ", [savedServerId("server-a")]);

    expect(resource.snapshot().value.active.map((entry) => entry.thread.id)).toEqual([
      "thread-10000000",
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith("server-a", {
      cursor: null,
      kind: "catalog.search",
      limit: 40,
      partition: "active",
      text: "needle",
    });
    expect(execute).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "catalog.page" }),
    );
  });

  it("paginates matches instead of traversing or materializing the full catalog", async () => {
    const execute = vi
      .fn<(_server: string, query: V2Query) => Promise<V2QueryResult>>()
      .mockImplementation(async (_server, query) => {
        if (query.kind !== "catalog.search") throw new Error("Unexpected query");
        if (query.partition === "archived") {
          return { kind: "catalog.search", nextCursor: null, threads: [] };
        }
        return query.cursor === null
          ? { kind: "catalog.search", nextCursor: "next-match-page", threads: [thread("first")] }
          : { kind: "catalog.search", nextCursor: null, threads: [thread("second")] };
      });
    const resource = new CatalogSearchResource({ execute });

    await resource.search("match", [savedServerId("server-a")]);
    expect(resource.snapshot().value.canLoadMore.active).toBe(true);
    expect(resource.snapshot().value.active.map((entry) => entry.thread.id)).toEqual(["first"]);

    await resource.loadMore("active");
    expect(execute).toHaveBeenLastCalledWith(
      "server-a",
      expect.objectContaining({ cursor: "next-match-page", kind: "catalog.search" }),
    );
    expect(resource.snapshot().value.active.map((entry) => entry.thread.id)).toEqual([
      "first",
      "second",
    ]);
    expect(resource.snapshot().value.canLoadMore.active).toBe(false);
  });

  it("fans out All Servers independently without collapsing equal thread ids", async () => {
    const execute = vi.fn(async (server: string, query: V2Query): Promise<V2QueryResult> => {
      if (query.kind !== "catalog.search") throw new Error("Unexpected query");
      return {
        kind: "catalog.search",
        nextCursor: null,
        threads: query.partition === "active" ? [thread("shared-id", `${server} match`)] : [],
      };
    });
    const resource = new CatalogSearchResource({ execute });

    await resource.search("match", [savedServerId("server-a"), savedServerId("server-b")]);

    expect(resource.snapshot().value.active.map((entry) => entry.savedServerId)).toEqual([
      "server-a",
      "server-b",
    ]);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("rejects a non-advancing opaque cursor instead of refetching the same page", async () => {
    const execute = vi.fn(async (_server: string, query: V2Query): Promise<V2QueryResult> => {
      if (query.kind !== "catalog.search") throw new Error("Unexpected query");
      if (query.partition === "archived") {
        return { kind: "catalog.search", nextCursor: null, threads: [] };
      }
      return query.cursor === null
        ? { kind: "catalog.search", nextCursor: "same-page", threads: [thread("first")] }
        : { kind: "catalog.search", nextCursor: "same-page", threads: [thread("duplicate")] };
    });
    const resource = new CatalogSearchResource({ execute });

    await resource.search("match", [savedServerId("server-a")]);
    await resource.loadMore("active");

    expect(resource.snapshot().value.active.map((entry) => entry.thread.id)).toEqual(["first"]);
    expect(resource.snapshot().value.errors.active).toContain("cursor that did not advance");
  });

  it("discards obsolete server results after the query changes", async () => {
    const stale = deferred<V2QueryResult>();
    const execute = vi
      .fn<(_server: string, query: V2Query) => Promise<V2QueryResult>>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue({ kind: "catalog.search", nextCursor: null, threads: [] });
    const resource = new CatalogSearchResource({ execute });
    const first = resource.search("old", [savedServerId("server-a")]);
    await resource.search("new", []);
    stale.resolve({ kind: "catalog.search", nextCursor: null, threads: [thread("old")] });
    await first;

    expect(resource.snapshot().value.query).toBe("new");
    expect(resource.snapshot().value.active).toEqual([]);
  });

  it("refreshes the authoritative query after a target server reconnects", async () => {
    const server = savedServerId("server-a");
    const availability = new AvailabilitySource(server);
    const execute = vi
      .fn<(_server: string, query: V2Query) => Promise<V2QueryResult>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (_server, query) => {
        if (query.kind !== "catalog.search") throw new Error("Unexpected query");
        return {
          kind: "catalog.search",
          nextCursor: null,
          threads: query.partition === "active" ? [thread("fresh-after-reconnect")] : [],
        };
      });
    const resource = new CatalogSearchResource({ availability, execute });
    const unsubscribe = resource.subscribe(() => undefined);

    await resource.search("match", [server]);
    availability.connect();
    await vi.waitFor(() => {
      expect(resource.snapshot().value.active[0]?.thread.id).toBe("fresh-after-reconnect");
    });

    expect(execute).toHaveBeenCalledTimes(4);
    unsubscribe();
    expect(availability.listenerCount).toBe(0);
  });
});

class AvailabilitySource {
  readonly #listeners = new Set<() => void>();
  readonly #server: SavedServerId;
  #snapshot: ResourceSnapshot<ReadonlyMap<SavedServerId, ServerConnectionStatus>>;

  constructor(server: SavedServerId) {
    this.#server = server;
    this.#snapshot = {
      status: "ready",
      value: new Map([[server, { detail: null, state: "offline" }]]),
    };
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  snapshot = (): ResourceSnapshot<ReadonlyMap<SavedServerId, ServerConnectionStatus>> =>
    this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  connect(): void {
    this.#snapshot = {
      status: "ready",
      value: new Map([[this.#server, { detail: null, state: "connected" }]]),
    };
    for (const listener of this.#listeners) listener();
  }
}

function thread(id: string, title = "match"): V2ThreadSummary {
  return {
    archived: false,
    createdAt: "2026-09-01T00:00:00Z",
    headTurnId: null,
    id,
    lastActivityAt: "2026-09-01T00:00:00Z",
    parentId: null,
    preview: "catalog preview",
    readState: null,
    settings: null,
    state: "completed",
    title,
    updatedAt: "2026-09-01T00:00:00Z",
    workspace: "/workspace",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
