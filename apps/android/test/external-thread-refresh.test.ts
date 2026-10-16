import { afterEach, describe, expect, it, vi } from "vitest";
import { createExternalThreadRefreshScheduler } from "../src/data/externalThreadRefresh";

afterEach(() => {
  vi.useRealTimers();
});

describe("external thread refresh", () => {
  it("coalesces progress for only the selected externally owned thread", async () => {
    vi.useFakeTimers();
    const external = new Set(["server\u0000thread"]);
    const desired = new Set(["server\u0000thread"]);
    const refresh = vi.fn(async () => undefined);
    const onError = vi.fn();
    const scheduler = createExternalThreadRefreshScheduler({
      delayMs: 750,
      isDesired: (connectionId, threadId) => desired.has(`${connectionId}\u0000${threadId}`),
      isExternal: (connectionId, threadId) => external.has(`${connectionId}\u0000${threadId}`),
      onError,
      refresh,
    });

    for (let index = 0; index < 100; index += 1) {
      scheduler.schedule("server", "thread");
      scheduler.schedule("server", "other");
    }
    await vi.advanceTimersByTimeAsync(749);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledExactlyOnceWith("server", "thread");
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancels pending work when the connection is forgotten", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createExternalThreadRefreshScheduler({
      delayMs: 750,
      isDesired: () => true,
      isExternal: () => true,
      onError: vi.fn(),
      refresh,
    });
    scheduler.schedule("server", "thread");
    scheduler.forgetConnection("server");
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
  });
});
