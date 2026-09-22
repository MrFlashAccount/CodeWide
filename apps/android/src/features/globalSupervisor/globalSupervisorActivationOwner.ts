import { observablePrimitive, type ObservablePrimitive } from "@legendapp/state";

import {
  type GlobalSupervisorActivation,
  type GlobalSupervisorFailureKind,
  type GlobalSupervisorHome,
  type GlobalSupervisorRecovery,
  type GlobalSupervisorRuntime,
  type GlobalSupervisorRuntimeEvent,
  GlobalSupervisorStartError,
} from "./globalSupervisorContract";
import type { GlobalSupervisorRenderModel } from "./globalSupervisorRenderModel";

type ActivationAttempt = {
  activation: GlobalSupervisorActivation | null;
  readonly bufferedEvents: GlobalSupervisorRuntimeEvent[];
  cleanupPromise: Promise<boolean> | null;
  microphoneMutation: Promise<void> | null;
  requestedMicrophoneMuted: boolean;
  terminal: boolean;
  terminalProjection: {
    readonly failure: GlobalSupervisorFailureKind;
    readonly recovery: GlobalSupervisorRecovery;
  } | null;
};

/** Owns one activation attempt, its admitted events and its cleanup authority. */
export type GlobalSupervisorActivationOwner = {
  readonly hasActivation: () => boolean;
  readonly microphoneMuted$: ObservablePrimitive<boolean>;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly start: (home: GlobalSupervisorHome) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly toggleMicrophone: () => Promise<void>;
};

const reconnectRecovery = {
  action: "reconnectHome",
  label: "Reconnect home server",
} as const;

async function releaseActivation(attempt: ActivationAttempt): Promise<boolean> {
  const activation = attempt.activation;
  if (activation === null) {
    return true;
  }
  try {
    await activation.stop();
    await attempt.microphoneMutation?.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function settledAttempt(attempt: ActivationAttempt | null): {
  readonly activation: GlobalSupervisorActivation;
  readonly attempt: ActivationAttempt;
} | null {
  if (attempt === null || attempt.activation === null) {
    return null;
  }
  return { activation: attempt.activation, attempt };
}

function publishReplacementHome(
  render: GlobalSupervisorRenderModel,
  requestedHome: GlobalSupervisorHome,
  activatedHome: GlobalSupervisorHome,
): void {
  if (
    activatedHome.connectionId !== requestedHome.connectionId ||
    activatedHome.threadId !== requestedHome.threadId
  ) {
    render.publishStarting(activatedHome);
  }
}

/** Owns activation-generation event admission and retained terminal cleanup authority. */
export function createGlobalSupervisorActivationOwner(
  runtime: GlobalSupervisorRuntime,
  render: GlobalSupervisorRenderModel,
): GlobalSupervisorActivationOwner {
  let currentAttempt: ActivationAttempt | null = null;
  let pausedForAppLock = false;
  const microphoneMuted$ = observablePrimitive(false);

  const beginTerminalCleanup = (
    attempt: ActivationAttempt,
    failure: GlobalSupervisorFailureKind,
    recovery: GlobalSupervisorRecovery,
  ): void => {
    const activation = attempt.activation;
    if (activation === null || attempt.cleanupPromise !== null) {
      return;
    }
    attempt.terminal = true;
    attempt.terminalProjection = { failure, recovery };
    const cleanup = releaseActivation(attempt).then((released) => {
      if (attempt.cleanupPromise === cleanup) {
        attempt.cleanupPromise = null;
      }
      if (currentAttempt !== attempt) {
        return released;
      }
      if (!released) {
        render.fail("cleanupFailed", reconnectRecovery);
        return false;
      }
      currentAttempt = null;
      microphoneMuted$.set(false);
      render.fail(failure, recovery);
      return true;
    });
    attempt.cleanupPromise = cleanup;
  };

  const acceptSettledEvent = (
    attempt: ActivationAttempt,
    event: GlobalSupervisorRuntimeEvent,
  ): void => {
    const activation = attempt.activation;
    if (currentAttempt !== attempt || activation === null || attempt.terminal) {
      return;
    }
    if (event.activationId !== activation.activationId) {
      beginTerminalCleanup(attempt, "sessionAmbiguous", reconnectRecovery);
      return;
    }
    if (event.event === "failed") {
      beginTerminalCleanup(attempt, event.failure, event.recovery);
      return;
    }
    render.publishRuntimeEvent(event);
  };

  const acceptRuntimeEvent = (
    attempt: ActivationAttempt,
    event: GlobalSupervisorRuntimeEvent,
  ): void => {
    if (currentAttempt !== attempt || attempt.terminal) {
      return;
    }
    if (attempt.activation === null) {
      attempt.bufferedEvents.push(event);
      return;
    }
    acceptSettledEvent(attempt, event);
  };

  const attemptIsLive = (attempt: ActivationAttempt): boolean =>
    currentAttempt === attempt && !attempt.terminal;

  const settleStartedActivation = async (
    attempt: ActivationAttempt,
    activation: GlobalSupervisorActivation,
    home: GlobalSupervisorHome,
  ): Promise<void> => {
    if (currentAttempt !== attempt) {
      return;
    }
    attempt.activation = activation;
    if (pausedForAppLock) {
      try {
        await activation.pause();
      } catch {
        beginTerminalCleanup(attempt, "realtimeFailed", reconnectRecovery);
        return;
      }
    }
    if (!attemptIsLive(attempt)) {
      return;
    }
    publishReplacementHome(render, home, activation.home);
    if (!pausedForAppLock) {
      render.publishRuntimeEvent({ activationId: activation.activationId, event: "listening" });
    }
    for (const event of attempt.bufferedEvents) {
      acceptSettledEvent(attempt, event);
    }
    attempt.bufferedEvents.length = 0;
  };

  const publishStartFailure = (attempt: ActivationAttempt, error: unknown): void => {
    if (currentAttempt !== attempt) {
      return;
    }
    currentAttempt = null;
    if (error instanceof GlobalSupervisorStartError) {
      render.fail(error.failure, error.recovery);
      return;
    }
    render.fail("startFailed", {
      action: "retryCapabilityProbe",
      label: "Retry voice check",
    });
  };

  return {
    hasActivation: () => currentAttempt !== null,
    microphoneMuted$,
    async pause() {
      pausedForAppLock = true;
      const settled = settledAttempt(currentAttempt);
      if (settled === null || settled.attempt.terminal) {
        return;
      }
      try {
        await settled.activation.pause();
      } catch {
        beginTerminalCleanup(settled.attempt, "realtimeFailed", reconnectRecovery);
      }
    },
    async resume() {
      pausedForAppLock = false;
      const settled = settledAttempt(currentAttempt);
      if (settled === null || settled.attempt.terminal) {
        return;
      }
      render.publishRuntimeEvent({
        activationId: settled.activation.activationId,
        event: "reconnecting",
      });
      try {
        await settled.activation.resume();
      } catch {
        beginTerminalCleanup(settled.attempt, "realtimeFailed", reconnectRecovery);
        return;
      }
      if (attemptIsLive(settled.attempt) && render.render$.peek().phase === "reconnecting") {
        render.publishRuntimeEvent({
          activationId: settled.activation.activationId,
          event: "listening",
        });
      }
    },
    async start(home) {
      if (currentAttempt !== null) {
        return;
      }
      const attempt: ActivationAttempt = {
        activation: null,
        bufferedEvents: [],
        cleanupPromise: null,
        microphoneMutation: null,
        requestedMicrophoneMuted: false,
        terminal: false,
        terminalProjection: null,
      };
      currentAttempt = attempt;
      microphoneMuted$.set(false);
      render.publishStarting(home);
      try {
        const activation = await runtime.start(home, (event) => {
          acceptRuntimeEvent(attempt, event);
        });
        await settleStartedActivation(attempt, activation, home);
      } catch (error) {
        publishStartFailure(attempt, error);
      }
    },
    async stop() {
      const settled = settledAttempt(currentAttempt);
      if (settled === null) {
        return;
      }
      const { activation, attempt } = settled;
      if (attempt.cleanupPromise !== null) {
        const released = await attempt.cleanupPromise;
        if (released) {
          return;
        }
      }
      if (!attempt.terminal) {
        render.publishStopping(activation.home);
        attempt.terminal = true;
      }
      if (!(await releaseActivation(attempt))) {
        attempt.terminal = true;
        render.fail("cleanupFailed", reconnectRecovery);
        throw new Error("Global Voice Mode cleanup failed");
      }
      if (currentAttempt !== attempt) {
        return;
      }
      currentAttempt = null;
      microphoneMuted$.set(false);
      if (attempt.terminalProjection !== null) {
        render.fail(attempt.terminalProjection.failure, attempt.terminalProjection.recovery);
      } else {
        render.publishReady(activation.home);
      }
    },
    async toggleMicrophone() {
      const settled = settledAttempt(currentAttempt);
      if (settled === null || settled.attempt.terminal) {
        return;
      }
      const { activation, attempt } = settled;
      const muted = !attempt.requestedMicrophoneMuted;
      attempt.requestedMicrophoneMuted = muted;
      // The media owner serializes mutations. Deliver mute immediately so it can fence
      // an in-flight capture acquisition; a feature queue would delay that safety gate.
      const mutation = activation.setMicrophoneMuted(muted).then(() => {
        if (attemptIsLive(attempt) && attempt.microphoneMutation === mutation) {
          microphoneMuted$.set(muted);
        }
      });
      attempt.microphoneMutation = mutation;
      try {
        await mutation;
      } catch (error) {
        if (attemptIsLive(attempt) && attempt.microphoneMutation === mutation) {
          beginTerminalCleanup(attempt, "realtimeFailed", reconnectRecovery);
        }
        throw error;
      } finally {
        if (attempt.microphoneMutation === mutation) {
          attempt.microphoneMutation = null;
        }
      }
    },
  };
}
