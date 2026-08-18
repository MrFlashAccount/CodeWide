import { describe, expect, it } from "vitest";

import { DurableCommitTracker, persistDurablyWithRetry } from "../src/data/durable-commit-tracker";

describe("durable commit tracker", () => {
  it("does not resolve a projection commit before the persistence adapter finishes", async () => {
    const tracker = new DurableCommitTracker();
    let release!: () => void;
    const adapter = new Promise<void>((resolve) => { release = resolve; });
    let committed = false;
    const durable = tracker.track("threads", () => { committed = true; });
    let resolved = false;
    void durable.then(() => { resolved = true; });

    const observed = tracker.observe("threads", async () => await adapter);
    await Promise.resolve();
    expect(committed).toBe(true);
    expect(resolved).toBe(false);

    release();
    await observed;
    await durable;
    expect(resolved).toBe(true);
  });

  it("rejects the projection commit when SQLite persistence fails", async () => {
    const tracker = new DurableCommitTracker();
    const durable = tracker.track("threads", () => {});
    const durableFailure = expect(durable).rejects.toThrow("disk failure");

    await expect(tracker.observe("threads", async () => {
      throw new Error("disk failure");
    })).rejects.toThrow("disk failure");
    await durableFailure;
  });

  it("matches concurrent commits to adapter writes in collection order", async () => {
    const tracker = new DurableCommitTracker();
    const order: string[] = [];
    const first = tracker.track("threads", () => { order.push("commit-1"); });
    const second = tracker.track("threads", () => { order.push("commit-2"); });

    await tracker.observe("threads", async () => { order.push("persist-1"); });
    await first;
    expect(order).toEqual(["commit-1", "commit-2", "persist-1"]);
    await tracker.observe("threads", async () => { order.push("persist-2"); });
    await second;
    expect(order).toEqual(["commit-1", "commit-2", "persist-1", "persist-2"]);
  });

  it("keeps the native cursor blocked and retries the same durable transaction", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await persistDurablyWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("sqlite busy");
      },
      { wait: async (delayMs) => { delays.push(delayMs); } },
    );

    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });
});
