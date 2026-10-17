import type { SyncEvent } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { createThreadCatalogInvalidation } from "../src/data/threadCatalogInvalidation";
import { summary } from "./fixtures/thread-summary";

function harness(current: StoredThreadSummary | null) {
  const refresh = vi.fn();
  const readSummary = vi.fn(async () => current);
  return {
    invalidate: createThreadCatalogInvalidation({ readSummary, refresh }),
    readSummary,
    refresh,
  };
}

function turnStarted(cursor: number, threadId = "worker"): SyncEvent {
  return {
    cursor,
    payload: {
      method: "turn/started",
      params: { threadId, turn: { id: `turn-${cursor}` } },
      codewideThreadPatch: {
        version: 1,
        threadId,
        operation: { kind: "turnStarted", turn: { id: `turn-${cursor}` } },
      },
    },
  };
}

describe("turn/started catalog guard", () => {
  it("does not refresh the catalog for a thread with a listed summary", async () => {
    const test = harness(summary("worker", { status: { type: "active", activeFlags: [] } }));
    await test.invalidate("server", [turnStarted(1), turnStarted(2)]);
    expect(test.readSummary).toHaveBeenCalledExactlyOnceWith("server", "worker");
    expect(test.refresh).not.toHaveBeenCalled();
  });

  it("treats a summary without a provisional field as listed", async () => {
    const { provisionalThread: _omitted, ...listed } = summary("worker");
    const test = harness(listed);
    await test.invalidate("server", [turnStarted(1)]);
    expect(test.refresh).not.toHaveBeenCalled();
  });

  it("ignores archive and activity state, which the start patch does not carry", async () => {
    const test = harness(summary("worker", { archived: true, status: { type: "idle" } }));
    await test.invalidate("server", [turnStarted(1)]);
    expect(test.refresh).not.toHaveBeenCalled();
  });

  it("refreshes the catalog when the started thread has no summary", async () => {
    const test = harness(null);
    await test.invalidate("server", [turnStarted(1)]);
    expect(test.refresh).toHaveBeenCalledExactlyOnceWith("server");
  });

  it("refreshes the catalog when the started thread's summary is provisional", async () => {
    // WHY: The guard reads only whether a provisional thread exists, not its wire content.
    const provisionalThread = {} as NonNullable<StoredThreadSummary["provisionalThread"]>;
    const test = harness(summary("worker", { provisionalThread }));
    await test.invalidate("server", [turnStarted(1)]);
    expect(test.refresh).toHaveBeenCalledExactlyOnceWith("server");
  });

  it("refreshes the catalog for a start it cannot attribute to a thread", async () => {
    const test = harness(summary("worker"));
    await test.invalidate("server", [
      { cursor: 1, payload: { method: "turn/started", params: {} } },
    ]);
    expect(test.refresh).toHaveBeenCalledExactlyOnceWith("server");
    expect(test.readSummary).not.toHaveBeenCalled();
  });

  it("keeps the unconditional refresh for membership changes", async () => {
    for (const method of [
      "companion/thread/invalidated",
      "thread/archived",
      "thread/unarchived",
      "companion/thread/pin/updated",
    ]) {
      const test = harness(summary("worker"));
      await test.invalidate("server", [
        turnStarted(1),
        { cursor: 2, payload: { method, params: {} } },
      ]);
      expect(test.refresh).toHaveBeenCalledExactlyOnceWith("server");
      expect(test.readSummary).not.toHaveBeenCalled();
    }
  });
});
