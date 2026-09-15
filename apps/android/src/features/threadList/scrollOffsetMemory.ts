export class ScrollOffsetMemory {
  #values = new Map<string, number>();

  read(key: string): number {
    return this.#values.get(key) ?? 0;
  }
  write(key: string, value: number): void {
    this.#values.set(key, value);
  }
}
