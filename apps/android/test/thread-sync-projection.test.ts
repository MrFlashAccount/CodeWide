import type { SyncEvent } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { createThreadSyncProjection } from "../src/data/thread-sync-projection";
import { projectThreadSummaryEvent } from "../src/data/thread-summary-projection";
import { summary } from "./fixtures/thread-summary";

type Ports = Parameters<typeof createThreadSyncProjection>[0];
function harness(initial = summary("worker", { status: { type: "active", activeFlags: [] } })) {
  let current: ReturnType<typeof summary> | null = initial;
  const catalog = {
    refreshInvalidatedThread: vi.fn(),
    refreshSubagents: vi.fn(async (_connectionId: string, _rootThreadId: string) => undefined),
  };
  const applyEvents = vi.fn(async (connectionId: string, events: SyncEvent[]) => {
    for (const event of events) {
      const mutation = projectThreadSummaryEvent(
        connectionId,
        event.payload,
        () => current ?? undefined,
        event.cursor,
      );
      if (mutation !== null) current = mutation.value;
    }
  });
  // WHY: The test exercises the real ordered projection through its catalog-facing
  // ports; unrelated command, account and snapshot operations are not invoked. The
  // catalog port has no page or metadata read: a call to one would throw here.
  const applyChanged = vi.fn(() => true);
  const mergeProject = vi.fn();
  const ports = {
    accountRateLimits: {},
    agentProviders: { applyChanged },
    projects: { mergeProject },
    catalog,
    details: { applyEvents: async () => ({ checkpoint: Promise.resolve(), threads: new Map() }) },
    resources: { threadResources: new Map() },
    summaries: { applyEvents },
    sync: {},
  } as unknown as Ports;
  return {
    store: createThreadSyncProjection(ports),
    applyChanged,
    applyEvents,
    catalog,
    mergeProject,
    refreshSubagents: catalog.refreshSubagents,
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

describe("event projection without catalog repair", () => {
  it("projects membership and progress events without reading catalog pages or metadata", async () => {
    const test = harness();
    test.remove();
    for (let cursor = 1; cursor <= 20; cursor += 1) {
      await (await test.store.applyEvents("server", [progress(cursor)])).checkpoint;
    }
    const lifecycle = (cursor: number, method: string, kind: string): SyncEvent => ({
      cursor,
      payload: {
        method,
        params: { threadId: "worker" },
        codewideThreadPatch: { version: 1, threadId: "worker", operation: { kind } },
      },
    });
    await test.store.applyEvents("server", [
      lifecycle(21, "turn/started", "turnStarted"),
      lifecycle(22, "thread/archived", "threadArchived"),
      lifecycle(23, "companion/thread/pin/updated", "threadPinned"),
    ]);

    // A missing row gets no metadata read: its server row arrives in the list stream.
    expect(test.read()).toBeNull();
    expect(test.applyEvents).toHaveBeenCalledTimes(21);
    expect(test.catalog.refreshInvalidatedThread).not.toHaveBeenCalled();
  });

  it("keeps an open chat's rollout invalidation repair and leaves its server fields alone", async () => {
    const test = harness();
    const before = test.read();
    await test.store.applyEvents("server", [progress(4, "companion/thread/invalidated")]);
    expect(test.catalog.refreshInvalidatedThread).toHaveBeenCalledExactlyOnceWith(
      "server",
      "worker",
      false,
    );
    expect(test.read()?.preview).toBe(before?.preview);
    expect(test.read()?.status).toEqual(before?.status);
    expect(test.read()?.latestActivityCursor).toBe(4);
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
  expect(test.catalog.refreshInvalidatedThread).not.toHaveBeenCalled();
});

it("publishes a durable provider status change to the provider list owner", async () => {
  const test = harness();
  const params = { hostCapabilities: {}, providers: [] };
  await test.store.applyEvents("server", [
    { cursor: 1, payload: { method: "companion/agentProviders/changed", params } },
  ]);
  expect(test.applyChanged).toHaveBeenCalledExactlyOnceWith("server", params);
});

it("merges a project another device pinned or unpinned into the project catalog", async () => {
  const test = harness();
  const project = { addedAt: 1, lastUsedAt: 2, name: "repo", path: "/repo", pinned: false };
  await test.store.applyEvents("server", [
    { cursor: 1, payload: { method: "companion/project/changed", params: { project } } },
    { cursor: 2, payload: { method: "companion/project/changed", params: { project: {} } } },
  ]);
  expect(test.mergeProject).toHaveBeenCalledExactlyOnceWith(
    "server",
    expect.objectContaining({ path: "/repo", pinned: false }),
  );
});

it("reads a root's subagents again once the Companion invalidates them, open or not", async () => {
  const test = harness();
  const invalidated = (cursor: number, threadId: string): SyncEvent => ({
    cursor,
    payload: { method: "companion/thread/subagents/invalidated", params: { threadId } },
  });
  await test.store.applyEvents("server", [
    invalidated(1, "root"),
    invalidated(2, "root"),
    invalidated(3, "other-root"),
  ]);
  expect(test.refreshSubagents.mock.calls).toEqual([
    ["server", "root"],
    ["server", "other-root"],
  ]);
  expect(test.catalog.refreshInvalidatedThread).not.toHaveBeenCalled();
});
