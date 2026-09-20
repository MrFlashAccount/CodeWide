import { describe, expect, it, vi } from "vitest";

import { createGlobalSupervisorMediaOwner } from "../src/data/globalSupervisorMediaOwner";

describe("Global Voice media owner", () => {
  it("does not report closed until the active device capture has stopped", async () => {
    const nativeStop = Promise.withResolvers<void>();
    const owner = createGlobalSupervisorMediaOwner(
      vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0",
        stop: vi.fn(() => nativeStop.promise),
      })),
    );
    const session = await owner.start({ mode: "interactive", onLevel: vi.fn(), onTerminal: vi.fn() });
    let closed = false;
    const closing = owner.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);
    const stopping = session.stop();
    nativeStop.resolve();
    await Promise.all([closing, stopping]);
    expect(closed).toBe(true);
  });

  it("stops a late native start before close releases the activation lease", async () => {
    const nativeStart = Promise.withResolvers<{
      readonly acceptAnswer: () => Promise<void>;
      readonly offerSdp: string;
      readonly stop: () => Promise<void>;
    }>();
    const stop = vi.fn(async () => undefined);
    const owner = createGlobalSupervisorMediaOwner(vi.fn(() => nativeStart.promise));
    const starting = owner.start({
      mode: "interactive",
      onLevel: vi.fn(),
      onTerminal: vi.fn(),
    });
    const closing = owner.close();

    nativeStart.resolve({
      acceptAnswer: vi.fn(async () => undefined),
      offerSdp: "v=0",
      stop,
    });

    await expect(starting).rejects.toThrow("closed during startup");
    await closing;
    expect(stop).toHaveBeenCalledOnce();
  });
});
