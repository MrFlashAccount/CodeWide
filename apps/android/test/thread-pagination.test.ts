import { describe, expect, it } from "vitest";

import {
  threadResumePageLimit,
  threadHistoryContainsBeginning,
  THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE,
  THREAD_HISTORY_PAGE_SIZE,
  THREAD_RESIDENT_TURN_LIMIT,
} from "../src/data/thread-pagination";

describe("thread history transport", () => {
  it("requires both server exhaustion and the earliest known turn in the resident window", () => {
    expect(threadHistoryContainsBeginning(true, null)).toBe(true);
    expect(threadHistoryContainsBeginning(false, null)).toBe(false);
    expect(threadHistoryContainsBeginning(true, undefined)).toBe(false);
    expect(threadHistoryContainsBeginning(true, "older-page")).toBe(false);
  });
  it("keeps RPC pages independent from the fixed UI window", () => {
    expect(THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE).toBe(6);
    expect(THREAD_HISTORY_PAGE_SIZE).toBe(5);
    expect(THREAD_RESIDENT_TURN_LIMIT).toBe(15);
  });

  it("bootstraps one complete bounded window", () => {
    expect(threadResumePageLimit(0)).toBe(15);
    expect(threadResumePageLimit(14)).toBe(15);
    expect(threadResumePageLimit(15)).toBe(6);
    expect(threadResumePageLimit(36)).toBe(6);
  });

});
