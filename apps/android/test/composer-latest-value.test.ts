import { describe, expect, it } from "vitest";

import { reconcileComposerLatestValue } from "../src/data/composer-latest-value";

describe("latest composer value", () => {
  it("does not replace new local input with a stale database projection", () => {
    const local = { scope: "new-chat", rendered: "", latest: "first message" };
    const afterStaleProjection = reconcileComposerLatestValue(local, "new-chat", "first");

    expect(afterStaleProjection.latest).toBe("first message");
  });

  it("accepts persisted values when there is no newer local input", () => {
    const current = { scope: "thread", rendered: "old", latest: "old" };

    expect(reconcileComposerLatestValue(current, "thread", "restored").latest).toBe("restored");
  });

  it("resets when the composer scope changes", () => {
    const current = { scope: "old-thread", rendered: "old", latest: "unsaved" };

    expect(reconcileComposerLatestValue(current, "new-thread", "saved")).toEqual({
      scope: "new-thread",
      rendered: "saved",
      latest: "saved",
    });
  });
});
