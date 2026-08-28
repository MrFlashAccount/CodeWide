import { describe, expect, it } from "vitest";

import type { ThreadProjectionPatchV1 } from "@codewide/sync-client";

import { invalidationCanBeCleared, latestThreadInvalidations, shouldPersistThreadInvalidation } from "../src/data/thread-detail-invalidation";

describe("thread detail invalidation", () => {
  it("retains the newest cursor for every unloaded thread in a projection batch", () => {
    expect([...latestThreadInvalidations([
      { cursor: 10, payload: semanticEvent("a", { kind: "turnStarted" }) },
      { cursor: 11, payload: semanticEvent("b", { kind: "itemUpsert" }) },
      { cursor: 12, payload: semanticEvent("a", { kind: "turnCompleted" }) },
      { cursor: 13, payload: { method: "account/updated", params: {} } },
    ]).entries()]).toEqual([["a", 12], ["b", 11]]);
  });

  it("does not clear an event that arrived after an authoritative refresh started", () => {
    expect(invalidationCanBeCleared(20, 20)).toBe(true);
    expect(invalidationCanBeCleared(21, 20)).toBe(false);
  });

  it("keeps explicit/cold invalidations but not locally projected replay events", () => {
    const projected = { threadId: "a", operation: { kind: "threadStatusChanged", status: { type: "idle" } } } as ThreadProjectionPatchV1;
    const canonical = { threadId: "a", operation: { kind: "threadInvalidated", summary: {} } } as ThreadProjectionPatchV1;

    expect(shouldPersistThreadInvalidation(projected, true, false)).toBe(false);
    expect(shouldPersistThreadInvalidation(projected, false, true)).toBe(false);
    expect(shouldPersistThreadInvalidation(projected, false, false)).toBe(true);
    expect(shouldPersistThreadInvalidation(canonical, true, false)).toBe(true);
    expect(shouldPersistThreadInvalidation(null, true, false)).toBe(true);
  });
});

function semanticEvent(threadId: string, operation: ThreadProjectionPatchV1["operation"]): Record<string, unknown> {
  return {
    method: "test/semantic-event",
    params: { threadId },
    codewideThreadPatch: { version: 1, threadId, operation },
  };
}
