/** Serializes mounted terminal writes without letting one rejection poison replay. */
export class TerminalWriteQueue {
  #tail: Promise<void> = Promise.resolve();

  run(write: () => Promise<void>): Promise<void> {
    const outcome = this.#tail.catch(() => undefined).then(write);
    this.#tail = outcome;
    return outcome;
  }
}

export async function terminalWriteFailure(message: string): Promise<never> {
  await Promise.resolve();
  throw new Error(message);
}
