import { describe, expect, it } from "vitest";
import {
  getOrCreateThreadUiState,
  type ThreadUiStateSeedDatabase,
} from "../src/data/thread-ui-state-initialization";
import type { ThreadUiStateRow } from "../src/data/thread-ui-state-types";

function row(connectionId: string, threadId: string): ThreadUiStateRow {
  return {
    id: `${connectionId}:${threadId}`,
    connectionId,
    threadId,
    draftText: "restored",
    attachments: [],
    scrollOffset: 120,
    historyAnchorTurnId: "anchor",
    historyAnchorOffsetPx: 12,
    preferences: null,
    updatedAt: 1,
  };
}

function pendingSeed() {
  const pending = Promise.withResolvers<ThreadUiStateRow>();
  let calls = 0;
  const database: ThreadUiStateSeedDatabase = {
    get: () => null,
    getOrCreate: () => {
      calls += 1;
      return pending.promise;
    },
  };
  return { pending, database, calls: () => calls };
}

describe("shared V1 thread UI state initialization", () => {
  it("shares one unresolved seed across draft, attachments, preferences and anchor reads", async () => {
    const seed = pendingSeed();
    const requests = [0, 1, 2, 3].map(() =>
      getOrCreateThreadUiState("shared", "thread", seed.database),
    );
    expect(seed.calls()).toBe(1);
    const restored = row("shared", "thread");
    seed.pending.resolve(restored);
    for (const result of await Promise.all(requests)) expect(result).toBe(restored);
    expect(restored.draftText).toBe("restored");
    expect(restored.scrollOffset).toBe(120);
  });

  it("partitions simultaneous seeds by connection as well as thread", async () => {
    const left = pendingSeed();
    const right = pendingSeed();
    const a = getOrCreateThreadUiState("left", "same-thread", left.database);
    const b = getOrCreateThreadUiState("right", "same-thread", right.database);
    expect(left.calls()).toBe(1);
    expect(right.calls()).toBe(1);
    const leftRow = row("left", "same-thread");
    const rightRow = row("right", "same-thread");
    left.pending.resolve(leftRow);
    right.pending.resolve(rightRow);
    expect(await a).toBe(leftRow);
    expect(await b).toBe(rightRow);
  });

  it("releases a failed seed so a later reader can retry", async () => {
    const failed = pendingSeed();
    const initial = getOrCreateThreadUiState("retry", "thread", failed.database);
    const concurrent = getOrCreateThreadUiState("retry", "thread", failed.database);
    const failure = new Error("seed unavailable");
    failed.pending.reject(failure);
    await expect(initial).rejects.toBe(failure);
    await expect(concurrent).rejects.toBe(failure);
    const replacement = pendingSeed();
    const next = getOrCreateThreadUiState("retry", "thread", replacement.database);
    expect(replacement.calls()).toBe(1);
    const restored = row("retry", "thread");
    replacement.pending.resolve(restored);
    expect(await next).toBe(restored);
  });

  it("returns the cached row without starting initialization", async () => {
    const restored = row("cached", "thread");
    const database: ThreadUiStateSeedDatabase = {
      get: () => restored,
      getOrCreate: () => {
        throw new Error("must use the cached row");
      },
    };
    expect(await getOrCreateThreadUiState("cached", "thread", database)).toBe(restored);
    await expect(getOrCreateThreadUiState("missing", "thread", null)).rejects.toThrow(
      "Local thread UI state is not ready",
    );
  });
});
