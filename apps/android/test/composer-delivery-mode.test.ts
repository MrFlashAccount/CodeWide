import { describe, expect, it } from "vitest";

import { effectiveComposerSendPreference, resolveComposerSendMode } from "../src/data/composer-delivery-mode";

describe("composer delivery mode", () => {
  it("queues the normal send mode while a turn is active", () => {
    expect(resolveComposerSendMode("start", true, "turn-active")).toEqual({ type: "queue" });
    expect(effectiveComposerSendPreference("start", true, "turn-active")).toBe("queue");
  });

  it("queues while active even before the turn detail is materialized", () => {
    expect(resolveComposerSendMode("start", true, null)).toEqual({ type: "queue" });
    expect(resolveComposerSendMode("steer", true, null)).toEqual({ type: "queue" });
  });

  it("starts immediately when the thread is idle", () => {
    expect(resolveComposerSendMode("start", false, null)).toEqual({ type: "start" });
    expect(resolveComposerSendMode("queue", false, null)).toEqual({ type: "start" });
    expect(effectiveComposerSendPreference("queue", false, null)).toBe("start");
  });

  it("keeps explicit queue and steer choices while a turn is active", () => {
    expect(resolveComposerSendMode("queue", true, "turn-active")).toEqual({ type: "queue" });
    expect(resolveComposerSendMode("steer", true, "turn-active")).toEqual({ type: "steer", expectedTurnId: "turn-active" });
  });

  it("falls back to start when stale turn detail survives an idle lifecycle", () => {
    expect(resolveComposerSendMode("steer", false, null)).toEqual({ type: "start" });
    expect(resolveComposerSendMode("steer", false, "stale-turn")).toEqual({ type: "start" });
  });
});
