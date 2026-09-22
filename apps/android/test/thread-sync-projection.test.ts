import type { SyncEvent } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { createThreadSyncProjection } from "../src/data/thread-sync-projection";
import { projectThreadSummaryEvent } from "../src/data/thread-summary-projection";
import { summary } from "./fixtures/thread-summary";

type Ports = Parameters<typeof createThreadSyncProjection>[0];
function harness(initial = summary("worker", { status: { type: "active", activeFlags: [] } })) {
  let current: ReturnType<typeof summary> | null = initial;
  const refreshConnectionWindows = vi.fn();
  const get = vi.fn(async () => current);
  // WHY: The test exercises the real ordered projection through its catalog-facing
  // ports; unrelated command, account and snapshot operations are not invoked.
  const ports = {
    accountRateLimits: {},
    catalog: { refreshConnectionWindows, refreshInvalidatedThread: vi.fn() },
    details: { applyEvents: async () => ({ checkpoint: Promise.resolve(), threads: new Map() }) },
    resources: { threadResources: new Map() },
    summaries: {
      get,
      async applyEvents(connectionId: string, events: SyncEvent[]) {
        for (const event of events) {
          const mutation = projectThreadSummaryEvent(
            connectionId,
            event.payload,
            () => current ?? undefined,
          );
          if (mutation !== null) current = mutation.value;
        }
      },
    },
    sync: {},
  } as unknown as Ports;
  return {
    store: createThreadSyncProjection(ports),
    refreshConnectionWindows,
    get,
    read: () => current,
    remove: () => {
      current = null;
    },
  };
}
function progress(cursor: number, method = "companion/thread/progress"): SyncEvent {
  return {
    cursor,
    payload: {
      method,
      params: { threadId: "worker", archived: false, turnActive: true },
      codewideThreadPatch: {
        version: 1,
        threadId: "worker",
        operation: {
          kind: method === "companion/thread/invalidated" ? "threadInvalidated" : "threadProgress",
          summary: { activity: true, previewText: `Progress ${cursor}` },
        },
      },
    },
  };
}

describe("live progress catalog demand", () => {
  it("updates a known active chat without reloading catalog pages on every progress event", async () => {
    const test = harness();
    for (let cursor = 1; cursor <= 100; cursor += 1) {
      await test.store.applyEvents("server", [progress(cursor)]);
    }
    expect(test.read()?.preview).toBe("Progress 100");
    expect(test.refreshConnectionWindows).not.toHaveBeenCalled();
  });

  it("coalesces a batch's metadata lookup and preserves terminal repair", async () => {
    const test = harness();
    await test.store.applyEvents("server", [progress(1), progress(2), progress(3)]);
    expect(test.get).toHaveBeenCalledTimes(1);
    await test.store.applyEvents("server", [progress(4, "companion/thread/invalidated")]);
    expect(test.refreshConnectionWindows).toHaveBeenCalledExactlyOnceWith("server");
  });

  it("discovers an unknown chat and repairs changed activity or archive membership", async () => {
    const missing = harness();
    missing.remove();
    await missing.store.applyEvents("server", [progress(1)]);
    expect(missing.refreshConnectionWindows).toHaveBeenCalledOnce();
    for (const initial of [summary("worker"), summary("worker", { archived: true })]) {
      const test = harness(initial);
      await test.store.applyEvents("server", [progress(1)]);
      expect(test.refreshConnectionWindows).toHaveBeenCalledOnce();
    }
  });
});

it("does not turn server-excluded supervisor progress into catalog repair work", async () => {
  const test = harness();
  test.remove();
  for (const method of [
    "companion/thread/progress",
    "companion/thread/invalidated",
    "turn/started",
  ]) {
    const event = progress(1, method);
    await test.store.applyEvents("server", [
      { ...event, payload: { ...event.payload, codewideCatalogExcluded: true } },
    ]);
  }
  expect(test.refreshConnectionWindows).not.toHaveBeenCalled();
  expect(test.get).not.toHaveBeenCalled();
});
