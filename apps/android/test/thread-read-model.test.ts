import { describe, expect, it } from "vitest";

import { materializeResumedThread } from "../src/data/thread-read-model";

describe("companion thread read model", () => {
  it("uses the authoritative companion window without merging stale turns", () => {
    const authoritative = thread("thread", [turn("fresh", 20)]);
    const result = materializeResumedThread({
      thread: authoritative,
      codewideReadModelVersion: 1,
    } as never);

    expect(result).toBe(authoritative);
    expect(result.turns.map(({ id }) => id)).toEqual(["fresh"]);
  });

  it("rejects a contradictory recovery window instead of merging compatibility state", () => {
    const pageTurn = turn("page", 20);
    expect(() => materializeResumedThread({
      thread: thread("thread", []),
      initialTurnsPage: { data: [pageTurn], nextCursor: null },
      codewideReadModelVersion: 1,
    } as never)).toThrow("omitted turn page");
  });

  it("rejects old companion read models", () => {
    expect(() => materializeResumedThread({
      thread: thread("thread", []),
      codewideReadModelVersion: 0,
    } as never)).toThrow("Unsupported companion thread read model");
  });
});

function thread(id: string, turns: ReturnType<typeof turn>[]) {
  return {
    id,
    turns,
    status: { type: "notLoaded" },
  } as never;
}

function turn(id: string, startedAt: number) {
  return {
    id,
    status: "completed",
    items: [],
    itemsView: "summary",
    error: null,
    startedAt,
    completedAt: startedAt + 1,
    durationMs: 1,
  } as const;
}
