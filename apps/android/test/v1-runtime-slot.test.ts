import { afterEach, describe, expect, it, vi } from "vitest";

import { activateRuntime, stopRuntime } from "../src/boot/runtimeSlot";

afterEach(stopRuntime);

describe("V1 native runtime ownership", () => {
  it("shares the active handle without starting another native runtime", async () => {
    const handle = { start: vi.fn(), stop: vi.fn() };
    const create = vi.fn(() => handle);
    expect(await activateRuntime(create)).toBe(handle);
    expect(await activateRuntime(create)).toBe(handle);
    expect(create).toHaveBeenCalledTimes(1);
    expect(handle.start).toHaveBeenCalledTimes(1);
    await stopRuntime();
    await stopRuntime();
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it("waits for asynchronous cleanup before starting a remounted workspace", async () => {
    const stopped = Promise.withResolvers<void>();
    const events: string[] = [];
    await activateRuntime(() => ({
      stop: async () => {
        events.push("stop started");
        await stopped.promise;
        events.push("stop finished");
      },
    }));
    const stop = stopRuntime();
    const activation = activateRuntime(() => ({
      start: () => {
        events.push("start");
      },
      stop: () => undefined,
    }));
    await Promise.resolve();
    expect(events).toEqual(["stop started"]);
    stopped.resolve();
    await stop;
    await activation;
    expect(events).toEqual(["stop started", "stop finished", "start"]);
  });

  it("disposes failed startup and allows a later activation", async () => {
    const stop = vi.fn();
    await expect(
      activateRuntime(() => ({
        start: () => {
          throw new Error("start failed");
        },
        stop,
      })),
    ).rejects.toThrow("start failed");
    expect(stop).toHaveBeenCalledTimes(1);
    const handle = { stop: vi.fn() };
    expect(await activateRuntime(() => handle)).toBe(handle);
  });
});
