export type ResourceSnapshot<T> =
  | { status: "loading"; value: T }
  | { status: "ready"; value: T }
  | { message: string; status: "error"; value: T };

export class ObservableResource<T> {
  #snapshot: ResourceSnapshot<T>;
  readonly #listeners = new Set<() => void>();

  constructor(initialValue: T) {
    this.#snapshot = { status: "loading", value: initialValue };
  }

  snapshot = (): ResourceSnapshot<T> => this.#snapshot;
  protected addListener(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  subscribe = (listener: () => void): (() => void) => this.addListener(listener);
  publish(snapshot: ResourceSnapshot<T>): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
