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
  it("does not let a stale list response undo an acknowledged pin change", async () => {
    const model = createRemoteProjectCatalogModel();
    let resolve!: (projects: RemoteProject[]) => void;
    const pending = new Promise<RemoteProject[]>((done) => { resolve = done; });
    const resource = model.resource("server", "live", async () => await pending);
    const pinned = { ...project("/repo"), pinned: true, name: "Custom label" };
    const added = { ...project("/new"), pinned: true };
    model.mergeProject("server", pinned);
    model.mergeProject("server", added);
    resolve([project("/repo"), project("/other")]);
    await resource.peek();
    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([pinned, project("/other"), added]);
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
    const refresh = new Promise<RemoteProject[]>((resolve) => { resolveRefresh = resolve; });

    model.resource("server", "live", async () => await refresh);

    expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/old")]);
    resolveRefresh([project("/new")]);
    await vi.waitFor(() => expect(model.snapshot$.projectsByConnection.peek().server).toEqual([project("/new")]));
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
