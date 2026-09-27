import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGlobalSupervisorReconnectOwner,
  type GlobalSupervisorTransportStart,
} from "../src/data/globalSupervisorReconnectOwner";
import { GLOBAL_SUPERVISOR_RECONNECT_POLICY } from "../src/data/globalSupervisorRecoveryPolicy";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture() {
  let ready: "ready" | "waiting" | "blocked" = "ready";
  const listeners = new Set<() => void>();
  const transports: Array<{
    stop: ReturnType<typeof vi.fn>;
    setMicrophoneMuted: ReturnType<typeof vi.fn>;
    options: GlobalSupervisorTransportStart;
  }> = [];
  const failed = vi.fn();
  const reconnecting = vi.fn();
  const recovered = vi.fn();
  const startTransport = vi.fn(async (options: GlobalSupervisorTransportStart) => {
    const transport = {
      options,
      setMicrophoneMuted: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    transports.push(transport);
    return transport;
  });
  const owner = createGlobalSupervisorReconnectOwner({
    onFatalFailure: failed,
    onReconnecting: reconnecting,
    onRecovered: recovered,
    policy: GLOBAL_SUPERVISOR_RECONNECT_POLICY,
    readiness: {
      read: () => ready,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    startTransport,
  });
  return {
    owner,
    transports,
    startTransport,
    failed,
    recovered,
    reconnecting,
    listeners,
    readiness(next: typeof ready) {
      ready = next;
      for (const changed of listeners) changed();
    },
  };
}

describe("Global Voice outage recovery contract", () => {
  it("a rejected initial activation cannot be resurrected by later network callbacks", async () => {
    const input = fixture();
    input.startTransport.mockRejectedValueOnce(new Error("startup failed"));
    await expect(input.owner.start()).rejects.toThrow("startup failed");
    expect(input.listeners.size).toBe(0);
    input.readiness("waiting");
    input.readiness("ready");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(input.startTransport).toHaveBeenCalledOnce();
    expect(input.failed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("parks offline without opening peers, then recovers the same activation after RPC returns", async () => {
    const input = fixture();
    await input.owner.start();
    input.readiness("waiting");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    expect(input.startTransport).toHaveBeenCalledOnce();
    expect(input.failed).not.toHaveBeenCalled();
    input.readiness("ready");
    await vi.advanceTimersByTimeAsync(250);
    expect(input.transports).toHaveLength(2);
    await input.owner.stop();
  });

  it("preserves explicit mute through replacement and never reconnects just to unmute", async () => {
    const input = fixture();
    await input.owner.start();
    await input.owner.setMicrophoneMuted(true);
    input.transports[0]?.options.onTerminal();
    input.transports[0]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(250);
    expect(input.transports).toHaveLength(2);
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    expect(input.transports[1]?.options.microphoneMuted).toBe(true);
    await input.owner.setMicrophoneMuted(false);
    expect(input.transports[1]?.setMicrophoneMuted).toHaveBeenCalledWith(false);
    expect(input.transports).toHaveLength(2);
    await input.owner.stop();
  });

  it("keeps an enabled activation parked for a day and recovers without another user action", async () => {
    const input = fixture();
    await input.owner.start();
    input.readiness("waiting");
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(input.failed).not.toHaveBeenCalled();
    expect(input.startTransport).toHaveBeenCalledOnce();
    expect(input.listeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    input.readiness("ready");
    await vi.advanceTimersByTimeAsync(250);
    expect(input.startTransport).toHaveBeenCalledTimes(2);
    expect(input.transports[1]?.options.reason).toBe("recovery");
    expect(input.failed).not.toHaveBeenCalled();
    await input.owner.stop();
  });

  it("resets backoff after ten stable seconds without a lifetime retry limit", async () => {
    const input = fixture();
    await input.owner.start();
    for (let index = 0; index < 6; index += 1) {
      input.readiness("waiting");
      await vi.advanceTimersByTimeAsync(15_000);
      input.readiness("ready");
      await vi.advanceTimersByTimeAsync(10_250);
      expect(input.transports).toHaveLength(index + 2);
    }
    expect(input.failed).not.toHaveBeenCalled();
    await input.owner.stop();
  });

  it("does not reset backoff for short-lived replacements", async () => {
    const input = fixture();
    await input.owner.start();
    input.transports[0]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(250);
    input.transports[1]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(499);
    expect(input.transports).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(input.transports).toHaveLength(3);
    expect(input.failed).not.toHaveBeenCalled();
    await input.owner.stop();
  });

  it("reports same-peer recovery once, without initial or duplicate connected notifications", async () => {
    const input = fixture();
    await input.owner.start();
    input.transports[0]?.options.onConnected();
    expect(input.recovered).not.toHaveBeenCalled();
    input.transports[0]?.options.onSuspended();
    await vi.advanceTimersByTimeAsync(2000);
    expect(input.transports).toHaveLength(1);
    expect(input.transports[0]?.stop).not.toHaveBeenCalled();
    input.transports[0]?.options.onConnected();
    input.transports[0]?.options.onConnected();
    expect(input.recovered).toHaveBeenCalledExactlyOnceWith(input.transports[0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(input.failed).not.toHaveBeenCalled();
    await input.owner.stop();
  });

  it("Stop cancels offline waiting and microphone handoff cannot resurrect an activation", async () => {
    const input = fixture();
    await input.owner.start();
    input.readiness("waiting");
    await vi.advanceTimersByTimeAsync(1);
    await input.owner.stop();
    input.readiness("ready");
    await input.owner.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(input.transports).toHaveLength(1);
    expect(input.failed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands off capture before dictation and resumes one transport", async () => {
    const input = fixture();
    await input.owner.start();
    await input.owner.pause();
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    await input.owner.resume();
    expect(input.transports).toHaveLength(2);
    expect(input.transports[1]?.options.reason).toBe("resume");
    expect(input.recovered).not.toHaveBeenCalled();
    await input.owner.stop();
  });

  it("keeps retrying service/media start failures beyond a minute at the bounded retry rate", async () => {
    const input = fixture();
    await input.owner.start();
    input.startTransport.mockRejectedValue(new Error("service temporarily unavailable"));
    input.transports[0]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(input.failed).not.toHaveBeenCalled();
    expect(input.startTransport.mock.calls.length).toBeGreaterThan(8);
    expect(input.startTransport.mock.calls.length).toBeLessThan(20);
    expect(input.listeners.size).toBe(1);
    await input.owner.stop();
    const attempts = input.startTransport.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(input.startTransport).toHaveBeenCalledTimes(attempts);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("authorization loss is terminal without retry storms", async () => {
    const input = fixture();
    await input.owner.start();
    input.readiness("blocked");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(input.failed).toHaveBeenCalledExactlyOnceWith("accessRequired");
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    expect(input.startTransport).toHaveBeenCalledOnce();
  });

  it("does not start a replacement when the old remote cleanup has an uncertain outcome", async () => {
    const input = fixture();
    await input.owner.start();
    input.transports[0]?.stop.mockRejectedValueOnce(new Error("stop acknowledgement timed out"));
    input.transports[0]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(input.failed).toHaveBeenCalledExactlyOnceWith("transportFailed");
    expect(input.startTransport).toHaveBeenCalledOnce();
    await input.owner.stop();
  });

  it("aborts a pending replacement and closes a late result without installing it", async () => {
    const input = fixture();
    await input.owner.start();
    const pending = Promise.withResolvers<(typeof input.transports)[number]>();
    input.startTransport.mockImplementationOnce(() => pending.promise);
    input.transports[0]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(250);
    const attempt = input.startTransport.mock.calls.at(-1)?.[0];
    if (attempt === undefined) throw new Error("Expected a pending replacement");
    const stopping = input.owner.stop();
    expect(attempt.signal.aborted).toBe(true);
    const late = {
      options: attempt,
      stop: vi.fn(async () => undefined),
      setMicrophoneMuted: vi.fn(async () => undefined),
    };
    pending.resolve(late);
    await stopping;
    expect(late.stop).toHaveBeenCalledOnce();
    expect(input.failed).not.toHaveBeenCalled();
  });

  it("does not retry a discarded replacement whose cleanup failed", async () => {
    const input = fixture();
    await input.owner.start();
    const pending = Promise.withResolvers<(typeof input.transports)[number]>();
    input.startTransport.mockImplementationOnce(() => pending.promise);
    input.transports[0]?.options.onTerminal();
    await vi.advanceTimersByTimeAsync(250);
    const attempt = input.startTransport.mock.calls.at(-1)?.[0];
    if (attempt === undefined) throw new Error("Expected a pending replacement");
    input.readiness("waiting");
    const stop = vi.fn(async () => {
      throw new Error("cleanup uncertain");
    });
    pending.resolve({ options: attempt, stop, setMicrophoneMuted: vi.fn(async () => undefined) });
    await vi.advanceTimersByTimeAsync(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(input.failed).toHaveBeenCalledExactlyOnceWith("transportFailed");
    input.readiness("ready");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(input.startTransport).toHaveBeenCalledTimes(2);
    await input.owner.stop();
  });

  it("Stop also fences the asynchronous mute correction at the end of startup", async () => {
    const input = fixture();
    const correction = Promise.withResolvers<undefined>();
    input.startTransport.mockImplementationOnce(async (options) => {
      const transport = {
        options,
        stop: vi.fn(async () => undefined),
        setMicrophoneMuted: vi.fn(async () => correction.promise),
      };
      input.transports.push(transport);
      return transport;
    });
    const starting = input.owner.start();
    const rejected = expect(starting).rejects.toThrow("unavailable during startup");
    await input.owner.setMicrophoneMuted(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(input.transports[0]?.setMicrophoneMuted).toHaveBeenCalledWith(true);
    const stopping = input.owner.stop();
    correction.resolve(undefined);
    await Promise.all([stopping, rejected]);
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(input.transports).toHaveLength(1);
    expect(input.failed).not.toHaveBeenCalled();
  });
});
