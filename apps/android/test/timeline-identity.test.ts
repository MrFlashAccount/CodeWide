import { describe, expect, it } from "vitest";

import {
  optimisticTimelineKey,
  remoteTurnTimelineKey,
  retainedRemoteTurnTimelineKey,
} from "../src/rendering/timeline-identity";

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
    expect(remoteTurnTimelineKey("server/thread", "turn-history", [{ type: "agentMessage" }])).toBe(
      "turn-remote:server/thread:turn-history",
    );
  });

  it("does not remount a pre-turn row when its client id arrives", () => {
    const scope = `server/thread/${crypto.randomUUID()}`;
    const before = retainedRemoteTurnTimelineKey(scope, "turn-live", [
      { type: "commandExecution" },
    ]);
    const after = retainedRemoteTurnTimelineKey(scope, "turn-live", [
      { type: "userMessage", clientId: "client-live" },
      { type: "commandExecution" },
    ]);

    expect(after).toBe(before);
  });

  it("keeps the canonical row identity when a live turn becomes compact completed history", () => {
    const scope = `server/thread/${crypto.randomUUID()}`;
    const optimistic = optimisticTimelineKey(scope, "client-completed");
    const live = retainedRemoteTurnTimelineKey(scope, "turn-completed", [
      { type: "userMessage", clientId: "client-completed" },
      { type: "agentMessage" },
    ]);
    const completed = retainedRemoteTurnTimelineKey(scope, "turn-completed", [
      { type: "agentMessage" },
    ]);

    expect(live).toBe(optimistic);
    expect(completed).toBe(optimistic);
  });
});
