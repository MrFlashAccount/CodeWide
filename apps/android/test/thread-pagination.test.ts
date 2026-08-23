import { describe, expect, it } from "vitest";

import {
  consumeDuplicateHistoryPages,
  freezeResidentRange,
  hasAnyLocalOlderTurn,
  hasFullLocalOlderPage,
  residentRangeForAnchor,
  residentRangeForVisibleAnchor,
  revealResidentLiveTail,
  threadResumePageLimit,
  THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE,
  THREAD_HISTORY_PAGE_SIZE,
  THREAD_RESIDENT_RANGE_EDGE,
  THREAD_RESIDENT_RANGE_NEWER_BUFFER,
  THREAD_RESIDENT_TURN_LIMIT,
} from "../src/data/thread-pagination";

describe("thread range prefetch", () => {
  it("keeps RPC pages independent from the fixed UI range", () => {
    expect(THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE).toBe(6);
    expect(THREAD_HISTORY_PAGE_SIZE).toBe(12);
    expect(THREAD_RESIDENT_TURN_LIMIT).toBe(12);
    expect(THREAD_RESIDENT_RANGE_EDGE).toBe(3);
    expect(THREAD_RESIDENT_RANGE_NEWER_BUFFER).toBe(6);
  });

  it("bootstraps a complete resident range instead of paging from six turns", () => {
    expect(threadResumePageLimit(0)).toBe(12);
    expect(threadResumePageLimit(6)).toBe(12);
    expect(threadResumePageLimit(11)).toBe(12);
    expect(threadResumePageLimit(12)).toBe(6);
    expect(threadResumePageLimit(45)).toBe(6);
  });

  it("uses local history only when it can move a complete page", () => {
    expect(hasFullLocalOlderPage(82, 70)).toBe(true);
    expect(hasFullLocalOlderPage(82, 75)).toBe(false);
    expect(hasFullLocalOlderPage(82, 82)).toBe(false);
    expect(hasFullLocalOlderPage(null, 70)).toBe(false);
    expect(hasFullLocalOlderPage(82, null)).toBe(false);
  });

  it("still exposes a partial cached remainder after the remote cursor is exhausted", () => {
    expect(hasAnyLocalOlderTurn(82, 75)).toBe(true);
    expect(hasAnyLocalOlderTurn(82, 82)).toBe(false);
    expect(hasAnyLocalOlderTurn(null, 75)).toBe(false);
    expect(hasAnyLocalOlderTurn(82, null)).toBe(false);
  });

  it("completes a partial local remainder through the remote cursor", async () => {
    const remoteCursors: string[] = [];
    const hasLocalPage = hasFullLocalOlderPage(82, 75);
    const consumed = hasLocalPage
      ? null
      : await consumeDuplicateHistoryPages("before-82", async (cursor) => {
          remoteCursors.push(cursor);
          return { nextCursor: "before-70", acceptedHistory: true, extendedHistory: true };
        });

    expect(remoteCursors).toEqual(["before-82"]);
    expect(consumed?.page?.extendedHistory).toBe(true);
  });
});

describe("resident history range", () => {
  it("keeps a fixed resident budget", () => {
    expect(THREAD_RESIDENT_TURN_LIMIT).toBe(12);
  });

  it("places a persisted anchor in the middle of its range", () => {
    expect(residentRangeForAnchor(100, 150)).toEqual({ maxOrdinal: 106, turnLimit: 12 });
    expect(residentRangeForAnchor(100, 105)).toEqual({ maxOrdinal: null, turnLimit: 12 });
    expect(residentRangeForAnchor(null, 150)).toEqual({ maxOrdinal: null, turnLimit: 12 });
  });

  it("freezes the current tail before live inserts can displace the reader", () => {
    expect(freezeResidentRange(150)).toEqual({ maxOrdinal: 150 });
    expect(freezeResidentRange(null)).toEqual({ maxOrdinal: null });
    expect(freezeResidentRange(150, [151, 152])).toEqual({ maxOrdinal: 152 });
  });

  it("recenters a range only after its stable anchor enters an edge guard", () => {
    const state = { residentMaxOrdinal: 150, residentTurnLimit: 12 };
    expect(residentRangeForVisibleAnchor(state, 142, "older", 150, 139, true)).toBeNull();
    expect(residentRangeForVisibleAnchor(state, 141, "older", 150, 139, true)).toEqual({
      maxOrdinal: 147,
      turnLimit: 12,
    });
    expect(residentRangeForVisibleAnchor({ residentMaxOrdinal: 147, residentTurnLimit: 12 }, 145, "newer", 150, 136, true)).toEqual({
      maxOrdinal: null,
      turnLimit: 12,
    });
    expect(residentRangeForVisibleAnchor(state, 139, "older", 150, 139, false)).toBeNull();
  });

  it("keeps the visible anchor resident when live turns advance the tail", () => {
    const next = residentRangeForVisibleAnchor(
      { residentMaxOrdinal: 150, residentTurnLimit: 12 },
      140,
      "older",
      180,
      139,
      true,
    );

    expect(next).toEqual({ maxOrdinal: 146, turnLimit: 12 });
    expect(next).not.toBeNull();
    expect((next?.maxOrdinal ?? 0) - (next?.turnLimit ?? 0) + 1).toBeLessThanOrEqual(140);
    expect(next?.maxOrdinal).toBeGreaterThanOrEqual(140);
  });

  it("recenters a partially hydrated range at its actual resident edge", () => {
    expect(residentRangeForVisibleAnchor(
      { residentMaxOrdinal: 150, residentTurnLimit: 12 },
      147,
      "older",
      150,
      147,
      true,
    )).toEqual({ maxOrdinal: 150, turnLimit: 12 });
  });

  it("consumes cached cursor pages without moving until persistence extends the minimum", async () => {
    const visited: string[] = [];
    const pages = new Map([
      ["tail", { nextCursor: "middle", acceptedHistory: true, extendedHistory: false }],
      ["middle", { nextCursor: "older", acceptedHistory: true, extendedHistory: false }],
      ["older", { nextCursor: "next", acceptedHistory: true, extendedHistory: true }],
    ]);
    const result = await consumeDuplicateHistoryPages("tail", async (cursor) => {
      visited.push(cursor);
      return pages.get(cursor)!;
    });

    expect(visited).toEqual(["tail", "middle", "older"]);
    expect(result).toEqual({
      page: { nextCursor: "next", acceptedHistory: true, extendedHistory: true },
      nextCursor: "next",
      cancelled: false,
    });
  });

  it("stops consuming a cursor chain when SQLite rejects its stale epoch", async () => {
    const visited: string[] = [];
    const result = await consumeDuplicateHistoryPages("old-epoch", async (cursor) => {
      visited.push(cursor);
      return { nextCursor: "must-not-load", acceptedHistory: false, extendedHistory: false };
    });

    expect(visited).toEqual(["old-epoch"]);
    expect(result.cancelled).toBe(true);
  });

  it("makes jump-to-latest terminal even while an older page is in flight", () => {
    const revealed = revealResidentLiveTail({
      historyEpoch: 7,
      status: "loading-history",
      nextCursor: "older-cursor",
      residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
      residentMaxOrdinal: 102,
      error: "stale error",
    });

    expect(revealed).toEqual({
      historyEpoch: 7,
      status: "ready",
      nextCursor: "older-cursor",
      residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
      residentMaxOrdinal: null,
      error: null,
    });
  });
});
