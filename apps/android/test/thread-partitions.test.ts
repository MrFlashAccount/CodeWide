import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { mergeProjectedThreadPartitions, mergeThreadPartitions } from "../src/data/thread-partitions";

function turn(id: string, status: "completed" | "inProgress", startedAt = 1): Thread["turns"][number] {
  return { id, status, items: [], itemsView: "summary", error: null, startedAt, completedAt: null, durationMs: null };
}

function retriedTurn(id: string, clientId: string, status: "completed" | "inProgress"): Thread["turns"][number] {
  return {
    ...turn(id, status),
    items: [{ type: "userMessage", id: `${id}-user`, clientId, content: [] }],
  };
}

describe("thread partition merge", () => {
  it("keeps the fast append path when partitions do not overlap", () => {
    expect(mergeThreadPartitions([turn("old", "completed", 1)], [turn("new", "inProgress", 2)]).map(({ id }) => id))
      .toEqual(["old", "new"]);
  });

  it("does not move an older in-progress turn behind later server history", () => {
    expect(mergeThreadPartitions(
      [turn("middle", "completed", 2), turn("latest", "completed", 3)],
      [turn("orphan", "inProgress", 1)],
    ).map(({ id }) => id)).toEqual(["orphan", "middle", "latest"]);
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

  it("restores projected partitions to the merged thread order", () => {
    const sealed = [{ id: "middle", value: "sealed-middle" }, { id: "latest", value: "sealed-latest" }];
    const live = [{ id: "orphan", value: "live-orphan" }];

    expect(mergeProjectedThreadPartitions(
      [turn("orphan", "inProgress", 1), turn("middle", "completed", 2), turn("latest", "completed", 3)],
      sealed,
      live,
    ).map(({ value }) => value)).toEqual(["live-orphan", "sealed-middle", "sealed-latest"]);
  });
});
