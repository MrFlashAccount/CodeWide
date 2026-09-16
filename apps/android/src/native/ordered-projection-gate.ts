export type ProjectionWork = {
  acknowledge: () => void;
  apply: () => Promise<void>;
  /** Merge adjacent work that has not started yet. The running projection is
   * never mutated; only its queued successor is coalesced. */
  mergeWith?: (newer: ProjectionWork) => ProjectionWork | null;
  recovery: boolean;
};

/**
 * Serializes projection writes and fails closed.
 *
 * Once a live batch fails, later live batches must not be projected or
 * acknowledged: acknowledging a newer cursor would let the native journal
 * delete the failed batch. A checkpoint is the only operation allowed to
 * reopen the gate because it replays the authoritative snapshot/event tail.
 */
export class OrderedProjectionGate {
  readonly #onFailure: (cause: unknown) => void;
  readonly #queue: ProjectionWork[] = [];
  readonly #idleWaiters = new Set<() => void>();
  #running = false;
  #blocked = false;

  constructor(onFailure: (cause: unknown) => void) {
    this.#onFailure = onFailure;
  }

  enqueue(work: ProjectionWork): void {
    const pending = this.#queue.at(-1);
    const merged = pending?.mergeWith?.(work) ?? null;
    if (merged === null) {
      this.#queue.push(work);
    } else {
      this.#queue[this.#queue.length - 1] = merged;
    }
    if (!this.#running) {
      this.#drain().catch(this.#onFailure);
    }
  }

  async settled(): Promise<void> {
    if (!this.#running && this.#queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.#idleWaiters.add(resolve);
    });
  }

  get blocked(): boolean {
    return this.#blocked;
  }

  async #drain(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      while (this.#queue.length > 0) {
        const work = this.#queue.shift();
        if (work === undefined) {
          continue;
        }
        if (this.#blocked && !work.recovery) {
          continue;
        }
        try {
          await work.apply();
          work.acknowledge();
          if (work.recovery) {
            this.#blocked = false;
          }
        } catch (error: unknown) {
          this.#blocked = true;
          this.#onFailure(error);
        }
      }
    } finally {
      this.#running = false;
      if (this.#queue.length > 0) {
        this.#drain().catch(this.#onFailure);
      } else {
        for (const resolve of this.#idleWaiters) {
          resolve();
        }
        this.#idleWaiters.clear();
      }
    }
  }
}
