import { describe, expect, it } from "vitest";

import { ThreadListProjection } from "../src/data/thread-list-projection";
import type { PendingServerRequest } from "../src/data/pending-request-types";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

function summary(id: string, recencyAt: number, overrides: Partial<StoredThreadSummary> = {}): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: id,
    pendingRequestCount: 0,
    recencyAt,
    updatedAt: recencyAt,
    pinned: false,
    deleteCommandId: null,
    ...overrides,
  } as StoredThreadSummary;
}

describe("thread list projection", () => {
  it("returns the exact same list for unrelated workspace renders", () => {
    const projection = new ThreadListProjection();
    const summaries = [summary("older", 1), summary("newer", 2)];
    const requests: PendingServerRequest[] = [];

    const first = projection.project(summaries, requests);
    expect(projection.project(summaries, requests)).toBe(first);
    expect(first.map((thread) => thread.remoteThreadId)).toEqual(["newer", "older"]);
  });

  it("removes optimistic deletes and projects approval state before virtualization", () => {
    const projection = new ThreadListProjection();
    const summaries = [
      summary("visible", 1),
      summary("deleted", 2, { deleteCommandId: "delete-1" }),
    ];
    const requests = [{ connectionId: "server", params: { threadId: "visible" } }] as PendingServerRequest[];

    const result = projection.project(summaries, requests);
    expect(result).toHaveLength(1);
    expect(result[0]?.remoteThreadId).toBe("visible");
    expect(result[0]?.pendingRequestCount).toBe(1);
  });

  it("does not show subagent threads in the main chat list", () => {
    const projection = new ThreadListProjection();
    const result = projection.project([
      summary("root", 1),
      summary("child", 2, { parentThreadId: "root" }),
    ], []);

    expect(result.map((thread) => thread.remoteThreadId)).toEqual(["root"]);
  });
});
