export type ProjectionAcknowledgement = {
  recovery: boolean;
  checkpoint: Promise<void>;
  acknowledge(): void;
};

/**
 * Keeps durable cursor acknowledgement ordered without holding up live UI
 * projection. A failed checkpoint blocks later cursors until a recovery batch
 * has itself reached SQLite.
 */
export class OrderedProjectionAcknowledger {
  readonly #onFailure: (cause: unknown) => void;
  #tail: Promise<void> = Promise.resolve();
  #blocked = false;

  constructor(onFailure: (cause: unknown) => void) {
    this.#onFailure = onFailure;
  }

  enqueue(work: ProjectionAcknowledgement): void {
    this.#tail = this.#tail.then(async () => {
      if (this.#blocked && !work.recovery) return;
      try {
        await work.checkpoint;
        work.acknowledge();
        if (work.recovery) this.#blocked = false;
      } catch (cause) {
        this.#blocked = true;
        this.#onFailure(cause);
      }
    });
  }

  async settled(): Promise<void> {
    await this.#tail;
  }

  get blocked(): boolean {
    return this.#blocked;
  }
}
