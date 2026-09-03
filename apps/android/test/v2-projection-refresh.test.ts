import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  type V2Projection,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { ProjectionResource } from "../src/v2/application/resources/projectionResource";
import type { ProjectionRefreshState } from "../src/v2/application/resources/projectionRefreshActivity";

describe("ProjectionResource refresh activity", () => {
  it("preserves the published projection snapshot while a background read is pending", async () => {
    const pending = deferred<V2Projection | null>();
    const store = new MemoryV2ProjectionStore();
    vi.spyOn(store, "retained")
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => pending.promise);
    const resource = new ProjectionResource("saved-server", store, new MemoryV2OperationStore());
    await resource.refresh();
    const published = resource.snapshot();

    const refresh = resource.refresh();
    expect(resource.snapshot()).toBe(published);
    expect(resource.refreshSnapshot()).toEqual({ inFlight: 1, status: "refreshing" });

    pending.resolve(null);
    await refresh;
    expect(resource.refreshSnapshot()).toEqual({ status: "idle" });
  });

  it("stays refreshing until every overlapping read settles without accepting a stale error", async () => {
    const older = deferred<V2Projection | null>();
    const newer = deferred<V2Projection | null>();
    const store = new MemoryV2ProjectionStore();
    vi.spyOn(store, "retained")
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const resource = new ProjectionResource("saved-server", store, new MemoryV2OperationStore());
    const observed: ProjectionRefreshState[] = [];
    resource.subscribeRefresh(() => observed.push(resource.refreshSnapshot()));

    const olderRefresh = resource.refresh();
    expect(resource.refreshSnapshot()).toEqual({ inFlight: 1, status: "refreshing" });
    const newerRefresh = resource.refresh();
    expect(resource.refreshSnapshot()).toEqual({ inFlight: 2, status: "refreshing" });

    newer.resolve(null);
    await newerRefresh;
    expect(resource.snapshot().status).toBe("ready");
    expect(resource.refreshSnapshot()).toEqual({ inFlight: 1, status: "refreshing" });

    older.reject(new Error("stale read failed"));
    await olderRefresh;
    expect(resource.snapshot().status).toBe("ready");
    expect(resource.refreshSnapshot()).toEqual({ status: "idle" });
    expect(observed).toEqual([
      { inFlight: 1, status: "refreshing" },
      { inFlight: 2, status: "refreshing" },
      { inFlight: 1, status: "refreshing" },
      { status: "idle" },
    ]);
  });

  it("keeps the newest refresh error authoritative while an older read is still running", async () => {
    const older = deferred<V2Projection | null>();
    const newer = deferred<V2Projection | null>();
    const store = new MemoryV2ProjectionStore();
    vi.spyOn(store, "retained")
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const resource = new ProjectionResource("saved-server", store, new MemoryV2OperationStore());

    const olderRefresh = resource.refresh();
    const newerRefresh = resource.refresh();
    newer.reject(new Error("latest read failed"));
    await newerRefresh;

    expect(resource.snapshot()).toEqual({
      message: "Could not read server projection",
      status: "error",
      value: {
        operations: [],
        projections: { live: null, retained: null },
        state: "offline",
        version: 0,
      },
    });
    expect(resource.refreshSnapshot()).toEqual({ inFlight: 1, status: "refreshing" });

    older.resolve(null);
    await olderRefresh;
    expect(resource.snapshot().status).toBe("error");
    expect(resource.refreshSnapshot()).toEqual({ status: "idle" });
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  reject(cause: Error): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (cause: Error) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete, fail) => {
    reject = fail;
    resolve = complete;
  });
  return { promise, reject, resolve };
}
