import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { mergeThreadPartitions } from "../src/data/thread-partitions";

function turn(id: string, status: "completed" | "inProgress"): Thread["turns"][number] {
  return { id, status, items: [], itemsView: "summary", error: null, startedAt: 1, completedAt: null, durationMs: null };
}

function retriedTurn(id: string, clientId: string, status: "completed" | "inProgress"): Thread["turns"][number] {
  return {
    ...turn(id, status),
    items: [{ type: "userMessage", id: `${id}-user`, clientId, content: [] }],
  };
}

describe("thread partition merge", () => {
  it("keeps the fast append path when partitions do not overlap", () => {
    expect(mergeThreadPartitions([turn("old", "completed")], [turn("new", "inProgress")]).map(({ id }) => id))
      .toEqual(["old", "new"]);
  });

  it("renders one live value during the live-to-sealed handoff", () => {
    const live = turn("same", "inProgress");
    const merged = mergeThreadPartitions([turn("old", "completed"), turn("same", "completed")], [live]);
    expect(merged.map(({ id }) => id)).toEqual(["old", "same"]);
    expect(merged[1]).toBe(live);
  });

  it("renders one turn when an interrupted command was delivered more than once", () => {
    const original = retriedTurn("original", "android-command", "completed");
    const retry = retriedTurn("retry", "android-command", "completed");

    expect(mergeThreadPartitions([original, retry], [])).toEqual([original]);
  });

  it("does not conflate intentionally repeated text without a shared client id", () => {
    expect(mergeThreadPartitions([turn("first", "completed"), turn("second", "completed")], []).map(({ id }) => id))
      .toEqual(["first", "second"]);
  });
});
