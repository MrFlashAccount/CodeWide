import { describe, expect, it } from "vitest";

import {
  threadLoadBlocksPresentation,
  threadLoadHasResidentSnapshot,
  threadLoadIsHistoryLoading,
  mergeThreadLoadStatuses,
  type ThreadLoadStatus,
} from "../src/data/thread-load-status";

const STATUSES: ThreadLoadStatus[] = [
  "idle",
  "initial-loading",
  "ready",
  "background-updating",
  "loading-history",
  "background-retrying",
  "initial-error",
];

describe("thread load status", () => {
  it("allows only an initial load to replace the conversation with a loader", () => {
    expect(STATUSES.filter(threadLoadBlocksPresentation)).toEqual(["idle", "initial-loading"]);
  });

  it("keeps every background state attached to the resident snapshot", () => {
    expect(STATUSES.filter(threadLoadHasResidentSnapshot)).toEqual([
      "ready",
      "background-updating",
      "loading-history",
      "background-retrying",
    ]);
  });

  it("distinguishes semantic history loading from revalidation", () => {
    expect(threadLoadIsHistoryLoading("loading-history")).toBe(true);
    expect(threadLoadIsHistoryLoading("background-updating")).toBe(false);
  });

  it("projects SQLite and network work into one resident UI status", () => {
    expect(mergeThreadLoadStatuses("ready", "background-updating")).toBe("background-updating");
    expect(mergeThreadLoadStatuses("loading-history", "background-updating")).toBe("loading-history");
    expect(mergeThreadLoadStatuses("ready", "initial-error")).toBe("background-retrying");
    expect(mergeThreadLoadStatuses("initial-loading", "idle")).toBe("initial-loading");
  });
});
