/** Retains the last known list offset independently for each navigation scope. */
export class ScrollOffsetMemory {
  #values = new Map<string, number>();

  read(key: string): number {
    return this.#values.get(key) ?? 0;
  }
  write(key: string, value: number): void {
    this.#values.set(key, value);
  }
}
