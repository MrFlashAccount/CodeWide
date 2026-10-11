import { describe, expect, it } from "vitest";
import { liveActivityChangeFromPatch } from "../src/live-activity";
import { threadProjectionPatchFromEvent, type ThreadProjectionPatchV1 } from "../src/thread-events";

function patch(operation: Record<string, unknown>): ThreadProjectionPatchV1 {
  const parsed = threadProjectionPatchFromEvent({
    method: "item/started",
    params: { threadId: "thread", turnId: "turn", item: { id: "item", type: "webSearch" } },
    codewideThreadPatch: { version: 1, threadId: "thread", operation: { kind: "itemUpsert", ...operation } },
  });
  if (parsed === null) throw new Error("patch must parse");
  return parsed;
}

describe("live activity patch field", () => {
  it("reads every published activity kind", () => {
    const activities = [
      { kind: "reasoning", title: "Inspecting tests" },
      { kind: "planStep", step: "Fixing the parser" },
      { kind: "command", command: "cargo test" },
      { kind: "fileEdit", path: "src/vcs.rs", more: 2 },
      { kind: "tool", server: "github", tool: "search" },
      { kind: "tool", server: null, tool: "Read" },
      { kind: "webSearch" },
      { kind: "compacting" },
    ];
    for (const activity of activities) {
      expect(liveActivityChangeFromPatch(patch({ liveActivity: activity }))).toEqual({ type: "set", activity });
    }
  });

  it("distinguishes a cleared activity from an unchanged one", () => {
    expect(liveActivityChangeFromPatch(patch({ liveActivity: null }))).toEqual({ type: "cleared" });
    expect(liveActivityChangeFromPatch(patch({}))).toBeNull();
  });

  it("clears instead of keeping a stale label when the value is unreadable", () => {
    for (const value of [{ kind: "future" }, { kind: "command", command: " " }, { kind: "fileEdit", path: "a", more: -1 }, "text"]) {
      expect(liveActivityChangeFromPatch(patch({ liveActivity: value }))).toEqual({ type: "cleared" });
    }
  });
});
