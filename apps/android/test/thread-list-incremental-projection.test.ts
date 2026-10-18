import { describe, expect, it, vi } from "vitest";

import type { PendingServerRequest } from "../src/data/pending-request-types";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { ThreadListProjection } from "../src/features/threadList/summaryProjection";
import {
  storedThreadToListItem,
  ThreadListItemProjection,
} from "../src/features/threadList/threadListProjection";
import { summary } from "./fixtures/thread-summary";

function row(id: string, recencyAt: number, overrides: Partial<StoredThreadSummary> = {}) {
  return summary(id, { recencyAt, updatedAt: recencyAt, ...overrides });
}

function request(threadId: string, id = `request-${threadId}`): PendingServerRequest {
  // WHY: The projection reads only the request's connection, thread and method; the
  // remaining wire fields of a pending server request do not participate in it.
  return {
    connectionId: "server",
    id,
    method: "item/commandExecution/requestApproval",
    params: { threadId },
  } as unknown as PendingServerRequest;
}

function fullProjection(
  summaries: readonly StoredThreadSummary[],
  requests: readonly PendingServerRequest[],
) {
  return new ThreadListItemProjection().project(
    new ThreadListProjection().project(summaries, requests),
  );
}

function harness(initial: readonly StoredThreadSummary[]) {
  const summaries = new ThreadListProjection();
  const items = new ThreadListItemProjection();
  return {
    project(rows: readonly StoredThreadSummary[], requests: readonly PendingServerRequest[] = []) {
      return items.project(summaries.project(rows, requests));
    },
    initial: items.project(summaries.project(initial, [])),
  };
}

describe("incremental thread list projection", () => {
  const a = row("a", 30);
  const b = row("b", 20);
  const c = row("c", 10);

  it("rebuilds only a changed row and keeps order when its order key is unchanged", () => {
    const test = harness([c, a, b]);
    const preview = { ...b, preview: "streaming", updatedAt: 99 };
    // The list contract promises no sort when no order key moved.
    const sort = vi.spyOn(Array.prototype, "sort");
    const next = test.project([c, a, preview]);
    expect(sort).not.toHaveBeenCalled();
    sort.mockRestore();

    expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(next[0]).toBe(test.initial[0]);
    expect(next[2]).toBe(test.initial[2]);
    expect(next[1]).not.toBe(test.initial[1]);
    expect(next[1]?.preview).toBe("streaming");
    expect(next).toEqual(fullProjection([c, a, preview], []));
  });

  it("returns the previous list when a republished row is deeply equal", () => {
    const test = harness([a, b, c]);
    expect(test.project([{ ...a }, b, c])).toBe(test.initial);
  });

  it("moves a row whose recency changed and keeps every other item identity", () => {
    const test = harness([a, b, c]);
    const bumped = { ...c, recencyAt: 40, updatedAt: 40 };
    const next = test.project([a, b, bumped]);

    expect(next.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(next[1]).toBe(test.initial[0]);
    expect(next[2]).toBe(test.initial[1]);
    expect(next).toEqual(fullProjection([a, b, bumped], []));
  });

  it("moves a newly pinned row to the top", () => {
    const test = harness([a, b, c]);
    const pinned = { ...c, pinned: true };
    expect(test.project([a, b, pinned]).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("invalidates only the threads whose pending requests changed", () => {
    const test = harness([a, b, c]);
    const asked = test.project([a, b, c], [request("b")]);

    expect(asked[0]).toBe(test.initial[0]);
    expect(asked[2]).toBe(test.initial[2]);
    expect(asked[1]?.needsAttention).toBe(true);
    expect(asked[1]?.state).toBe("approval");

    const sameRequests = test.project([a, b, c], [request("b")]);
    expect(sameRequests).toBe(asked);

    const answered = test.project([a, b, c], []);
    expect(answered[0]).toBe(test.initial[0]);
    expect(answered[1]?.needsAttention).toBe(false);
    expect(answered).toEqual(fullProjection([a, b, c], []));
  });

  it("drops removed rows without reordering the others", () => {
    const test = harness([a, b, c]);
    const next = test.project([c, a]);
    expect(next).toEqual([test.initial[0], test.initial[2]]);
    expect(next[0]).toBe(test.initial[0]);
    expect(next[1]).toBe(test.initial[2]);
  });

  it("adds new rows in order and hides deleted and subagent rows", () => {
    const test = harness([a, c]);
    const rows = [
      a,
      c,
      b,
      row("deleted", 50, { deleteCommandId: "d" }),
      row("child", 60, { parentThreadId: "a" }),
    ];
    const next = test.project(rows);
    expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(next[0]).toBe(test.initial[0]);
  });

  it("matches a full projection across a sequence of publications", () => {
    const test = harness([a, b, c]);
    const steps: Array<[readonly StoredThreadSummary[], readonly PendingServerRequest[]]> = [
      [[a, b, c], [request("c")]],
      [[a, { ...b, updatedAt: 5 }, c], [request("c")]],
      [[a, { ...b, recencyAt: null, updatedAt: 50 }, c], []],
      [[{ ...a, pinned: true }, c], [request("a")]],
      [
        [row("d", 15), c, { ...a, pinned: true }],
        [request("a"), request("a", "second")],
      ],
      [[], []],
    ];
    for (const [rows, requests] of steps) {
      expect(test.project(rows, requests)).toEqual(fullProjection(rows, requests));
    }
  });

  it("keeps full semantics for duplicate rows and recovers afterwards", () => {
    const test = harness([a, b]);
    expect(test.project([a, a, b]).map((item) => item.id)).toEqual(["a", "a", "b"]);
    expect(test.project([])).toEqual([]);
    expect(test.project([b, a])).toEqual([a, b].map(storedThreadToListItem));
  });
});
