export type ProjectionAcknowledgement = {
  acknowledge: () => void;
  checkpoint: Promise<void>;
  recovery: boolean;
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
      if (this.#blocked && !work.recovery) {
        return;
      }
      try {
        await work.checkpoint;
        work.acknowledge();
        if (work.recovery) {
          this.#blocked = false;
        }
      } catch (error) {
        this.#blocked = true;
        this.#onFailure(error);
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
