type AppLockVoiceOwner = {
  readonly pauseForAppLock: () => Promise<void>;
  readonly resumeAfterAppUnlock: () => Promise<void>;
};

type AppLockVoiceState = "paused" | "resumed";
type AppliedAppLockVoiceState = AppLockVoiceState | "unknown";

/** Process voice transitions controlled by the biometric app-lock boundary. */
export type AppLockVoiceLifecycle = {
  readonly bind: (owner: AppLockVoiceOwner) => void;
  readonly pauseForAppLock: () => Promise<void>;
  readonly resumeAfterAppUnlock: () => Promise<void>;
};

/** Serializes biometric-lock voice transitions so a late completion cannot reopen capture. */
export function createAppLockVoiceLifecycle(): AppLockVoiceLifecycle {
  let owner: AppLockVoiceOwner | null = null;
  let desiredState: AppLockVoiceState = "resumed";
  let appliedState: AppliedAppLockVoiceState = "resumed";
  let transition: Promise<void> = Promise.resolve();

  const request = async (state: AppLockVoiceState): Promise<void> => {
    desiredState = state;
    const requestedOwner = owner;
    const next = transition
      .catch(() => undefined)
      .then(async () => {
        if (requestedOwner === null || requestedOwner !== owner || appliedState === state) {
          return;
        }
        try {
          if (state === "paused") {
            await requestedOwner.pauseForAppLock();
          } else {
            await requestedOwner.resumeAfterAppUnlock();
          }
          if (requestedOwner === owner) {
            appliedState = state;
          }
        } catch (error) {
          if (requestedOwner === owner) {
            appliedState = "unknown";
          }
          throw error;
        }
      });
    transition = next;
    await next;
  };

  return {
    bind(nextOwner: AppLockVoiceOwner): void {
      owner = nextOwner;
      appliedState = "resumed";
      if (desiredState === "paused") {
        void request("paused").catch(() => undefined);
      }
    },
    async pauseForAppLock(): Promise<void> {
      await request("paused");
    },
    async resumeAfterAppUnlock(): Promise<void> {
      await request("resumed");
    },
  };
}

/** Process-lifetime biometric-lock voice boundary shared by the root gate and V1 owners. */
export const appLockVoiceLifecycle = createAppLockVoiceLifecycle();
