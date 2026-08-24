import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { collectThreadCursorDelta, latestSealedTurnId, planThreadOpenSync, threadOpenNeedsCursorCatchUp } from "../src/data/thread-cursor-sync";

describe("thread cursor sync", () => {
  it("opens a healthy known thread locally and reserves imports for missing state", () => {
    expect(planThreadOpenSync(true, null, false)).toBe("local");
    expect(planThreadOpenSync(true, 42, false)).toBe("cursor-catch-up");
    expect(planThreadOpenSync(true, null, true)).toBe("snapshot-import");
    expect(planThreadOpenSync(true, 42, true)).toBe("snapshot-import");
    expect(planThreadOpenSync(false, null, false)).toBe("snapshot-import");
  });

  it("catches up a nominally local thread when a delivered receipt has no canonical turn", () => {
    expect(threadOpenNeedsCursorCatchUp("local", true)).toBe(true);
    expect(threadOpenNeedsCursorCatchUp("local", false)).toBe(false);
    expect(threadOpenNeedsCursorCatchUp("cursor-catch-up", false)).toBe(true);
    expect(threadOpenNeedsCursorCatchUp("snapshot-import", true)).toBe(false);
  });

  it("collects only immutable turns newer than the local cursor", async () => {
    const pages = new Map<string | null, { data: Turn[]; nextCursor: string | null }>([
      [null, { data: [turn("d"), turn("c")], nextCursor: "older" }],
      ["older", { data: [turn("b"), turn("a")], nextCursor: null }],
    ]);

    await expect(collectThreadCursorDelta("b", async (cursor) => pages.get(cursor)!)).resolves.toEqual({
      turns: [turn("c"), turn("d")],
      historyCursor: "older",
      anchorFound: true,
    });
  });

  it("loads one bounded tail page for a first import", async () => {
    let calls = 0;
    const result = await collectThreadCursorDelta(null, async () => {
      calls += 1;
      return { data: [turn("b"), turn("a")], nextCursor: "older" };
    });

    expect(calls).toBe(1);
    expect(result).toEqual({ turns: [turn("a"), turn("b")], historyCursor: "older", anchorFound: true });
  });

  it("does not append a disconnected history island", async () => {
    const result = await collectThreadCursorDelta("missing", async () => ({
      data: [turn("b"), turn("a")],
      nextCursor: null,
    }));

    expect(result).toEqual({ turns: [], historyCursor: null, anchorFound: false });
  });

  it("falls back cleanly when the cursor is beyond the bounded catch-up budget", async () => {
    let page = 0;
    const result = await collectThreadCursorDelta("far-away", async () => ({
      data: [turn(`turn-${page += 1}`)],
      nextCursor: `page-${page}`,
    }), 2);

    expect(result).toEqual({ turns: [], historyCursor: "page-1", anchorFound: false });
  });

  it("uses the latest completed turn as the stable cursor", () => {
    expect(latestSealedTurnId([turn("a"), turn("b"), turn("live", "inProgress")])).toBe("b");
    expect(latestSealedTurnId([turn("live", "inProgress")])).toBeNull();
  });

  it("does not anchor after a completed turn whose final text is still missing", () => {
    expect(latestSealedTurnId([
      turn("stable"),
      { ...turn("incomplete"), items: [] },
    ])).toBe("stable");
    expect(latestSealedTurnId([{ ...turn("incomplete"), items: [] }])).toBeNull();
    expect(latestSealedTurnId([turn("interrupted", "interrupted", false)])).toBe("interrupted");
  });
});

function turn(id: string, status: Turn["status"] = "completed", withAgent = true): Turn {
  return {
    id,
    itemsView: "summary",
    status,
    error: null,
    startedAt: 1,
    completedAt: status === "inProgress" ? null : 2,
    durationMs: status === "inProgress" ? null : 1,
    items: withAgent ? [{
      id: `${id}-agent`,
      type: "agentMessage",
      text: "done",
      phase: "final_answer",
      memoryCitation: null,
    }] : [],
  };
}
