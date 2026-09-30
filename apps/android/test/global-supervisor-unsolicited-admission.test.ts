import { describe, expect, it, vi } from "vitest";

import {
  appendGlobalSupervisorUnsolicited,
  createGlobalSupervisorUnsolicitedAdmission,
} from "../src/data/globalSupervisorUnsolicitedAdmission";

describe("Global Supervisor unsolicited admission", () => {
  it("stays closed through speech_stopped and opens only after the exchange becomes idle", () => {
    const admission = createGlobalSupervisorUnsolicitedAdmission();
    admission.setLifecycleIdle(true);

    admission.setUserSpeaking(true);
    admission.setLifecycleIdle(false);
    admission.setUserSpeaking(false);

    expect(admission.isOpen()).toBe(false);
    expect(admission.begin()).toBeNull();

    admission.setLifecycleIdle(true);
    expect(admission.isOpen()).toBe(false);
    admission.completeExchange();
    expect(admission.isOpen()).toBe(true);
  });

  it("keeps rapid repeated VAD edges closed until one authoritative idle transition", () => {
    const admission = createGlobalSupervisorUnsolicitedAdmission();
    admission.setLifecycleIdle(true);
    const interrupted = admission.begin();
    if (interrupted === null) {
      throw new Error("Expected an admitted unsolicited exchange");
    }

    admission.setUserSpeaking(true);
    admission.setLifecycleIdle(false);
    admission.setUserSpeaking(false);
    admission.setUserSpeaking(true);
    admission.setUserSpeaking(false);

    expect(interrupted.outcome()).toBe("interrupted");
    expect(admission.isOpen()).toBe(false);
    admission.setLifecycleIdle(true);
    expect(admission.isOpen()).toBe(false);
    admission.completeExchange();
    expect(admission.isOpen()).toBe(true);
  });

  it("queues recovery or context injection without polling while live speech owns the gate", async () => {
    const admission = createGlobalSupervisorUnsolicitedAdmission();
    admission.setLifecycleIdle(true);
    admission.setUserSpeaking(true);
    admission.setLifecycleIdle(false);
    const appendText = vi.fn(async () => undefined);

    const delivery = appendGlobalSupervisorUnsolicited({
      admission,
      appendText,
      signal: undefined,
    });
    await Promise.resolve();
    expect(appendText).not.toHaveBeenCalled();

    admission.setUserSpeaking(false);
    expect(appendText).not.toHaveBeenCalled();
    admission.completeExchange();
    admission.setLifecycleIdle(true);
    await delivery;
    expect(appendText).toHaveBeenCalledOnce();
  });

  it("opens after an authoritative assistant completion when no playback remains", () => {
    const admission = createGlobalSupervisorUnsolicitedAdmission();
    admission.setLifecycleIdle(true);
    const claim = admission.begin();
    if (claim === null) {
      throw new Error("Expected an admitted unsolicited exchange");
    }

    admission.completeExchange();

    expect(claim.outcome()).toBe("completed");
    expect(admission.isOpen()).toBe(true);
  });
});
