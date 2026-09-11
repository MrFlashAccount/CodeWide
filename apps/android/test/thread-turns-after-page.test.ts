import { describe, expect, it } from "vitest";

import { parseThreadTurnsAfterPage } from "../src/data/thread-turns-after-page";

const completed = {
  id: "newer",
  status: "completed",
  items: [],
};

describe("thread turns after page", () => {
  it("accepts a bounded immutable forward page", () => {
    expect(parseThreadTurnsAfterPage({ data: [completed], hasMore: true, sourceWitness: "source" }, "anchor", 5))
      .toEqual({ turns: [completed], hasMore: true, sourceWitness: "source" });
  });

  it.each([
    null,
    {},
    { data: [], hasMore: "yes" },
    { data: [], hasMore: true },
    { data: [{ ...completed, id: "anchor" }], hasMore: false },
    { data: [{ ...completed, status: "inProgress" }], hasMore: false },
    { data: [{ ...completed, status: "unknown" }], hasMore: false },
    { data: [{ ...completed, id: "" }], hasMore: false },
    { data: [completed, completed], hasMore: false },
    { data: [{ ...completed, items: [null] }], hasMore: false },
    { data: [{ ...completed, items: [{ type: "agentMessage", id: "item", text: 10 }] }], hasMore: false },
    { data: [{ ...completed, items: [{ type: "userMessage", id: "item", content: [null] }] }], hasMore: false },
    { data: [{ ...completed, error: { message: 12 } }], hasMore: false },
    { data: [{ ...completed, durationMs: Infinity }], hasMore: false },
  ])("rejects a malformed or non-advancing page %#", (value) => {
    const response = value === null ? value : { sourceWitness: "source", ...value };
    expect(() => parseThreadTurnsAfterPage(response, "anchor", 5))
      .toThrow("invalid history summary page");
  });

  it("rejects responses larger than the requested page", () => {
    expect(() => parseThreadTurnsAfterPage({ data: [completed], hasMore: false, sourceWitness: "source" }, "anchor", 0))
      .toThrow("invalid history summary page");
  });

  it("retains valid whole-content references as repairable metadata-only turns", () => {
    const { items: _items, ...metadata } = completed;
    const raw = {
      ...metadata,
      codewideContent: { version: 1, fields: {}, whole: { id: "a".repeat(64), byteLength: 100_000, contentType: "application/json" } },
    };
    expect(parseThreadTurnsAfterPage({ data: [raw], hasMore: false, sourceWitness: "source" }, "anchor", 5).turns)
      .toEqual([{ ...raw, items: [], itemsView: "notLoaded" }]);
  });

  it("requires a source witness for semantic traversal", () => {
    expect(() => parseThreadTurnsAfterPage({ data: [completed], hasMore: false }, "anchor", 5))
      .toThrow("invalid history summary page");
  });

  it("rejects an oversized source witness before it reaches persistence", () => {
    expect(() => parseThreadTurnsAfterPage({
      data: [completed], hasMore: false, sourceWitness: "x".repeat(8192),
    }, "anchor", 5)).toThrow("invalid history summary page");
  });
});
