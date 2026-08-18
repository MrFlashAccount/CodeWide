import { describe, expect, it, vi } from "vitest";

import { OrderedProjectionGate, type ProjectionWork } from "../src/native/ordered-projection-gate";

describe("OrderedProjectionGate", () => {
  it("does not apply or acknowledge later live batches after a failed batch", async () => {
    const applied: number[] = [];
    const acknowledged: number[] = [];
    const failures: unknown[] = [];
    const gate = new OrderedProjectionGate((cause) => failures.push(cause));

    gate.enqueue({
      recovery: false,
      apply: async () => { applied.push(10); throw new Error("disk full"); },
      acknowledge: () => acknowledged.push(10),
    });
    gate.enqueue({
      recovery: false,
      apply: async () => { applied.push(11); },
      acknowledge: () => acknowledged.push(11),
    });
    await gate.settled();

    expect(applied).toEqual([10]);
    expect(acknowledged).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(gate.blocked).toBe(true);
  });

  it("reopens only after a successful checkpoint replay", async () => {
    const apply = vi.fn<(cursor: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(undefined);
    const acknowledged: number[] = [];
    const gate = new OrderedProjectionGate(() => undefined);

    gate.enqueue({ recovery: false, apply: () => apply(20), acknowledge: () => acknowledged.push(20) });
    gate.enqueue({ recovery: false, apply: () => apply(21), acknowledge: () => acknowledged.push(21) });
    gate.enqueue({ recovery: true, apply: () => apply(21), acknowledge: () => acknowledged.push(21) });
    gate.enqueue({ recovery: false, apply: () => apply(22), acknowledge: () => acknowledged.push(22) });
    await gate.settled();

    expect(apply.mock.calls.map(([cursor]) => cursor)).toEqual([20, 21, 22]);
    expect(acknowledged).toEqual([21, 22]);
    expect(gate.blocked).toBe(false);
  });

  it("stays blocked when checkpoint recovery also fails", async () => {
    const applied: string[] = [];
    const gate = new OrderedProjectionGate(() => undefined);

    gate.enqueue({ recovery: false, apply: async () => { throw new Error("live"); }, acknowledge: () => undefined });
    gate.enqueue({ recovery: true, apply: async () => { applied.push("checkpoint"); throw new Error("checkpoint"); }, acknowledge: () => undefined });
    gate.enqueue({ recovery: false, apply: async () => { applied.push("later"); }, acknowledge: () => undefined });
    await gate.settled();

    expect(applied).toEqual(["checkpoint"]);
  });

  it("coalesces queued live batches while the current durable projection is busy", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const applied: number[][] = [];
    const acknowledged: number[] = [];
    const gate = new OrderedProjectionGate(() => undefined);
    const batch = (values: number[]): ProjectionWork => ({
      recovery: false,
      apply: async () => { applied.push(values); },
      acknowledge: () => acknowledged.push(values.at(-1)!),
      mergeWith: (newer) => {
        const tagged = newer as ProjectionWork & { values?: number[] };
        return tagged.values === undefined ? null : batch([...values, ...tagged.values]);
      },
      values,
    } as ProjectionWork & { values: number[] });

    gate.enqueue({ recovery: false, apply: async () => { await blocked; }, acknowledge: () => acknowledged.push(1) });
    gate.enqueue(batch([2]));
    gate.enqueue(batch([3, 4]));
    release();
    await gate.settled();

    expect(applied).toEqual([[2, 3, 4]]);
    expect(acknowledged).toEqual([1, 4]);
  });
});
