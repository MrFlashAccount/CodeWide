import { describe, expect, it, vi } from "vitest";

import { createThreadResourcesModel } from "../src/data/thread-resources-model";
import type { ThreadResourcesRow } from "../src/data/workspace-resource-database";

function row(id: string, updatedAt: number): ThreadResourcesRow {
  return {
    id,
    connectionId: "server",
    threadId: id,
    status: "ready",
    value: {
      threadId: id,
      revision: `${updatedAt}`,
      changeScope: "session",
      changeScopes: ["session"],
      changes: [],
      attachments: [],
    },
    error: null,
    updatedAt,
  };
}

describe("Legend thread resources model", () => {
  it("owns and deduplicates the initial async resource", async () => {
    const model = createThreadResourcesModel();
    let loads = 0;
    const ready = model.resource("one", "syncing", async () => {
      loads += 1;
      model.put(row("one", 1));
    });
    const same = model.resource("one", "syncing", async () => {
      loads += 1;
    });

    await ready.peek();

    expect(same).toBe(ready);
    expect(loads).toBe(1);
    expect(model.get("one")?.status).toBe("ready");
  });

  it("updates only the addressed thread resource", () => {
    const model = createThreadResourcesModel();
    model.put(row("one", 1));
    model.put(row("two", 2));
    model.put({ ...row("one", 3), status: "loading" });

    expect(model.get("one")?.status).toBe("loading");
    expect(model.get("two")?.status).toBe("ready");
  });

  it("keeps the ready value while a new connection revision refreshes", async () => {
    const model = createThreadResourcesModel();
    await model.resource("one", "syncing", async () => model.put(row("one", 1))).peek();
    let resolveRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { resolveRefresh = resolve; });

    model.resource("one", "live", async () => {
      await refresh;
      model.put(row("one", 2));
    });

    expect(model.get("one")?.updatedAt).toBe(1);
    resolveRefresh();
    await vi.waitFor(() => expect(model.get("one")?.updatedAt).toBe(2));
  });

  it("reconciles equal resource content across refresh rows", () => {
    const model = createThreadResourcesModel();
    model.put(row("one", 1));
    const previousChanges = model.get("one")?.value?.changes;
    const previousAttachments = model.get("one")?.value?.attachments;

    model.put(row("one", 2));

    expect(model.get("one")?.value?.changes).toBe(previousChanges);
    expect(model.get("one")?.value?.attachments).toBe(previousAttachments);
    expect(model.get("one")?.updatedAt).toBe(2);
  });

  it("bounds resident resources by least recent update", () => {
    const model = createThreadResourcesModel(2);
    model.put(row("one", 1));
    model.put(row("two", 2));
    model.put(row("three", 3));

    expect(model.get("one")).toBeUndefined();
    expect(model.get("two")?.threadId).toBe("two");
    expect(model.get("three")?.threadId).toBe("three");
  });

  it("does not evict the resource owned by the active conversation", () => {
    const model = createThreadResourcesModel(2);
    const release = model.retain("one");
    model.put(row("one", 1));
    model.put(row("two", 2));
    model.put(row("three", 3));

    expect(model.get("one")?.threadId).toBe("one");
    expect(model.get("two")).toBeUndefined();
    release();
  });
});
