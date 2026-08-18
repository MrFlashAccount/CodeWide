import { describe, expect, it } from "vitest";

import { SerialTaskQueue } from "../src/data/serial-task-queue";

describe("serial task queue", () => {
  it("prevents projection and RPC refresh writes from overlapping", async () => {
    const queue = new SerialTaskQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    });
    const second = queue.run(async () => { order.push("second"); });

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("continues after a failed write", async () => {
    const queue = new SerialTaskQueue();
    await expect(queue.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });
});
