import { RpcResponseError, type RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { subscribeMissingThreads } from "../src/data/missingThread";
import type { ThreadDetailDatabase } from "../src/data/thread-detail-database-contract";
import type { ThreadSummaryDatabase } from "../src/data/thread-summary-database-contract";
import { createThreadSyncRuntime } from "../src/data/thread-sync-runtime";
import { createThreadSyncForeground } from "../src/data/thread-sync-foreground";
import { createV1TestThread } from "./fixtures/v1Thread";

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
    declareInterest: async () => undefined,
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

  it("releases live observation only after its final owner and never clears a replacement", async () => {
    const sync = runtime();
    const releaseFirst = sync.retainObservedThread("server", "main");
    const releaseSecond = sync.retainObservedThread("server", "main");

    releaseFirst();
    expect(sync.desiredThreadId("server")).toBe("main");
    releaseSecond();
    expect(sync.desiredThreadId("server")).toBeUndefined();

    const releaseOld = sync.retainObservedThread("server", "old");
    await sync.observeThread("server", "replacement");
    releaseOld();
    expect(sync.desiredThreadId("server")).toBe("replacement");
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

  it("forgets a thread the Companion no longer has and reports it missing", async () => {
    const session = {};
    const done = () => undefined;
    // WHY: the read touches only these members before the RPC fails; a full detail database is SQLite-backed.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const details = {
      beginProjectionSnapshot: () => done,
      chat: { beginBackendRefresh: () => done },
      getThread: () => null,
      historyCursor: () => null,
      historySourceWitness: () => undefined,
      latestSealedTurnId: async () => null,
      liveRevision: () => 0,
    } as unknown as ThreadDetailDatabase;
    const removed: [string, readonly string[]][] = [];
    // WHY: only catalog removal is reachable after a not-found read.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const summaries = {
      removeCatalogEntries: async (connectionId: string, threadIds: readonly string[]) => {
        removed.push([connectionId, threadIds]);
      },
    } as unknown as ThreadSummaryDatabase;
    const sync = createThreadSyncRuntime({
      clearInvalidationArchived: () => undefined,
      declareInterest: async () => undefined,
      getDetails: () => details,
      // WHY: the session is only compared by identity; the RPC goes through rpcAfterAttach.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      getSession: () => session as RpcClient,
      getSummaries: () => summaries,
      loadTurnControls: async () => {
        throw new Error("no controls");
      },
      readInvalidationArchived: () => undefined,
      refreshSubagents: async () => undefined,
      refreshThreadCatalog: async () => undefined,
      rpcAfterAttach: async () => {
        throw new RpcResponseError(-32_073, "thread not found: gone");
      },
      transferAccess: async () => {
        throw new Error("no transfer authority");
      },
    });
    const missing: string[] = [];
    const unsubscribe = subscribeMissingThreads((connectionId, threadId) => {
      missing.push(`${connectionId}/${threadId}`);
    });
    try {
      await expect(sync.readThread("server", "gone", undefined, true)).rejects.toThrow(
        "thread not found: gone",
      );
    } finally {
      unsubscribe();
    }
    expect(removed).toEqual([["server", ["gone"]]]);
    expect(missing).toEqual(["server/gone"]);
  });
});

const settle = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function interestRuntime(options: {
  declareInterest: (connectionId: string, threadIds: readonly string[]) => Promise<void>;
  getSession: () => RpcClient | undefined;
  rpc: (method: string) => void;
}) {
  const done = () => undefined;
  const cached = createV1TestThread("a", null, 1, []);
  // WHY: readThread touches only these members on the cached-read and pre-sync paths; a full detail database is SQLite-backed.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const details = {
    beginProjectionSnapshot: () => done,
    chat: { beginBackendRefresh: () => done },
    getThread: () => cached,
    hasPendingDelivery: () => false,
    historyCursor: () => null,
    historySourceWitness: () => undefined,
    latestSealedTurnId: async () => null,
    liveRevision: () => 0,
    reconcileNativeCommands: async () => undefined,
  } as unknown as ThreadDetailDatabase;
  const sync = createThreadSyncRuntime({
    clearInvalidationArchived: () => undefined,
    declareInterest: options.declareInterest,
    getDetails: () => details,
    getSession: options.getSession,
    getSummaries: () => null,
    loadTurnControls: async () => {
      throw new Error("no controls");
    },
    readInvalidationArchived: () => undefined,
    refreshSubagents: async () => undefined,
    refreshThreadCatalog: async () => undefined,
    rpcAfterAttach: async (_session, method) => {
      options.rpc(method);
      throw new Error("sync stopped by test");
    },
    transferAccess: async () => {
      throw new Error("no transfer authority");
    },
  });
  return { cached, sync };
}

describe("readThread interest ordering", () => {
  it("serves the cache without a session and declares nothing", async () => {
    const declareInterest = vi.fn(async () => {
      throw new Error("Workspace sync supervisor is not running");
    });
    const rpcs: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { cached, sync } = interestRuntime({
        declareInterest,
        getSession: () => undefined,
        rpc: (method) => rpcs.push(method),
      });
      // The window's membership change is declared and rejected before any read.
      sync.interest.update("server", "a", true);
      await settle();
      declareInterest.mockClear();
      warn.mockClear();

      await expect(sync.readThread("server", "a")).resolves.toEqual({
        nextCursor: null,
        thread: cached,
      });
      await settle();

      expect(declareInterest).not.toHaveBeenCalled();
      expect(rpcs).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
      expect(sync.interest.threadIds("server")).toEqual(["a"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("issues companion/thread/sync only after the pending declaration resolves", async () => {
    const declaration = Promise.withResolvers<void>();
    const declareInterest = vi.fn(async () => declaration.promise);
    const rpcs: string[] = [];
    const session = {};
    const { sync } = interestRuntime({
      declareInterest,
      // WHY: the session is only compared by identity; the RPC goes through rpcAfterAttach.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      getSession: () => session as RpcClient,
      rpc: (method) => rpcs.push(method),
    });
    sync.interest.update("server", "a", true);

    const read = sync.readThread("server", "a");
    await settle();
    expect(declareInterest).toHaveBeenCalledExactlyOnceWith("server", ["a"]);
    expect(rpcs).toEqual([]);

    declaration.resolve();
    await expect(read).rejects.toThrow("sync stopped by test");
    expect(rpcs).toEqual(["companion/thread/sync"]);
  });

  it("re-sends a declaration rejected before the session existed and awaits it before sync", async () => {
    const retried = Promise.withResolvers<void>();
    const declareInterest = vi
      .fn<(connectionId: string, threadIds: readonly string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Workspace sync supervisor is not running"))
      .mockImplementationOnce(async () => retried.promise);
    const rpcs: string[] = [];
    let session: RpcClient | undefined;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { sync } = interestRuntime({
        declareInterest,
        getSession: () => session,
        rpc: (method) => rpcs.push(method),
      });
      sync.interest.update("server", "a", true);
      await settle();
      expect(declareInterest).toHaveBeenCalledOnce();

      // WHY: the session is only compared by identity; the RPC goes through rpcAfterAttach.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      session = {} as RpcClient;
      const read = sync.readThread("server", "a");
      await settle();
      expect(declareInterest).toHaveBeenCalledTimes(2);
      expect(declareInterest).toHaveBeenLastCalledWith("server", ["a"]);
      expect(rpcs).toEqual([]);

      retried.resolve();
      await expect(read).rejects.toThrow("sync stopped by test");
      expect(rpcs).toEqual(["companion/thread/sync"]);
      expect(sync.interest.threadIds("server")).toEqual(["a"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects with the declaration error and never syncs when a live declaration fails", async () => {
    const failure = new Error("interest declaration rejected by test");
    const declareInterest = vi.fn(async () => {
      throw failure;
    });
    const rpcs: string[] = [];
    const session = {};
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { sync } = interestRuntime({
        declareInterest,
        // WHY: the session is only compared by identity; the RPC goes through rpcAfterAttach.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        getSession: () => session as RpcClient,
        rpc: (method) => rpcs.push(method),
      });
      sync.interest.update("server", "a", true);

      await expect(sync.readThread("server", "a")).rejects.toBe(failure);
      await settle();

      expect(declareInterest).toHaveBeenCalledWith("server", ["a"]);
      expect(rpcs).toEqual([]);
      expect(sync.interest.threadIds("server")).toEqual(["a"]);
    } finally {
      warn.mockRestore();
    }
  });
});
