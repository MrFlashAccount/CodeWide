import { describe, expect, it } from "vitest";

import { invalidationCanBeCleared, latestThreadInvalidations } from "../src/data/thread-detail-invalidation";

describe("thread detail invalidation", () => {
  it("retains the newest cursor for every unloaded thread in a projection batch", () => {
    expect([...latestThreadInvalidations([
      { cursor: 10, payload: { method: "turn/started", params: { threadId: "a" } } },
      { cursor: 11, payload: { method: "item/started", params: { threadId: "b" } } },
      { cursor: 12, payload: { method: "turn/completed", params: { threadId: "a" } } },
      { cursor: 13, payload: { method: "account/updated", params: {} } },
    ]).entries()]).toEqual([["a", 12], ["b", 11]]);
  });

  it("does not clear an event that arrived after an authoritative refresh started", () => {
    expect(invalidationCanBeCleared(20, 20)).toBe(true);
    expect(invalidationCanBeCleared(21, 20)).toBe(false);
  });
});
