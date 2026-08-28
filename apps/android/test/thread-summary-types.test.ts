import { describe, expect, it } from "vitest";

import { normalizeStoredThreadSummary, normalizeThreadStatus } from "../src/data/thread-summary-types";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

function summary(): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: "thread",
    parentThreadId: null,
    name: "Thread",
    preview: "Preview",
    cwd: "/repo",
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" },
    pinned: false,
    archived: false,
    pendingRequestCount: 0,
    latestActivityCursor: 0,
    lastSeenCursor: 0,
    unread: 0,
    provisionalThread: null,
    deleteCommandId: null,
  };
}

describe("thread summary normalization", () => {
  it("does not invent lifecycle for a malformed summary", () => {
    const malformed = { ...summary(), status: undefined } as unknown as StoredThreadSummary;

    expect(normalizeStoredThreadSummary(malformed).status).toEqual({ type: "notLoaded" });
  });

  it("normalizes malformed active status flags", () => {
    expect(normalizeThreadStatus({ type: "active" })).toEqual({ type: "active", activeFlags: [] });
  });
});
