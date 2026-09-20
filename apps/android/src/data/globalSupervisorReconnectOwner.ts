export type GlobalSupervisorReconnectPolicy = {
  readonly retryDelaysMs: readonly number[];
};

const ROUTE_CHANGE_GRACE_DELAY_MS = 1200;
const FIRST_RETRY_DELAY_MS = 700;
const SECOND_RETRY_DELAY_MS = 1500;
const FINAL_RETRY_DELAY_MS = 3000;

export const GLOBAL_SUPERVISOR_RECONNECT_POLICY: GlobalSupervisorReconnectPolicy = {
  retryDelaysMs: [
    ROUTE_CHANGE_GRACE_DELAY_MS,
    FIRST_RETRY_DELAY_MS,
    SECOND_RETRY_DELAY_MS,
    FINAL_RETRY_DELAY_MS,
  ],
};

export type GlobalSupervisorTransport = {
  readonly stop: () => Promise<void>;
};

type CancelableWait = {
  readonly cancel: () => void;
  readonly promise: Promise<boolean>;
};

type GlobalSupervisorReconnectOwnerOptions<Transport extends GlobalSupervisorTransport> = {
  readonly createWait?: (delayMs: number) => CancelableWait;
  readonly onExhausted: () => void;
  readonly onReconnecting: () => void;
  readonly policy?: GlobalSupervisorReconnectPolicy;
  readonly startTransport: (onTerminal: () => void) => Promise<Transport>;
};

type Attempt<Transport extends GlobalSupervisorTransport> = {
  terminal: boolean;
  transport: Transport | null;
};

type OwnerMode = "new" | "paused" | "running" | "stopped";

export type GlobalSupervisorReconnectController = {
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

function createTimerWait(delayMs: number): CancelableWait {
  let settled = false;
  let resolveWait: ((completed: boolean) => void) | null = null;
  const promise = new Promise<boolean>((resolve) => {
    resolveWait = resolve;
  });
  const timer = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    resolveWait?.(true);
  }, delayMs);
  return {
    cancel(): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveWait?.(false);
    },
    promise,
  };
}

async function stopAttempt<Transport extends GlobalSupervisorTransport>(
  attempt: Attempt<Transport>,
): Promise<void> {
  const transport = attempt.transport;
  attempt.transport = null;
  if (transport !== null) {
    await transport.stop();
  }
}

/** Owns one logical Voice Assistant activation across transport replacement and mic handoff. */
export function createGlobalSupervisorReconnectOwner<Transport extends GlobalSupervisorTransport>(
  options: GlobalSupervisorReconnectOwnerOptions<Transport>,
): GlobalSupervisorReconnectController {
  const policy = options.policy ?? GLOBAL_SUPERVISOR_RECONNECT_POLICY;
  const createWait = options.createWait ?? createTimerWait;
  let current: Attempt<Transport> | null = null;
  let generation = 0;
  let mode: OwnerMode = "new";
  let retriesUsed = 0;
  let wait: CancelableWait | null = null;
  let workPromise: Promise<void> | null = null;
  const readMode = (): OwnerMode => mode;

  const beginAttempt = async (): Promise<Attempt<Transport>> => {
    const attempt: Attempt<Transport> = { terminal: false, transport: null };
    const transport = await options.startTransport(() => {
      attempt.terminal = true;
      if (current === attempt) {
        scheduleReconnect();
      }
    });
    attempt.transport = transport;
    return attempt;
  };

  const canRun = (expectedGeneration: number): boolean =>
    mode === "running" && generation === expectedGeneration;

  const installAttempt = async (
    attempt: Attempt<Transport>,
    expectedGeneration: number,
  ): Promise<boolean> => {
    if (!canRun(expectedGeneration) || attempt.terminal) {
      await stopAttempt(attempt).catch(() => undefined);
      return false;
    }
    current = attempt;
    return true;
  };

  const waitBeforeRetry = async (expectedGeneration: number): Promise<boolean> => {
    const delayMs = policy.retryDelaysMs[retriesUsed];
    if (delayMs === undefined) {
      return false;
    }
    retriesUsed += 1;
    wait = createWait(delayMs);
    const elapsed = await wait.promise;
    wait = null;
    return elapsed && canRun(expectedGeneration);
  };

  const attemptReplacement = async (expectedGeneration: number): Promise<boolean> => {
    try {
      const candidate = await beginAttempt();
      return await installAttempt(candidate, expectedGeneration);
    } catch {
      // The bounded policy owns subsequent attempts and final recovery UI.
      return false;
    }
  };

  const retry = async (expectedGeneration: number): Promise<void> => {
    options.onReconnecting();
    const previous = current;
    current = null;
    if (previous !== null) {
      await stopAttempt(previous).catch(() => undefined);
    }
    while (canRun(expectedGeneration) && retriesUsed < policy.retryDelaysMs.length) {
      if (!(await waitBeforeRetry(expectedGeneration))) {
        return;
      }
      if (await attemptReplacement(expectedGeneration)) {
        return;
      }
    }
    if (canRun(expectedGeneration)) {
      options.onExhausted();
    }
  };

  const trackWork = (work: Promise<void>): void => {
    const settled = work.finally(() => {
      if (workPromise === settled) {
        workPromise = null;
      }
      if (mode === "running" && current?.terminal === true) {
        scheduleReconnect();
      }
    });
    workPromise = settled;
  };

  function scheduleReconnect(): void {
    if (mode !== "running" || workPromise !== null) {
      return;
    }
    const expectedGeneration = generation;
    trackWork(retry(expectedGeneration));
  }

  const runResume = async (expectedGeneration: number): Promise<void> => {
    if (await attemptReplacement(expectedGeneration)) {
      return;
    }
    if (canRun(expectedGeneration)) {
      await retry(expectedGeneration);
    }
  };

  return {
    async pause(): Promise<void> {
      if (mode === "stopped" || mode === "paused") {
        await workPromise;
        return;
      }
      mode = "paused";
      generation += 1;
      wait?.cancel();
      wait = null;
      const active = current;
      current = null;
      if (active !== null) {
        await stopAttempt(active);
      }
      await workPromise;
    },
    async resume(): Promise<void> {
      if (mode === "stopped" || mode === "running") {
        await workPromise;
        return;
      }
      mode = "running";
      generation += 1;
      const expectedGeneration = generation;
      trackWork(runResume(expectedGeneration));
      await workPromise;
    },
    async start(): Promise<void> {
      if (mode === "stopped" || mode === "paused" || mode === "running") {
        return;
      }
      mode = "running";
      generation += 1;
      const expectedGeneration = generation;
      const initial = await beginAttempt();
      if (!(await installAttempt(initial, expectedGeneration))) {
        if (readMode() === "running") {
          throw new Error("Global Voice transport terminated during startup");
        }
      }
    },
    async stop(): Promise<void> {
      if (mode === "stopped") {
        await workPromise;
        return;
      }
      mode = "stopped";
      generation += 1;
      wait?.cancel();
      wait = null;
      const active = current;
      current = null;
      const failures: unknown[] = [];
      if (active !== null) {
        await stopAttempt(active).catch((error: unknown) => failures.push(error));
      }
      await workPromise?.catch((error: unknown) => failures.push(error));
      if (failures.length > 0) {
        throw new Error("Global Voice transport cleanup failed");
      }
    },
  };
}
