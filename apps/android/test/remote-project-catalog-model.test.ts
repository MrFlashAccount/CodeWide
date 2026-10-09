import { afterEach, describe, expect, it, vi } from "vitest";

import { createRemoteProjectCatalogModel } from "../src/data/remote-project-catalog-model";
import type { RemoteProject } from "../src/data/remote-projects";

const project = (path: string): RemoteProject => ({
  path,
  name: path.split("/").at(-1) ?? path,
  addedAt: 1,
  lastUsedAt: 1,
  pinned: false,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Legend remote project catalog", () => {
  it("keeps an acknowledgement published before the first catalog demand", async () => {
    const model = createRemoteProjectCatalogModel({
      cache: {
        read: async () => [project("/repo")],
        write: async () => undefined,
      },
    });
    const pinned = { ...project("/repo"), pinned: true };
    model.mergeProject("server", pinned);
    await model.resource("server", "connecting", null).peek();
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([pinned]);
    model.clear();
  });

  it.each([true, false])(
    "keeps acknowledged pinned=%s through stale refreshes until synchronization confirms it",
    async (pinned) => {
      const write = vi.fn(async () => undefined);
      const model = createRemoteProjectCatalogModel({ cache: { read: async () => [], write } });
      const stale = { ...project("/repo"), pinned: !pinned };
      await model.resource("server", "live", async () => [stale]).peek();
      const acknowledged = { ...stale, pinned, lastUsedAt: 2 };
      model.mergeProject("server", acknowledged);
      for (const revision of ["syncing", "live"]) {
        const writesBeforeRefresh = write.mock.calls.length;
        const refresh = Promise.withResolvers<RemoteProject[]>();
        model.resource("server", revision, async () => await refresh.promise);
        refresh.resolve([stale, project("/other")]);
        await vi.waitFor(() =>
          expect(write.mock.calls.length).toBeGreaterThan(writesBeforeRefresh),
        );
        await vi.waitFor(() =>
          expect(model.snapshot$.projectsByConnection.peek().server).toEqual([
            acknowledged,
            project("/other"),
          ]),
        );
      }
      model.resource("server", "confirmed", async () => [acknowledged]);
      await vi.waitFor(() =>
        expect(model.snapshot$.projectsByConnection.peek().server).toEqual([acknowledged]),
      );
      const external = {
        ...acknowledged,
        name: "Renamed elsewhere",
        pinned: !pinned,
        lastUsedAt: 3,
      };
      model.resource("server", "external", async () => [external]);
      await vi.waitFor(() =>
        expect(model.snapshot$.projectsByConnection.peek().server).toEqual([external]),
      );
      model.clear();
    },
  );

  it("does not count a read started before the latest acknowledgement as confirmation", async () => {
    const write = vi.fn(async () => undefined);
    const model = createRemoteProjectCatalogModel({ cache: { read: async () => [], write } });
    const initial = project("/repo");
    await model.resource("server", "live", async () => [initial]).peek();
    const pending = Promise.withResolvers<RemoteProject[]>();
    model.resource("server", "syncing", async () => await pending.promise);
    const pinned = { ...initial, pinned: true };
    model.mergeProject("server", pinned);
    model.mergeProject("server", initial);
    const writesBeforeRefresh = write.mock.calls.length;
    pending.resolve([initial]);
    await vi.waitFor(() => expect(write.mock.calls.length).toBeGreaterThan(writesBeforeRefresh));
    model.resource("server", "live", async () => [pinned]);
    await vi.waitFor(() =>
      expect(write.mock.calls.length).toBeGreaterThan(writesBeforeRefresh + 1),
    );
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([initial]);
    model.clear();
  });

  it("forgets only the deleted server and ignores its late refresh", async () => {
    const refresh = Promise.withResolvers<RemoteProject[]>();
    const deleteCached = vi.fn(async () => undefined);
    const model = createRemoteProjectCatalogModel({
      cache: {
        delete: deleteCached,
        read: async (connectionId) => [project(`/${connectionId}`)],
        write: async () => undefined,
      },
    });
    await Promise.all([
      model.resource("removed", "connecting", null).peek(),
      model.resource("kept", "connecting", null).peek(),
    ]);
    model.resource("removed", "live", async () => await refresh.promise);
    await model.forgetConnection("removed");
    refresh.resolve([project("/late")]);
    await Promise.resolve();
    expect(deleteCached).toHaveBeenCalledExactlyOnceWith("removed");
    expect(model.snapshot$.projectsByConnection.peek()).toEqual({ kept: [project("/kept")] });
    model.clear();
  });

  it("publishes the durable catalog before a connection can refresh it", async () => {
    const cached = { ...project("/cached"), pinned: true };
    const write = vi.fn(async () => undefined);
    const model = createRemoteProjectCatalogModel({
      cache: {
        read: async () => [cached],
        write,
      },
    });

    await model.resource("server", "connecting", null).peek();
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([cached]);

    const refresh = Promise.withResolvers<RemoteProject[]>();
    model.resource("server", "live", async () => await refresh.promise);
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([cached]);
    refresh.resolve([project("/fresh")]);

    await vi.waitFor(() =>
      expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/fresh")]),
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("server", [project("/fresh")]));
    model.clear();
  });

  it("does not let delayed cache hydration undo an acknowledged project change", async () => {
    const cache = Promise.withResolvers<RemoteProject[]>();
    const model = createRemoteProjectCatalogModel({
      cache: {
        read: async () => await cache.promise,
        write: async () => undefined,
      },
    });
    const resource = model.resource("server", "connecting", null);
    const pinned = { ...project("/cached"), pinned: true };
    model.mergeProject("server", pinned);
    cache.resolve([project("/cached")]);

    await resource.peek();

    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([pinned]);
    model.clear();
  });

  it("starts the authoritative refresh without waiting for cache hydration", async () => {
    const cache = Promise.withResolvers<RemoteProject[]>();
    const refresh = Promise.withResolvers<RemoteProject[]>();
    let loads = 0;
    const model = createRemoteProjectCatalogModel({
      cache: {
        read: async () => await cache.promise,
        write: async () => undefined,
      },
    });
    const resource = model.resource("server", "live", async () => {
      loads += 1;
      return refresh.promise;
    });

    await vi.waitFor(() => expect(loads).toBe(1));
    refresh.resolve([project("/fresh")]);
    await vi.waitFor(() =>
      expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/fresh")]),
    );

    cache.resolve([{ ...project("/stale"), pinned: true }]);
    await resource.peek();
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/fresh")]);
    model.clear();
  });

  it("does not let a stale list response undo an acknowledged pin change", async () => {
    const model = createRemoteProjectCatalogModel();
    let resolve!: (projects: RemoteProject[]) => void;
    const pending = new Promise<RemoteProject[]>((done) => {
      resolve = done;
    });
    const resource = model.resource("server", "live", async () => await pending);
    const pinned = { ...project("/repo"), pinned: true, name: "Custom label" };
    const added = { ...project("/new"), pinned: true };
    model.mergeProject("server", pinned);
    model.mergeProject("server", added);
    resolve([project("/repo"), project("/other")]);
    await resource.peek();
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([
      pinned,
      project("/other"),
      added,
    ]);
    model.clear();
  });
  it("deduplicates initial demand and publishes the resolved catalog", async () => {
    const model = createRemoteProjectCatalogModel();
    let loads = 0;
    const first = model.resource("server", "live", async () => {
      loads += 1;
      return [project("/repo")];
    });
    const duplicate = model.resource("server", "live", async () => {
      loads += 1;
      return [];
    });

    await first.peek();

    expect(duplicate).toBe(first);
    expect(loads).toBe(1);
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/repo")]);
  });

  it("keeps stale data while a reconnect refresh is pending", async () => {
    const model = createRemoteProjectCatalogModel();
    await model.resource("server", "syncing", async () => [project("/old")]).peek();
    let resolveRefresh!: (projects: RemoteProject[]) => void;
    const refresh = new Promise<RemoteProject[]>((resolve) => {
      resolveRefresh = resolve;
    });

    model.resource("server", "live", async () => await refresh);

    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/old")]);
    resolveRefresh([project("/new")]);
    await vi.waitFor(() =>
      expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/new")]),
    );
  });

  it("retries a failed demanded catalog without requiring a connection revision", async () => {
    vi.useFakeTimers();
    const model = createRemoteProjectCatalogModel();
    let attempts = 0;
    model.resource("server", "live", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return [project("/repo")];
    });
    const release = model.retain("server");

    await vi.advanceTimersByTimeAsync(0);
    expect(model.snapshot$.errorsByConnection.peek().server).toBe("offline");

    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBe(2);
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/repo")]);
    expect(model.snapshot$.errorsByConnection.peek().server).toBeNull();

    release();
    model.clear();
  });
});
