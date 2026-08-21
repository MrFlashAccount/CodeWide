import { describe, expect, it } from "vitest";

import { createThreadProjectionStore } from "../src/data/thread-projection-store";

describe("thread projection store", () => {
  it("durably applies detail before publishing the summary lifecycle", async () => {
    const order: string[] = [];
    const threads = new Map();
    const store = createThreadProjectionStore({
      details: {
        async applySnapshot() { order.push("detail-snapshot"); },
        async applyEvents() {
          order.push("detail-events");
          return { checkpoint: Promise.resolve(), threads };
        },
      },
      summaries: {
        async applySnapshot() { order.push("summary-snapshot"); },
        async applyEvents() { order.push("summary-events"); },
      },
    });

    const projected = await store.applyEvents("server", []);
    await store.applySnapshot("server", [], 0);

    expect(order).toEqual(["detail-events", "summary-events", "detail-snapshot", "summary-snapshot"]);
    expect(projected.threads).toBe(threads);
  });

  it("does not publish summary state or acknowledge success after detail persistence fails", async () => {
    let summaryApplied = false;
    const store = createThreadProjectionStore({
      details: {
        async applySnapshot() { throw new Error("detail persistence failed"); },
        async applyEvents() { throw new Error("detail persistence failed"); },
      },
      summaries: {
        async applySnapshot() { summaryApplied = true; },
        async applyEvents() { summaryApplied = true; },
      },
    });

    await expect(store.applyEvents("server", [])).rejects.toThrow("detail persistence failed");
    expect(summaryApplied).toBe(false);
  });
});
