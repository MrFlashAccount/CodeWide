type CommitWaiter = {
  resolve(): void;
  reject(cause: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
};

/**
 * Bridges TanStack's synchronous external-sync commit Interface to the actual
 * asynchronous persistence Adapter. A native projection cursor must not be
 * acknowledged until the matching SQLite transaction finishes.
 */
export class DurableCommitTracker {
  readonly #timeoutMs: number;
  readonly #waiters = new Map<string, CommitWaiter[]>();

  constructor(timeoutMs = 15_000) {
    this.#timeoutMs = timeoutMs;
  }

  track(collectionId: string, commit: () => void): Promise<void> {
    let resolvePersisted!: () => void;
    let rejectPersisted!: (cause: unknown) => void;
    const persisted = new Promise<void>((resolve, reject) => {
      resolvePersisted = resolve;
      rejectPersisted = reject;
    });
    const waiter: CommitWaiter = {
      resolve: resolvePersisted,
      reject: rejectPersisted,
      timeout: setTimeout(() => {
        if (!this.#remove(collectionId, waiter)) return;
        rejectPersisted(new Error(`SQLite persistence did not commit ${collectionId} within ${this.#timeoutMs} ms`));
      }, this.#timeoutMs),
    };
    const queue = this.#waiters.get(collectionId) ?? [];
    queue.push(waiter);
    this.#waiters.set(collectionId, queue);

    try {
      commit();
    } catch (cause) {
      if (this.#remove(collectionId, waiter)) {
        clearTimeout(waiter.timeout);
        waiter.reject(cause);
      }
    }
    return persisted;
  }

  async observe(collectionId: string, persist: () => Promise<void>): Promise<void> {
    const waiter = this.#shift(collectionId);
    if (waiter !== null) clearTimeout(waiter.timeout);
    try {
      await persist();
      if (waiter !== null) {
        waiter.resolve();
      }
    } catch (cause) {
      if (waiter !== null) {
        waiter.reject(cause);
      }
      throw cause;
    }
  }

  #shift(collectionId: string): CommitWaiter | null {
    const queue = this.#waiters.get(collectionId);
    const waiter = queue?.shift() ?? null;
    if (queue?.length === 0) this.#waiters.delete(collectionId);
    return waiter;
  }

  #remove(collectionId: string, waiter: CommitWaiter): boolean {
    const queue = this.#waiters.get(collectionId);
    if (queue === undefined) return false;
    const index = queue.indexOf(waiter);
    if (index < 0) return false;
    queue.splice(index, 1);
    if (queue.length === 0) this.#waiters.delete(collectionId);
    return true;
  }
}

export async function persistDurablyWithRetry(
  persist: () => Promise<void>,
  options: {
    wait?: (delayMs: number) => Promise<void>;
    onRetry?: (cause: unknown, attempt: number, delayMs: number) => void;
  } = {},
): Promise<void> {
  const wait = options.wait ?? (async (delayMs: number) => {
    await new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
  });
  let attempt = 0;
  for (;;) {
    try {
      await persist();
      return;
    } catch (cause) {
      attempt += 1;
      const delayMs = Math.min(2_000, 50 * 2 ** Math.min(attempt, 5));
      options.onRetry?.(cause, attempt, delayMs);
      await wait(delayMs);
    }
  }
}
