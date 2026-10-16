export type ExternalThreadRefreshScheduler = {
  forgetConnection: (connectionId: string) => void;
  schedule: (connectionId: string, threadId: string) => void;
};

function threadRefreshKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

/** Coalesces rollout progress into bounded authoritative reads for one selected external thread. */
export function createExternalThreadRefreshScheduler({
  delayMs,
  isDesired,
  isExternal,
  onError,
  refresh,
}: {
  delayMs: number;
  isDesired: (connectionId: string, threadId: string) => boolean;
  isExternal: (connectionId: string, threadId: string) => boolean;
  onError: (connectionId: string, threadId: string, error: unknown) => void;
  refresh: (connectionId: string, threadId: string) => Promise<void>;
}): ExternalThreadRefreshScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (connectionId: string, threadId: string): void => {
    const key = threadRefreshKey(connectionId, threadId);
    if (
      !isExternal(connectionId, threadId) ||
      !isDesired(connectionId, threadId) ||
      timers.has(key)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(key);
      if (!isExternal(connectionId, threadId) || !isDesired(connectionId, threadId)) {
        return;
      }
      void refresh(connectionId, threadId).catch((error: unknown) => {
        onError(connectionId, threadId, error);
      });
    }, delayMs);
    timers.set(key, timer);
  };
  const forgetConnection = (connectionId: string): void => {
    const prefix = `${connectionId}\u0000`;
    for (const [key, timer] of timers) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        timers.delete(key);
      }
    }
  };
  return { forgetConnection, schedule };
}
