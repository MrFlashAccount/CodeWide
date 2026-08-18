import { describe, expect, it } from "vitest";

import { optimisticTimelineKey, remoteTurnTimelineKey } from "../src/rendering/timeline-identity";

describe("timeline row identity", () => {
  it("preserves one list cell while an optimistic message becomes a remote turn", () => {
    const optimistic = optimisticTimelineKey("server/thread", "client-42");
    const accepted = remoteTurnTimelineKey("server/thread", "turn-9", [
      { type: "userMessage", clientId: "client-42" },
      { type: "agentMessage" },
    ]);
    expect(accepted).toBe(optimistic);
  });

  it("falls back to the remote turn id for history without a client id", () => {
    expect(remoteTurnTimelineKey("server/thread", "turn-9", [{ type: "agentMessage" }]))
      .toBe("turn-remote:server/thread:turn-9");
  });
});
