import type {
  GlobalSupervisorWebRtcSession,
  GlobalSupervisorWebRtcSessionFactory,
} from "../native/globalSupervisorWebRtcSessionContract";

type GlobalSupervisorMediaOwner = {
  readonly close: () => Promise<void>;
  readonly start: GlobalSupervisorWebRtcSessionFactory;
};

/** Prevents a logical activation from releasing its lease while local media can still start. */
export function createGlobalSupervisorMediaOwner(
  startWebRtc: GlobalSupervisorWebRtcSessionFactory,
): GlobalSupervisorMediaOwner {
  const active = new Set<GlobalSupervisorWebRtcSession>();
  const idleWaiters = new Set<() => void>();
  let closed = false;
  let pendingStarts = 0;
  const isClosed = (): boolean => closed;

  const settleIdleWaiters = (): void => {
    if (pendingStarts !== 0 || active.size !== 0) {
      return;
    }
    for (const resolve of idleWaiters) {
      resolve();
    }
    idleWaiters.clear();
  };

  const track = (session: GlobalSupervisorWebRtcSession): GlobalSupervisorWebRtcSession => {
    let stopPromise: Promise<void> | null = null;
    const tracked: GlobalSupervisorWebRtcSession = {
      async acceptAnswer(sdp): Promise<void> {
        await session.acceptAnswer(sdp);
      },
      offerSdp: session.offerSdp,
      async setMicrophoneMuted(muted): Promise<void> {
        await session.setMicrophoneMuted(muted);
      },
      async stop(): Promise<void> {
        stopPromise ??= (async () => {
          try {
            await session.stop();
          } finally {
            active.delete(tracked);
            settleIdleWaiters();
          }
        })();
        await stopPromise;
      },
    };
    active.add(tracked);
    return tracked;
  };

  return {
    async close(): Promise<void> {
      closed = true;
      if (pendingStarts === 0 && active.size === 0) {
        return;
      }
      await new Promise<void>((resolve) => {
        idleWaiters.add(resolve);
      });
    },
    async start(options): Promise<GlobalSupervisorWebRtcSession> {
      if (isClosed()) {
        throw new Error("Global Voice media owner is closed");
      }
      pendingStarts += 1;
      try {
        const session = track(await startWebRtc(options));
        if (isClosed()) {
          await session.stop();
          throw new Error("Global Voice media owner closed during startup");
        }
        return session;
      } finally {
        pendingStarts -= 1;
        settleIdleWaiters();
      }
    },
  };
}
