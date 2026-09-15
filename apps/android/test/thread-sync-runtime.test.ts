import { describe, expect, it, vi } from "vitest";
import { createThreadSyncRuntime } from "../src/data/thread-sync-runtime";
import { createThreadSyncForeground } from "../src/data/thread-sync-foreground";

function runtime() {
  return createThreadSyncRuntime({
    getDetails: () => null,
    getSummaries: () => null,
    getSession: () => undefined,
    rpcAfterAttach: async () => {
      throw new Error("no authenticated session");
    },
    refreshSubagents: async () => undefined,
    loadTurnControls: async () => {
      throw new Error("no controls");
    },
    transferAccess: async () => {
      throw new Error("no transfer authority");
    },
    readInvalidationArchived: () => undefined,
    clearInvalidationArchived: () => undefined,
    refreshThreadCatalog: async () => undefined,
  });
}

describe("V1 shared thread sync lifetime", () => {
  it("retains main observation per connection while child reads leave it unchanged", async () => {
    const sync = runtime();
    await sync.observeThread("first", "main");
    await sync.observeThread("second", "other");
    await sync.observeThread("first", "child", false);
    expect(sync.desiredThreadId("first")).toBe("main");
    expect(sync.desiredThreadId("second")).toBe("other");
    sync.forgetObservedThread("first");
    expect(sync.desiredThreadId("first")).toBeUndefined();
    expect(sync.desiredThreadId("second")).toBe("other");
    await sync.observeThread("first", "replacement");
    expect(sync.desiredThreadId("first")).toBe("replacement");
  });

  it("releases a rejected read lane for subsequent activation", async () => {
    const sync = runtime();
    await expect(sync.readThread("server", "thread")).rejects.toThrow(
      "Thread history database is not available",
    );
    await expect(sync.readThread("server", "thread", undefined, true)).rejects.toThrow(
      "Thread history database is not available",
    );
  });

  it("runs a fresh authoritative foreground pass after an older pass settles", async () => {
    const release = Promise.withResolvers<void>();
    const calls: string[] = [];
    let reads = 0;
    const bind = createThreadSyncForeground({
      desiredThreadId: () => "thread",
      refreshThreadCatalog: async (id, force) => {
        expect(force).toBe(true);
        calls.push(`catalog:${id}`);
      },
      readThread: async (id, threadId, _cached, authoritative) => {
        expect(authoritative).toBe(true);
        calls.push(`thread:${id}:${threadId}`);
        if (++reads === 1) await release.promise;
        return null;
      },
    });
    const repair = bind({
      reattachRuntime: async (id) => {
        calls.push(`attach:${id}`);
      },
    });
    const first = repair("server");
    const second = repair("server");
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(calls).toEqual(["attach:server", "catalog:server", "thread:server:thread"]);
    release.resolve();
    await Promise.all([first, second]);
    expect(calls).toEqual([
      "attach:server",
      "catalog:server",
      "thread:server:thread",
      "attach:server",
      "catalog:server",
      "thread:server:thread",
    ]);
  });
});
