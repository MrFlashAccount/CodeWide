/** Bounds retry rate, never the lifetime of an enabled hands-free activation. */
export type GlobalSupervisorReconnectPolicy = {
  readonly maxRetryMs: number;
  readonly retryBaseMs: number;
  readonly stableConnectionMs: number;
};

const STABLE_CONNECTION_MS = 10_000;
const RETRY_BASE_MS = 500;
const MAX_RETRY_MS = 30_000;
const EXPONENTIAL_BASE = 2;
const MAX_RETRY_EXPONENT = 16;

/** An enabled activation waits indefinitely; Stop, not elapsed outage time, revokes it. */
export const GLOBAL_SUPERVISOR_RECONNECT_POLICY: GlobalSupervisorReconnectPolicy = {
  maxRetryMs: MAX_RETRY_MS,
  retryBaseMs: RETRY_BASE_MS,
  stableConnectionMs: STABLE_CONNECTION_MS,
};

/** RPC readiness is owned by the bound connection, not by OS internet validation. */
export type GlobalSupervisorReadiness = {
  readonly read: () => "ready" | "waiting" | "blocked";
  readonly subscribe: (changed: () => void) => () => void;
};

/** Cancelling a wait resolves it; Stop never leaves a parked reconnect Promise. */
export function createReconnectWait(delayMs: number): {
  readonly cancel: () => void;
  readonly promise: Promise<boolean>;
} {
  const result = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => {
    result.resolve(true);
  }, delayMs);
  return {
    cancel(): void {
      clearTimeout(timer);
      result.resolve(false);
    },
    promise: result.promise,
  };
}

/** Owns full-jitter backoff and its stable reset, without an outage deadline. */
export function createGlobalSupervisorRecoveryEpisode(options: {
  readonly policy: GlobalSupervisorReconnectPolicy;
  readonly random: () => number;
}): {
  readonly close: () => void;
  readonly connected: () => void;
  readonly interrupted: () => void;
  readonly retryDelay: () => number;
} {
  let attempts = 0;
  let recovering = false;
  let stable: ReturnType<typeof setTimeout> | null = null;
  const cancelStable = (): void => {
    if (stable !== null) {
      clearTimeout(stable);
    }
    stable = null;
  };
  const close = (): void => {
    cancelStable();
    recovering = false;
    attempts = 0;
  };
  return {
    close,
    connected(): void {
      if (!recovering || stable !== null) {
        return;
      }
      stable = setTimeout(close, options.policy.stableConnectionMs);
    },
    interrupted(): void {
      cancelStable();
      recovering = true;
    },
    retryDelay(): number {
      const ceiling = Math.min(
        options.policy.maxRetryMs,
        options.policy.retryBaseMs * EXPONENTIAL_BASE ** Math.min(attempts, MAX_RETRY_EXPONENT),
      );
      attempts = Math.min(attempts + 1, MAX_RETRY_EXPONENT);
      return Math.floor(options.random() * ceiling);
    },
  };
}
