import { describe, expect, it } from "vitest";

import { createThreadProjectionStore } from "../src/data/thread-projection-store";

describe("thread projection store", () => {
  it("normalizes a persisted metadata-only snapshot before either projection reads turns", async () => {
    const projectedTurnLengths: number[] = [];
    const store = createThreadProjectionStore({
      details: {
        async applySnapshot(_connectionId, snapshots) {
          projectedTurnLengths.push(snapshots[0]!.thread.turns.length);
        },
        async applyEvents() {
          return { checkpoint: Promise.resolve(), threads: new Map() };
        },
      },
      summaries: {
        async applySnapshot(_connectionId, snapshots) {
          projectedTurnLengths.push(snapshots[0]!.thread.turns.length);
        },
        async applyEvents() {},
      },
    });
    const persistedSnapshot = {
      archived: false,
      thread: {
        id: "thread",
        name: "Thread",
        preview: "",
        cwd: "/repo",
        updatedAt: 1,
        status: { type: "idle" },
      },
    } as never;

    await store.applySnapshot("server", [persistedSnapshot], 1);

    expect(projectedTurnLengths).toEqual([0, 0]);
  });

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

  it("does not publish terminal summary state before the detail checkpoint resolves", async () => {
    let resolveCheckpoint!: () => void;
    const checkpoint = new Promise<void>((resolve) => { resolveCheckpoint = resolve; });
    let summaryApplied = false;
    const store = createThreadProjectionStore({
      details: {
        async applySnapshot() {},
        async applyEvents() { return { checkpoint, threads: new Map() }; },
      },
      summaries: {
        async applySnapshot() {},
        async applyEvents() { summaryApplied = true; },
      },
    });

    const applying = store.applyEvents("server", []);
    await Promise.resolve();
    expect(summaryApplied).toBe(false);
    resolveCheckpoint();
    await applying;
    expect(summaryApplied).toBe(true);
  });

  it("repairs the detail projection before publishing its terminal summary", async () => {
    const order: string[] = [];
    const store = createThreadProjectionStore({
      details: {
        async applySnapshot() {},
        async applyEvents() {
          order.push("detail");
          return { checkpoint: Promise.resolve().then(() => { order.push("checkpoint"); }), threads: new Map() };
        },
      },
      async reconcileBeforeSummary(_connectionId, _events, projected) {
        order.push("repair");
        return projected;
      },
      summaries: {
        async applySnapshot() {},
        async applyEvents() { order.push("summary"); },
      },
    });

    await store.applyEvents("server", []);
    expect(order).toEqual(["detail", "checkpoint", "repair", "summary"]);
  });
});
