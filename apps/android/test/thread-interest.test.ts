import { describe, expect, it, vi } from "vitest";

import { createThreadChatModel } from "../src/data/thread-chat-model";
import { createThreadInterestPort } from "../src/data/threadSyncInterest";
import { createThreadSyncRemoteLoader } from "../src/data/thread-sync-remote-loader";
import type { ThreadDetailDatabase } from "../src/data/thread-detail-database";
import type { createThreadSyncRuntime } from "../src/data/thread-sync-runtime";

const settle = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function membershipModel() {
  const changes: Array<[string, boolean]> = [];
  const model = createThreadChatModel({
    onInterestChange: (_connectionId, threadId, interested) => {
      changes.push([threadId, interested]);
    },
  });
  return { changes, model };
}

describe("thread chat interest membership", () => {
  it("subscribes on retain and unsubscribes only at the settled release point", async () => {
    const { changes, model } = membershipModel();
    const release = model.retainWindow("server", "a");
    expect(changes).toEqual([["a", true]]);

    release();
    const retainedAgain = model.retainWindow("server", "a");
    await settle();
    expect(changes).toEqual([["a", true]]);

    retainedAgain();
    await settle();
    expect(changes).toEqual([
      ["a", true],
      ["a", false],
    ]);
  });

  it("keeps the resident resource subscribed and releases a replaced one", async () => {
    const { changes, model } = membershipModel();
    const loader = vi.fn(async () => new Promise<never>(() => undefined));
    model.resource({ anchorTurnId: null, connectionId: "server", threadId: "a" }, loader);
    expect(changes).toEqual([["a", true]]);

    model.resource({ anchorTurnId: null, connectionId: "server", threadId: "b" }, loader);
    expect(changes).toEqual([
      ["a", true],
      ["b", true],
    ]);
    await settle();
    expect(changes).toEqual([
      ["a", true],
      ["b", true],
      ["a", false],
    ]);
  });

  it("releases every subscription on close and on a forgotten connection", () => {
    const { changes, model } = membershipModel();
    model.retainWindow("server", "a");
    model.retainWindow("other", "b");

    model.forgetConnection("server");
    expect(changes).toContainEqual(["a", false]);
    expect(changes).not.toContainEqual(["b", false]);

    model.close();
    expect(changes).toContainEqual(["b", false]);
  });
});

describe("thread interest port", () => {
  it("collapses changes of one task into one full-set declaration", async () => {
    const declare = vi.fn(async () => undefined);
    const port = createThreadInterestPort(declare);

    port.update("server", "a", true);
    port.update("server", "b", true);
    port.update("server", "a", false);
    await port.declared("server", "b");

    expect(declare).toHaveBeenCalledExactlyOnceWith("server", ["b"]);
  });

  it("waits for the declaration that contains the thread and retries a failed one", async () => {
    const first = deferred();
    const declare = vi
      .fn<(connectionId: string, threadIds: readonly string[]) => Promise<void>>()
      .mockImplementationOnce(async () => {
        await first.promise;
        throw new Error("Connection service is not running");
      })
      .mockResolvedValue(undefined);
    const port = createThreadInterestPort(declare);

    port.update("server", "a", true);
    const failed = port.declared("server", "a");
    await port.declared("server", "unsubscribed");
    first.resolve();
    await expect(failed).rejects.toThrow("not running");

    await port.declared("server", "a");
    expect(declare).toHaveBeenLastCalledWith("server", ["a"]);
    expect(declare).toHaveBeenCalledTimes(2);
  });
});

describe("thread sync remote loader", () => {
  it("awaits the interest declaration before the authoritative thread sync", async () => {
    const order: string[] = [];
    const declaration = deferred();
    const interest = createThreadInterestPort(async (_connectionId, threadIds) => {
      order.push(`declare:${threadIds.join(",")}`);
      await declaration.promise;
      order.push("declared");
    });
    const readThread = vi.fn(async () => {
      order.push("thread/sync");
      return null;
    });
    // WHY: The loader reads only these runtime members on the tested paths.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const sync = { interest, readThread } as unknown as ReturnType<typeof createThreadSyncRuntime>;
    // WHY: hydrateWindow does not touch the detail database.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const loader = createThreadSyncRemoteLoader({} as ThreadDetailDatabase, sync);

    loader.ensureInterest({ connectionId: "server", threadId: "a" });
    const hydration = loader.hydrateWindow({
      cachedThread: null,
      reason: "activation",
      request: { anchorTurnId: null, connectionId: "server", threadId: "a" },
      requireAuthoritative: true,
    });
    await settle();
    expect(order).toEqual(["declare:a"]);

    declaration.resolve();
    await hydration;
    expect(order).toEqual(["declare:a", "declared", "thread/sync"]);
  });

  it("repairs a projection without declaring interest", async () => {
    const declare = vi.fn(async () => undefined);
    const repairThreadProjection = vi.fn(async () => ({ nextCursor: null, thread: {} }));
    // WHY: The loader reads only these runtime members on the tested paths.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const sync = {
      interest: createThreadInterestPort(declare),
      repairThreadProjection,
    } as unknown as ReturnType<typeof createThreadSyncRuntime>;
    // WHY: repairProjection does not touch the detail database.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const loader = createThreadSyncRemoteLoader({} as ThreadDetailDatabase, sync);

    await loader.repairProjection({ connectionId: "server", threadId: "a" });
    await settle();

    expect(repairThreadProjection).toHaveBeenCalledOnce();
    expect(declare).not.toHaveBeenCalled();
  });
});
