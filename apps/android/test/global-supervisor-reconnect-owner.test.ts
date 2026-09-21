import { describe, expect, it, vi } from "vitest";

import {
  createGlobalSupervisorReconnectOwner,
  type GlobalSupervisorTransport,
} from "../src/data/globalSupervisorReconnectOwner";

type TransportFixture = GlobalSupervisorTransport & {
  microphoneMuted: boolean;
  readonly terminate: () => void;
};

function fixture(retryCount = 4) {
  const transports: TransportFixture[] = [];
  const starts: Array<() => void> = [];
  const exhausted = vi.fn();
  const reconnecting = vi.fn();
  const createWait = vi.fn(() => {
    const result = Promise.withResolvers<boolean>();
    starts.push(() => result.resolve(true));
    return { cancel: () => result.resolve(false), promise: result.promise };
  });
  const owner = createGlobalSupervisorReconnectOwner({
    createWait,
    onExhausted: exhausted,
    onReconnecting: reconnecting,
    policy: { retryDelaysMs: Array.from({ length: retryCount }, () => 1) },
    startTransport: vi.fn(async (onTerminal, microphoneMuted) => {
      const transport: TransportFixture = {
        microphoneMuted,
        setMicrophoneMuted: vi.fn(async (muted: boolean) => {
          transport.microphoneMuted = muted;
        }),
        stop: vi.fn(async () => undefined),
        terminate: onTerminal,
      };
      transports.push(transport);
      return transport;
    }),
  });
  return { createWait, exhausted, owner, reconnecting, starts, transports };
}

async function finishNextRetry(input: ReturnType<typeof fixture>): Promise<void> {
  await vi.waitFor(() => expect(input.starts.length).toBeGreaterThan(0));
  input.starts.shift()?.();
  await vi.waitFor(() => expect(input.transports.length).toBeGreaterThan(1));
}

describe("Global Voice transport reconnect owner", () => {
  it("keeps explicit mute through transport replacement and unmute does not reconnect", async () => {
    const input = fixture();
    await input.owner.start();

    await input.owner.setMicrophoneMuted(true);
    expect(input.transports[0]?.microphoneMuted).toBe(true);
    expect(input.transports).toHaveLength(1);

    input.transports[0]?.terminate();
    await finishNextRetry(input);
    expect(input.transports[1]?.microphoneMuted).toBe(true);

    await input.owner.setMicrophoneMuted(false);
    expect(input.transports[1]?.microphoneMuted).toBe(false);
    expect(input.transports).toHaveLength(2);
  });

  it("keeps the logical activation alive across the VPN route-change regression", async () => {
    const input = fixture();
    await input.owner.start();

    input.transports[0]?.terminate();

    expect(input.reconnecting).toHaveBeenCalledOnce();
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    await finishNextRetry(input);
    expect(input.transports).toHaveLength(2);
    expect(input.exhausted).not.toHaveBeenCalled();
  });

  it("serializes network handoffs without two live transports", async () => {
    const input = fixture();
    await input.owner.start();
    input.transports[0]?.terminate();
    input.transports[0]?.terminate();

    await finishNextRetry(input);
    expect(input.createWait).toHaveBeenCalledOnce();
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    expect(input.transports).toHaveLength(2);
  });

  it("bounds repeated route flaps and exposes exhaustion once", async () => {
    const input = fixture(2);
    await input.owner.start();

    input.transports[0]?.terminate();
    await finishNextRetry(input);
    input.transports[1]?.terminate();
    await vi.waitFor(() => expect(input.starts).toHaveLength(1));
    input.starts.shift()?.();
    await vi.waitFor(() => expect(input.transports).toHaveLength(3));
    input.transports[2]?.terminate();

    await vi.waitFor(() => expect(input.exhausted).toHaveBeenCalledOnce());
    expect(input.reconnecting).toHaveBeenCalledTimes(3);
  });

  it("cancels a pending reconnect when Stop wins the race", async () => {
    const input = fixture();
    await input.owner.start();
    input.transports[0]?.terminate();
    await vi.waitFor(() => expect(input.starts).toHaveLength(1));

    await input.owner.stop();
    input.starts.shift()?.();

    expect(input.transports).toHaveLength(1);
    expect(input.exhausted).not.toHaveBeenCalled();
  });

  it("stops capture before dictation and resumes with exactly one transport", async () => {
    const input = fixture();
    await input.owner.start();

    await input.owner.pause();
    expect(input.transports[0]?.stop).toHaveBeenCalledOnce();
    expect(input.transports).toHaveLength(1);

    await input.owner.resume();
    expect(input.transports).toHaveLength(2);
    expect(input.transports[1]?.stop).not.toHaveBeenCalled();
    expect(input.createWait).not.toHaveBeenCalled();
  });

  it("lets microphone handoff pause a pending network reconnect", async () => {
    const input = fixture();
    await input.owner.start();
    input.transports[0]?.terminate();
    await vi.waitFor(() => expect(input.starts).toHaveLength(1));

    await input.owner.pause();
    input.starts.shift()?.();
    expect(input.transports).toHaveLength(1);

    await input.owner.resume();
    expect(input.transports).toHaveLength(2);
  });

  it("does not resume after explicit Stop during microphone handoff", async () => {
    const input = fixture();
    await input.owner.start();
    await input.owner.pause();

    await input.owner.stop();
    await input.owner.resume();

    expect(input.transports).toHaveLength(1);
    expect(input.exhausted).not.toHaveBeenCalled();
  });
});
