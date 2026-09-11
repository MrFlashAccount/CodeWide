import type { StoredThreadSummary } from "../../src/data/thread-summary-types";

export function summary(
  id: string,
  overrides: Partial<StoredThreadSummary> = {},
): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: id,
    parentThreadId: null,
    name: id,
    preview: id,
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
    ...overrides,
  };
}
