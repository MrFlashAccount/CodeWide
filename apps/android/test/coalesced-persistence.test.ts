import { describe, expect, it, vi } from "vitest";

import {
  CoalescedPersistenceWriter,
  coalescePersistedTransactions,
  type PersistedTransaction,
} from "../src/data/coalesced-persistence";
import type { ClaimedCommit } from "../src/data/durable-commit-tracker";

function tx(seq: number, value: Record<string, unknown>, options: { truncate?: boolean } = {}): PersistedTransaction {
  return {
    txId: `tx-${seq}`,
    term: 1,
    seq,
    rowVersion: seq,
    ...(options.truncate === true ? { truncate: true } : {}),
    mutations: [{ type: "update", key: "thread", value }],
  };
}

function commit(forceFlush: boolean): { ticket: ClaimedCommit; persisted: Promise<void> } {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const persisted = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { ticket: { forceFlush, resolve, reject }, persisted };
}

describe("coalesced SQLite persistence", () => {
  it("writes only the newest complete row for a live checkpoint", async () => {
    const persisted: PersistedTransaction[] = [];
    const writer = new CoalescedPersistenceWriter({
      delayMs: 250,
      persist: async (_collectionId, transaction) => { persisted.push(transaction); },
    });

    await writer.enqueue("thread-details-v2", tx(1, { text: "a" }), null);
    await writer.enqueue("thread-details-v2", tx(2, { text: "ab" }), null);
    await writer.enqueue("thread-details-v2", tx(3, { text: "abc" }), null);
    expect(persisted).toEqual([]);

    await writer.flush("thread-details-v2");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ seq: 3, rowVersion: 3 });
    expect(persisted[0]?.mutations).toEqual([{ type: "update", key: "thread", value: { text: "abc" } }]);
  });

  it("resolves cursor checkpoints only after the grouped write finishes", async () => {
    let release!: () => void;
    const disk = new Promise<void>((resolve) => { release = resolve; });
    const writer = new CoalescedPersistenceWriter({
      delayMs: 250,
      persist: async () => await disk,
    });
    const first = commit(false);
    const boundary = commit(true);
    let firstResolved = false;
    void first.persisted.then(() => { firstResolved = true; });

    await writer.enqueue("thread-details-v2", tx(1, { text: "a" }), first.ticket);
    const forced = writer.enqueue("thread-details-v2", tx(2, { text: "done" }), boundary.ticket);
    await Promise.resolve();
    expect(firstResolved).toBe(false);

    release();
    await forced;
    await Promise.all([first.persisted, boundary.persisted]);
    expect(firstResolved).toBe(true);
  });

  it("drops mutations older than the newest truncate", () => {
    const merged = coalescePersistedTransactions([
      tx(1, { stale: true }),
      tx(2, { fresh: true }, { truncate: true }),
      tx(3, { latest: true }),
    ]);

    expect(merged.truncate).toBe(true);
    expect(merged.seq).toBe(3);
    expect(merged.mutations).toEqual([{ type: "update", key: "thread", value: { latest: true } }]);
  });

  it("flushes automatically on the checkpoint cadence", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => undefined);
    const writer = new CoalescedPersistenceWriter({ delayMs: 250, persist });
    await writer.enqueue("thread-details-v2", tx(1, { text: "a" }), null);

    await vi.advanceTimersByTimeAsync(249);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
