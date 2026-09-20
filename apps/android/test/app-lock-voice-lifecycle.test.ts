import { describe, expect, it, vi } from "vitest";

import { createAppLockVoiceLifecycle } from "../src/data/appLockVoiceLifecycle";

describe("biometric app-lock voice lifecycle", () => {
  it("serializes pause and unlock resume so the final security state wins", async () => {
    const lifecycle = createAppLockVoiceLifecycle();
    const paused = Promise.withResolvers<void>();
    const pauseForAppLock = vi.fn(() => paused.promise);
    const resumeAfterAppUnlock = vi.fn(async () => undefined);
    lifecycle.bind({ pauseForAppLock, resumeAfterAppUnlock });

    const pause = lifecycle.pauseForAppLock();
    const resume = lifecycle.resumeAfterAppUnlock();
    expect(pauseForAppLock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(pauseForAppLock).toHaveBeenCalledOnce());
    expect(resumeAfterAppUnlock).not.toHaveBeenCalled();

    paused.resolve();
    await Promise.all([pause, resume]);
    expect(resumeAfterAppUnlock).toHaveBeenCalledOnce();
  });

  it("applies an already-closed lock to a voice owner bound later", async () => {
    const lifecycle = createAppLockVoiceLifecycle();
    await lifecycle.pauseForAppLock();
    const pauseForAppLock = vi.fn(async () => undefined);
    lifecycle.bind({ pauseForAppLock, resumeAfterAppUnlock: vi.fn(async () => undefined) });

    await vi.waitFor(() => expect(pauseForAppLock).toHaveBeenCalledOnce());
  });

  it("still resumes after a partial pause failure leaves the transport state unknown", async () => {
    const lifecycle = createAppLockVoiceLifecycle();
    const resumeAfterAppUnlock = vi.fn(async () => undefined);
    lifecycle.bind({
      pauseForAppLock: vi.fn(async () => {
        throw new Error("pause failed");
      }),
      resumeAfterAppUnlock,
    });

    await expect(lifecycle.pauseForAppLock()).rejects.toThrow("pause failed");
    await lifecycle.resumeAfterAppUnlock();

    expect(resumeAfterAppUnlock).toHaveBeenCalledOnce();
  });
});
