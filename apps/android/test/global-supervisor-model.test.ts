import { describe, expect, it, vi } from "vitest";

import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorFeature } from "../src/features/globalSupervisor/createGlobalSupervisorFeature";
import { globalSupervisorToggleState } from "../src/features/globalSupervisor/globalSupervisorToggle";
import {
  GlobalSupervisorStartError,
  type GlobalSupervisorRuntime,
  type GlobalSupervisorRuntimeEvent,
} from "../src/features/globalSupervisor/globalSupervisorContract";

const HOME = globalSupervisorQualifiedChatRef("home-server", "supervisor-thread");

function runtime() {
  const publishers: Array<(event: GlobalSupervisorRuntimeEvent) => void> = [];
  let activationCount = 0;
  const pause = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const value: GlobalSupervisorRuntime = {
    prepare: vi.fn(async () => ({ home: HOME, status: "ready" as const })),
    recover: vi.fn(async () => undefined),
    start: vi.fn(async (_home, next) => {
      publishers.push(next);
      activationCount += 1;
      return {
        activationId: `activation-${String(activationCount)}`,
        home: HOME,
        pause,
        resume,
        stop,
      };
    }),
  };
  return {
    publish(event: GlobalSupervisorRuntimeEvent): void {
      const publish = publishers.at(-1);
      if (publish === undefined) {
        throw new Error("Activation has not started");
      }
      publish(event);
    },
    publishAt(index: number, event: GlobalSupervisorRuntimeEvent): void {
      const publish = publishers[index];
      if (publish === undefined) {
        throw new Error("Activation has not started");
      }
      publish(event);
    },
    pause,
    resume,
    stop,
    value,
  };
}

describe("GlobalSupervisorFeature", () => {
  it("shows startup progress until binding recovery and activation settle", async () => {
    let finishRecovery: (() => void) | null = null;
    const owner = runtime();
    vi.mocked(owner.value.recover).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRecovery = resolve;
        }),
    );
    const feature = createGlobalSupervisorFeature(owner.value);

    const toggling = feature.toggle();

    expect(feature.render$.peek().phase).toBe("activating");
    expect(globalSupervisorToggleState(feature.render$.peek())).toBe("starting");
    await vi.waitFor(() => expect(finishRecovery).not.toBeNull());
    finishRecovery?.();
    await toggling;
    expect(globalSupervisorToggleState(feature.render$.peek())).toBe("active");
    await feature.toggle();
    expect(globalSupervisorToggleState(feature.render$.peek())).toBe("idle");
  });

  it("uses one toggle to create the initial binding, start, and then stop", async () => {
    const owner = runtime();
    const feature = createGlobalSupervisorFeature(owner.value);

    await feature.toggle();

    expect(owner.value.recover).toHaveBeenCalledWith({
      action: "chooseHome",
      label: "Choose home server",
    });
    expect(owner.value.prepare).toHaveBeenCalledOnce();
    expect(owner.value.start).toHaveBeenCalledOnce();
    expect(feature.render$.peek().phase).toBe("listening");

    await feature.toggle();

    expect(owner.stop).toHaveBeenCalledOnce();
    expect(feature.render$.peek().phase).toBe("ready");
  });

  it("runs one prepare-start sequence for duplicate explicit entry and stops it", async () => {
    const owner = runtime();
    const feature = createGlobalSupervisorFeature(owner.value);

    await Promise.all([feature.enter(), feature.enter()]);
    expect(owner.value.prepare).toHaveBeenCalledOnce();
    expect(owner.value.start).toHaveBeenCalledOnce();
    expect(feature.render$.peek()).toMatchObject({ home: HOME, phase: "listening" });
    owner.publish({
      activationId: "activation-1",
      event: "transcript",
      item: { id: "u1", role: "user", text: "Check the build" },
    });
    owner.publish({
      activationId: "activation-1",
      event: "toolActivity",
      label: "Reading chat",
      target: { connectionId: "target-server", threadId: "target-thread" },
    });
    expect(feature.render$.peek()).toMatchObject({
      activity: "Reading chat",
      phase: "toolActivity",
      target: { connectionId: "target-server", threadId: "target-thread" },
      transcript: [{ id: "u1", role: "user", text: "Check the build" }],
    });

    await feature.stop();
    expect(owner.stop).toHaveBeenCalledOnce();
    expect(feature.render$.peek()).toMatchObject({
      home: HOME,
      phase: "ready",
      target: null,
      transcript: [],
    });
    expect(owner.value.recover).not.toHaveBeenCalled();
  });

  it("pauses the live transport for app lock and resumes the same activation after unlock", async () => {
    const owner = runtime();
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();

    await feature.pause();
    expect(owner.pause).toHaveBeenCalledOnce();
    expect(owner.stop).not.toHaveBeenCalled();

    const resuming = feature.resume();
    expect(feature.render$.peek().phase).toBe("reconnecting");
    await resuming;
    expect(owner.resume).toHaveBeenCalledOnce();
    expect(feature.render$.peek().phase).toBe("listening");
    expect(owner.value.start).toHaveBeenCalledOnce();
  });

  it("applies app-lock pause when activation startup settles after the app backgrounds", async () => {
    const owner = runtime();
    const started = Promise.withResolvers<Awaited<ReturnType<GlobalSupervisorRuntime["start"]>>>();
    vi.mocked(owner.value.start).mockImplementationOnce(async () => started.promise);
    const feature = createGlobalSupervisorFeature(owner.value);

    const entering = feature.enter();
    await vi.waitFor(() => expect(owner.value.start).toHaveBeenCalledOnce());
    await feature.pause();
    started.resolve({
      activationId: "activation-after-background",
      home: HOME,
      pause: owner.pause,
      resume: owner.resume,
      stop: owner.stop,
    });
    await entering;

    expect(owner.pause).toHaveBeenCalledOnce();
    expect(feature.render$.peek().phase).toBe("starting");
    await feature.resume();
    expect(owner.resume).toHaveBeenCalledOnce();
    expect(feature.render$.peek().phase).toBe("listening");
  });

  it("publishes a replacement home returned by transparent binding recovery", async () => {
    const owner = runtime();
    const replacement = globalSupervisorQualifiedChatRef("home-server", "replacement-thread");
    vi.mocked(owner.value.start).mockImplementationOnce(async (_home, _publish) => {
      return {
        activationId: "activation-replacement",
        home: replacement,
        pause: owner.pause,
        resume: owner.resume,
        stop: owner.stop,
      };
    });
    const feature = createGlobalSupervisorFeature(owner.value);

    await feature.enter();

    expect(feature.render$.peek()).toMatchObject({ home: replacement, phase: "listening" });
  });

  it("keeps recovery variants explicit and retries preparation through the runtime", async () => {
    const owner = runtime();
    vi.mocked(owner.value.prepare)
      .mockResolvedValueOnce({
        recovery: { action: "reconcileBinding", label: "Repair supervisor binding" },
        status: "unbound",
      })
      .mockResolvedValueOnce({ home: HOME, status: "ready" });
    const feature = createGlobalSupervisorFeature(owner.value);

    await feature.enter();
    expect(feature.render$.peek().recovery).toEqual({
      action: "reconcileBinding",
      label: "Repair supervisor binding",
    });
    await feature.recover();
    expect(owner.value.recover).toHaveBeenCalledWith({
      action: "reconcileBinding",
      label: "Repair supervisor binding",
    });
    expect(feature.render$.peek()).toMatchObject({
      home: HOME,
      phase: "listening",
      recovery: null,
    });
    expect(owner.value.start).toHaveBeenCalledOnce();
  });

  it("ignores late runtime events after terminal failure", async () => {
    const owner = runtime();
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();
    await feature.start();
    owner.publish({
      activationId: "activation-1",
      event: "transcript",
      item: { id: "before-failure", role: "user", text: "temporary" },
    });
    owner.publish({
      activationId: "activation-1",
      event: "failed",
      failure: "realtimeFailed",
      recovery: { action: "reconnectHome", label: "Reconnect home server" },
    });
    owner.publish({
      activationId: "activation-1",
      event: "transcript",
      item: { id: "late", role: "supervisor", text: "late" },
    });
    await vi.waitFor(() =>
      expect(feature.render$.peek()).toMatchObject({
        phase: "failed",
        failureSummary: "The live voice session ended unexpectedly.",
        transcript: [],
      }),
    );
    expect(owner.stop).toHaveBeenCalledOnce();
  });

  it("preserves a terminal failure published before activation startup settles", async () => {
    const owner = runtime();
    vi.mocked(owner.value.start).mockImplementationOnce(async (home, publish) => {
      publish({
        activationId: "activation-before-settlement",
        event: "failed",
        failure: "realtimeFailed",
        recovery: { action: "reconnectHome", label: "Reconnect home server" },
      });
      return {
        activationId: "activation-before-settlement",
        home,
        pause: owner.pause,
        resume: owner.resume,
        stop: owner.stop,
      };
    });
    const feature = createGlobalSupervisorFeature(owner.value);

    await feature.enter();
    await feature.start();

    await vi.waitFor(() =>
      expect(feature.render$.peek()).toMatchObject({
        failureSummary: "The live voice session ended unexpectedly.",
        phase: "failed",
      }),
    );
    expect(owner.stop).toHaveBeenCalledOnce();
  });

  it("fails closed when the current callback carries another activation id", async () => {
    const owner = runtime();
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();
    await feature.start();

    owner.publish({ activationId: "stale-activation", event: "speaking" });

    await vi.waitFor(() =>
      expect(feature.render$.peek()).toMatchObject({
        failureSummary: "The live voice session lost synchronization.",
        phase: "failed",
      }),
    );
    expect(owner.stop).toHaveBeenCalledOnce();
  });

  it("fences callbacks from an earlier activation after restart", async () => {
    const owner = runtime();
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();
    await feature.start();
    await feature.stop();
    await feature.start();

    owner.publishAt(0, { activationId: "activation-1", event: "speaking" });
    expect(feature.render$.peek().phase).toBe("listening");
    owner.publishAt(1, { activationId: "activation-2", event: "thinking" });
    expect(feature.render$.peek().phase).toBe("thinking");
  });

  it("retains cleanup authority after a rejected stop and never exposes its error", async () => {
    const owner = runtime();
    owner.stop
      .mockRejectedValueOnce(new Error("https://service.test/?token=secret cleanup"))
      .mockResolvedValueOnce(undefined);
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();
    await feature.start();

    await expect(feature.stop()).rejects.toThrow("Global Voice Mode cleanup failed");
    expect(feature.render$.peek()).toMatchObject({
      failureSummary: "Global Voice Mode could not stop cleanly.",
      phase: "failed",
    });
    expect(JSON.stringify(feature.render$.peek())).not.toContain("secret");
    await feature.stop();
    expect(owner.stop).toHaveBeenCalledTimes(2);
  });

  it("retains terminal cleanup for retry and publishes the original failure only after release", async () => {
    const owner = runtime();
    owner.stop
      .mockRejectedValueOnce(new Error("terminal cleanup failed"))
      .mockResolvedValueOnce(undefined);
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();
    await feature.start();

    owner.publish({
      activationId: "activation-1",
      event: "failed",
      failure: "realtimeFailed",
      recovery: { action: "reconnectHome", label: "Reconnect home server" },
    });
    await vi.waitFor(() =>
      expect(feature.render$.peek()).toMatchObject({
        failureSummary: "Global Voice Mode could not stop cleanly.",
        phase: "failed",
      }),
    );

    await feature.stop();
    expect(owner.stop).toHaveBeenCalledTimes(2);
    expect(feature.render$.peek()).toMatchObject({
      failureSummary: "The live voice session ended unexpectedly.",
      phase: "failed",
      transcript: [],
    });
  });

  it("maps a secret-bearing start rejection to fixed failure copy", async () => {
    const owner = runtime();
    vi.mocked(owner.value.start).mockRejectedValueOnce(
      new Error("https://service.test/?token=secret startup"),
    );
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();

    await feature.start();

    expect(feature.render$.peek()).toMatchObject({
      failureSummary: "Global Voice Mode could not start.",
      phase: "failed",
    });
    expect(JSON.stringify(feature.render$.peek())).not.toContain("secret");
  });

  it("preserves microphone-busy startup recovery without exposing runtime detail", async () => {
    const owner = runtime();
    vi.mocked(owner.value.start).mockRejectedValueOnce(
      new GlobalSupervisorStartError("microphoneBusy", {
        action: "retryMicrophoneBusy",
        label: "Try microphone again",
      }),
    );
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();

    await feature.start();

    expect(feature.render$.peek()).toMatchObject({
      failureSummary: "The microphone is already in use.",
      phase: "failed",
      recovery: { action: "retryMicrophoneBusy" },
    });
  });

  it("projects denied microphone permission through the fixed failure surface", async () => {
    const owner = runtime();
    vi.mocked(owner.value.start).mockRejectedValueOnce(
      new GlobalSupervisorStartError("microphonePermissionDenied", {
        action: "retryMicrophoneBusy",
        label: "Try microphone again",
      }),
    );
    const feature = createGlobalSupervisorFeature(owner.value);

    await feature.enter();

    expect(feature.render$.peek()).toMatchObject({
      failureSummary: "Microphone access is required.",
      phase: "failed",
      recovery: { action: "retryMicrophoneBusy" },
    });
  });

  it("publishes the creating home identity without permitting another start", async () => {
    let completePreparation:
      | ((value: { readonly home: typeof HOME; readonly status: "ready" }) => void)
      | null = null;
    const owner = runtime();
    vi.mocked(owner.value.prepare).mockImplementation(async (publish) => {
      publish({ homeConnectionId: "home-server", status: "creating" });
      return new Promise((resolve) => {
        completePreparation = resolve;
      });
    });
    const feature = createGlobalSupervisorFeature(owner.value);

    const entering = feature.enter();
    await Promise.resolve();
    expect(globalSupervisorToggleState(feature.render$.peek())).toBe("starting");
    expect(feature.render$.peek()).toEqual({
      activity: null,
      home: { connectionId: "home-server", threadId: null },
      phase: "creating",
      recovery: null,
      target: null,
      transcript: [],
    });
    completePreparation?.({ home: HOME, status: "ready" });
    await entering;
  });

  it("settles duplicate terminal cleanup through one retained activation", async () => {
    let release: (() => void) | null = null;
    const owner = runtime();
    owner.stop.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const feature = createGlobalSupervisorFeature(owner.value);
    await feature.enter();
    await feature.start();

    const first = feature.stop();
    const second = feature.stop();
    await vi.waitFor(() => expect(owner.stop).toHaveBeenCalledTimes(1));
    expect(feature.render$.peek().phase).toBe("stopping");
    expect(globalSupervisorToggleState(feature.render$.peek())).toBe("stopping");
    release?.();
    await Promise.all([first, second]);
    expect(feature.render$.peek().phase).toBe("ready");
  });
});
