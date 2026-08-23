/** Serializes async work while allowing the queue to continue after a failure. */
export class SerialTaskQueue {
  #tail: Promise<void> = Promise.resolve();
  #closed = false;

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Serial task queue is closed"));
    const result = this.#tail.then(task);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Rejects future work and resolves after every task already accepted. */
  close(): Promise<void> {
    this.#closed = true;
    return this.#tail;
  }
}
