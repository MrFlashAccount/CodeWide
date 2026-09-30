type GlobalSupervisorUnsolicitedAdmissionOutcome =
  | "active"
  | "cancelled"
  | "completed"
  | "interrupted";

/** Identity and eventual lifecycle result for one atomic admission. */
export type GlobalSupervisorUnsolicitedAdmissionClaim = {
  readonly outcome: () => GlobalSupervisorUnsolicitedAdmissionOutcome;
};

/** Event-driven gate shared by every Global Supervisor-owned unsolicited injection path. */
export type GlobalSupervisorUnsolicitedAdmission = {
  readonly begin: () => GlobalSupervisorUnsolicitedAdmissionClaim | null;
  readonly cancel: (claim: GlobalSupervisorUnsolicitedAdmissionClaim) => void;
  readonly claimWhenOpen: (
    signal?: AbortSignal,
  ) => Promise<GlobalSupervisorUnsolicitedAdmissionClaim>;
  readonly completeExchange: () => void;
  readonly isOpen: () => boolean;
  readonly setLifecycleIdle: (idle: boolean) => void;
  readonly setUserSpeaking: (speaking: boolean) => void;
  readonly stop: () => void;
  readonly subscribe: (listener: () => void) => { readonly unsubscribe: () => void };
};

/** Waits for admission and starts one unsolicited append without a polling loop. */
export async function appendGlobalSupervisorUnsolicited(options: {
  readonly admission: GlobalSupervisorUnsolicitedAdmission;
  readonly appendText: () => Promise<void>;
  readonly signal: AbortSignal | undefined;
}): Promise<void> {
  const claim = await options.admission.claimWhenOpen(options.signal);
  try {
    await options.appendText();
  } catch (error) {
    options.admission.cancel(claim);
    throw error;
  }
}

type ActiveClaim = {
  readonly claim: GlobalSupervisorUnsolicitedAdmissionClaim;
  exchangeCompleted: boolean;
  setOutcome: (outcome: Exclude<GlobalSupervisorUnsolicitedAdmissionOutcome, "active">) => void;
};

function createClaim(): ActiveClaim {
  let outcome: GlobalSupervisorUnsolicitedAdmissionOutcome = "active";
  return {
    claim: { outcome: () => outcome },
    exchangeCompleted: false,
    setOutcome(next) {
      outcome = next;
    },
  };
}

/** Owns admission of model-directed speech that was not initiated by the current user turn. */
export function createGlobalSupervisorUnsolicitedAdmission(): GlobalSupervisorUnsolicitedAdmission {
  const listeners = new Set<() => void>();
  let accepting = true;
  let lifecycleIdle = false;
  let userExchangeCompleted = false;
  let userExchangePending = false;
  let activeClaim: ActiveClaim | null = null;

  const isOpen = (): boolean =>
    accepting && lifecycleIdle && !userExchangePending && activeClaim === null;

  const publishIfChanged = (wasOpen: boolean): void => {
    if (wasOpen === isOpen()) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  };

  const admission: GlobalSupervisorUnsolicitedAdmission = {
    begin() {
      if (!isOpen()) {
        return null;
      }
      const wasOpen = true;
      activeClaim = createClaim();
      publishIfChanged(wasOpen);
      return activeClaim.claim;
    },
    cancel(claim) {
      if (activeClaim?.claim !== claim) {
        return;
      }
      const wasOpen = isOpen();
      activeClaim.setOutcome("cancelled");
      activeClaim = null;
      publishIfChanged(wasOpen);
    },
    async claimWhenOpen(signal) {
      return new Promise((resolve, reject) => {
        let subscription: { readonly unsubscribe: () => void } | null = null;
        const cleanup = (): void => {
          subscription?.unsubscribe();
          signal?.removeEventListener("abort", attempt);
        };
        const attempt = (): void => {
          if (signal?.aborted === true) {
            cleanup();
            reject(new Error("Global Voice replacement cancelled"));
            return;
          }
          if (!accepting) {
            cleanup();
            reject(new Error("Global Voice unsolicited admission stopped"));
            return;
          }
          const claim = admission.begin();
          if (claim !== null) {
            cleanup();
            resolve(claim);
          }
        };
        subscription = admission.subscribe(attempt);
        signal?.addEventListener("abort", attempt, { once: true });
        attempt();
      });
    },
    completeExchange() {
      if (!accepting) {
        return;
      }
      const wasOpen = isOpen();
      if (activeClaim !== null) {
        activeClaim.exchangeCompleted = true;
      }
      if (userExchangePending) {
        userExchangeCompleted = true;
      }
      if (lifecycleIdle) {
        if (userExchangeCompleted) {
          userExchangeCompleted = false;
          userExchangePending = false;
        }
        if (activeClaim?.exchangeCompleted === true) {
          activeClaim.setOutcome("completed");
          activeClaim = null;
        }
      }
      publishIfChanged(wasOpen);
    },
    isOpen,
    setLifecycleIdle(idle) {
      if (!accepting) {
        return;
      }
      const wasOpen = isOpen();
      lifecycleIdle = idle;
      if (idle && userExchangePending && userExchangeCompleted) {
        userExchangeCompleted = false;
        userExchangePending = false;
      }
      if (idle && activeClaim?.exchangeCompleted === true) {
        activeClaim.setOutcome("completed");
        activeClaim = null;
      }
      publishIfChanged(wasOpen);
    },
    setUserSpeaking(speaking) {
      if (!accepting || !speaking) {
        return;
      }
      const wasOpen = isOpen();
      userExchangeCompleted = false;
      userExchangePending = true;
      if (activeClaim !== null) {
        activeClaim.setOutcome("interrupted");
        activeClaim = null;
      }
      publishIfChanged(wasOpen);
    },
    stop() {
      if (!accepting) {
        return;
      }
      const wasOpen = isOpen();
      accepting = false;
      if (activeClaim !== null) {
        activeClaim.setOutcome("cancelled");
        activeClaim = null;
      }
      publishIfChanged(wasOpen);
      listeners.clear();
    },
    subscribe(listener) {
      listeners.add(listener);
      return {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      };
    },
  };
  return admission;
}
