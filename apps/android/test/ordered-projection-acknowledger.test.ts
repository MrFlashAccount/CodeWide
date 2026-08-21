import { describe, expect, it } from "vitest";

import { OrderedProjectionAcknowledger } from "../src/native/ordered-projection-acknowledger";

describe("OrderedProjectionAcknowledger", () => {
  it("keeps cursors ordered while checkpoints finish asynchronously", async () => {
    let release!: () => void;
    const firstCheckpoint = new Promise<void>((resolve) => { release = resolve; });
    const acknowledged: number[] = [];
    const acknowledger = new OrderedProjectionAcknowledger(() => undefined);

    acknowledger.enqueue({ recovery: false, checkpoint: firstCheckpoint, acknowledge: () => acknowledged.push(1) });
    acknowledger.enqueue({ recovery: false, checkpoint: Promise.resolve(), acknowledge: () => acknowledged.push(2) });
    await Promise.resolve();
    expect(acknowledged).toEqual([]);

    release();
    await acknowledger.settled();
    expect(acknowledged).toEqual([1, 2]);
  });

  it("blocks later cursors after a failed checkpoint until recovery persists", async () => {
    const acknowledged: number[] = [];
    const failures: unknown[] = [];
    const acknowledger = new OrderedProjectionAcknowledger((cause) => failures.push(cause));

    acknowledger.enqueue({
      recovery: false,
      checkpoint: Promise.reject(new Error("disk failure")),
      acknowledge: () => acknowledged.push(1),
    });
    acknowledger.enqueue({ recovery: false, checkpoint: Promise.resolve(), acknowledge: () => acknowledged.push(2) });
    acknowledger.enqueue({ recovery: true, checkpoint: Promise.resolve(), acknowledge: () => acknowledged.push(3) });
    acknowledger.enqueue({ recovery: false, checkpoint: Promise.resolve(), acknowledge: () => acknowledged.push(4) });
    await acknowledger.settled();

    expect(failures).toHaveLength(1);
    expect(acknowledged).toEqual([3, 4]);
    expect(acknowledger.blocked).toBe(false);
  });
});
