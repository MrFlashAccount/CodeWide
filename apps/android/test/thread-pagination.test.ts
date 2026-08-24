import { describe, expect, it } from "vitest";

import {
  threadResumePageLimit,
  THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE,
  THREAD_HISTORY_PAGE_SIZE,
  THREAD_RESIDENT_TURN_LIMIT,
} from "../src/data/thread-pagination";

describe("thread history transport", () => {
  it("keeps RPC pages independent from the fixed UI window", () => {
    expect(THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE).toBe(6);
    expect(THREAD_HISTORY_PAGE_SIZE).toBe(12);
    expect(THREAD_RESIDENT_TURN_LIMIT).toBe(36);
  });

  it("bootstraps one complete bounded window", () => {
    expect(threadResumePageLimit(0)).toBe(36);
    expect(threadResumePageLimit(35)).toBe(36);
    expect(threadResumePageLimit(36)).toBe(6);
  });

});
