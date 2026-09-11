import { describe, expect, it } from "vitest";
import { parseMessageSearchPage, parseSearchContext, searchDateBoundary } from "../src/data/message-search";

describe("search response and date boundaries", () => {
  it("does not turn malformed or incomplete responses into empty success", () => {
    expect(() => parseMessageSearchPage({ data: [], indexing: false })).toThrow();
    expect(() => parseSearchContext({ messages: [], older: undefined, newer: null })).toThrow();
    expect(parseMessageSearchPage({ data: [], indexing: true, failedSources: 2, nextOffset: null })).toEqual({ data: [], indexing: true, failedSources: 2, nextOffset: null });
  });
  it("uses whole local days and rejects calendar overflow", () => {
    expect(searchDateBoundary("", false)).toBeNull();
    expect(() => searchDateBoundary("2026-02-30", false)).toThrow();
    expect(searchDateBoundary("2026-09-06", false)).toBe(new Date(2026, 8, 6).toISOString());
    expect(searchDateBoundary("2026-09-06", true)).toBe(new Date(2026, 8, 7).toISOString());
  });
});
