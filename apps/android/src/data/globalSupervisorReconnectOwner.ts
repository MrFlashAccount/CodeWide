import {
  createGlobalSupervisorRecoveryEpisode,
  createReconnectWait,
  GLOBAL_SUPERVISOR_RECONNECT_POLICY,
  type GlobalSupervisorReadiness,
  type GlobalSupervisorReconnectPolicy,
} from "./globalSupervisorRecoveryPolicy";

export type GlobalSupervisorTransport = {
  readonly setMicrophoneMuted: (muted: boolean) => Promise<void>;
  readonly stop: () => Promise<void>;
};

/** Callbacks and cancellation belong to this exact replacement, never the next one. */
export type GlobalSupervisorTransportStart = {
  readonly microphoneMuted: boolean;
  readonly onConnected: () => void;
  readonly onSuspended: () => void;
  readonly onTerminal: () => void;
  readonly reason: "activation" | "recovery" | "resume";
  readonly signal: AbortSignal;
};

type ReconnectOptions<Transport extends GlobalSupervisorTransport> = {
  readonly onFatalFailure: (reason: "accessRequired" | "transportFailed") => void;
  readonly onReconnecting: () => void;
  readonly onRecovered: (transport: Transport) => void;
  readonly policy?: GlobalSupervisorReconnectPolicy;
  readonly readiness: GlobalSupervisorReadiness;
  readonly startTransport: (options: GlobalSupervisorTransportStart) => Promise<Transport>;
};

type Attempt<Transport> = {
  readonly abort: AbortController;
  suspended: boolean;
  terminal: boolean;
  transport: Transport | null;
};

class TransportCleanupError extends Error {}

function retryableStartFailure(error: unknown): false {
  if (error instanceof TransportCleanupError) {
    throw error;
  }
  return false;
}

/** One logical activation across serialized replacements, intentional pause and explicit Stop. */
export type GlobalSupervisorReconnectController = {
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly setMicrophoneMuted: (muted: boolean) => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

/** Recovery never probes by opening a peer while the owning RPC connection is unavailable. */
export function createGlobalSupervisorReconnectOwner<Transport extends GlobalSupervisorTransport>(
  options: ReconnectOptions<Transport>,
): GlobalSupervisorReconnectController {
  let current: Attempt<Transport> | null = null;
  let starting: Attempt<Transport> | null = null;
  let mode: "new" | "paused" | "running" | "stopped" = "new";
  let generation = 0;
  let microphoneMuted = false;
  let cancelWait: (() => void) | null = null;
  let work: Promise<void> | null = null;
  let cleanup: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  let readiness = options.readiness.read();
  const episode = createGlobalSupervisorRecoveryEpisode({
    policy: options.policy ?? GLOBAL_SUPERVISOR_RECONNECT_POLICY,
    random: Math.random,
  });
  const canRun = (expected: number): boolean => mode === "running" && generation === expected;
  const canInstall = (attempt: Attempt<Transport>, expected: number): boolean =>
    canRun(expected) &&
    !attempt.terminal &&
    !attempt.abort.signal.aborted &&
    options.readiness.read() === "ready";
  const interrupted = (): void => {
    episode.interrupted();
    options.onReconnecting();
  };

  const beginAttempt = async (
    expected: number,
    reason: GlobalSupervisorTransportStart["reason"],
  ): Promise<boolean> => {
    const attempt: Attempt<Transport> = {
      abort: new AbortController(),
      suspended: false,
      terminal: false,
      transport: null,
    };
    starting = attempt;
    try {
      const initialMuted = microphoneMuted;
      const transport = await options.startTransport({
        microphoneMuted: initialMuted,
        onConnected() {
          const wasSuspended = attempt.suspended;
          attempt.suspended = false;
          if (
            current === attempt &&
            wasSuspended &&
            !attempt.terminal &&
            attempt.transport !== null
          ) {
            episode.connected();
            options.onRecovered(attempt.transport);
          }
        },
        onSuspended() {
          attempt.suspended = true;
          if (current === attempt) {
            interrupted();
          }
        },
        onTerminal() {
          attempt.terminal = true;
          if (current === attempt) {
            scheduleReconnect();
          }
        },
        reason,
        signal: attempt.abort.signal,
      });
      attempt.transport = transport;
      if (!canInstall(attempt, expected)) {
        await disposeAttempt(attempt);
        return false;
      }
      let appliedMuted = initialMuted;
      while (appliedMuted !== microphoneMuted && canInstall(attempt, expected)) {
        appliedMuted = microphoneMuted;
        await transport.setMicrophoneMuted(appliedMuted);
      }
      if (!canInstall(attempt, expected)) {
        await disposeAttempt(attempt);
        return false;
      }
      current = attempt;
      if (attempt.suspended) {
        interrupted();
      } else {
        episode.connected();
      }
      return true;
    } catch (error) {
      await disposeAttempt(attempt);
      throw error;
    } finally {
      starting = null;
    }
  };

  const retry = async (expected: number): Promise<void> => {
    interrupted();
    const previous = current;
    current = null;
    // Unconfirmed remote cleanup must not race a fresh start on the same supervisor thread.
    await disposeAttempt(previous);
    while (canRun(expected)) {
      if (options.readiness.read() === "blocked") {
        fail("accessRequired");
        return;
      }
      if (options.readiness.read() !== "ready") {
        const ready = Promise.withResolvers<undefined>();
        cancelWait = () => {
          ready.resolve(undefined);
        };
        await ready.promise;
        cancelWait = null;
        continue;
      }
      const delay = createReconnectWait(episode.retryDelay());
      cancelWait = () => {
        delay.cancel();
      };
      const elapsed = await delay.promise;
      cancelWait = null;
      if (!elapsed || !canRun(expected) || options.readiness.read() !== "ready") {
        continue;
      }
      if (await beginAttempt(expected, "recovery").catch(retryableStartFailure)) {
        return;
      }
    }
  };
  const track = async (operation: Promise<void>): Promise<void> => {
    const pending = operation.finally(() => {
      if (work === pending) {
        work = null;
      }
      if (current?.terminal === true) {
        scheduleReconnect();
      }
    });
    work = pending;
    return pending;
  };
  function scheduleReconnect(): void {
    if (mode !== "running") {
      return;
    }
    interrupted();
    if (work === null) {
      void track(retry(generation)).catch(() => {
        fail("transportFailed");
      });
    }
  }
  function fail(reason: "accessRequired" | "transportFailed"): void {
    if (mode !== "running") {
      return;
    }
    void stop().catch(() => undefined);
    options.onFatalFailure(reason);
  }
  const cancel = (): void => {
    generation += 1;
    cancelWait?.();
    cancelWait = null;
    starting?.abort.abort();
    episode.close();
  };
  async function stop(): Promise<void> {
    mode = "stopped";
    cancel();
    unsubscribe?.();
    unsubscribe = null;
    const previous = current;
    current = null;
    cleanup ??= Promise.all([disposeAttempt(previous), work?.catch(() => undefined)]).then(
      () => undefined,
    );
    return cleanup;
  }
  const observeReadiness = (): void => {
    const next = options.readiness.read();
    if (readiness === next) {
      return;
    }
    readiness = next;
    if (mode !== "running") {
      return;
    }
    cancelWait?.();
    if (next === "blocked") {
      fail("accessRequired");
      return;
    }
    if (next !== "ready") {
      starting?.abort.abort();
      if (current !== null) {
        current.terminal = true;
      }
      scheduleReconnect();
    }
  };
  return {
    async pause() {
      if (mode === "stopped" || mode === "paused") {
        return;
      }
      mode = "paused";
      cancel();
      const previous = current;
      current = null;
      await Promise.all([disposeAttempt(previous), work]);
    },
    async resume() {
      if (mode !== "paused") {
        return;
      }
      mode = "running";
      const expected = ++generation;
      await track(
        (async () => {
          if (
            options.readiness.read() === "ready" &&
            (await beginAttempt(expected, "resume").catch(retryableStartFailure))
          ) {
            return;
          }
          if (canRun(expected)) {
            await retry(expected);
          }
        })(),
      );
    },
    async setMicrophoneMuted(muted) {
      microphoneMuted = muted;
      await current?.transport?.setMicrophoneMuted(muted);
    },
    async start() {
      if (mode !== "new") {
        return;
      }
      mode = "running";
      const expected = ++generation;
      unsubscribe = options.readiness.subscribe(observeReadiness);
      try {
        await track(
          (async () => {
            if (
              options.readiness.read() !== "ready" ||
              !(await beginAttempt(expected, "activation"))
            ) {
              throw new Error("Global Voice transport unavailable during startup");
            }
          })(),
        );
      } catch (error) {
        // A rejected activation has no caller-owned controller to stop it later.
        await stop().catch(() => undefined);
        throw error;
      }
    },
    stop,
  };
}

async function disposeAttempt<Transport extends GlobalSupervisorTransport>(
  attempt: Attempt<Transport> | null,
): Promise<void> {
  attempt?.abort.abort();
  if (attempt?.transport !== null && attempt?.transport !== undefined) {
    const transport = attempt.transport;
    attempt.transport = null;
    try {
      await transport.stop();
    } catch {
      // Keep a failed teardown distinct from a retryable negotiation failure.
      throw new TransportCleanupError("Global Voice transport cleanup was not confirmed");
    }
  }
}
