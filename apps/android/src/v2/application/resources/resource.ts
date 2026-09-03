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

interface ReloadableResourceInput<T> {
  errorMessage: string;
  initialValue: T;
  load(): Promise<T>;
}

/** A model-owned, deduplicated async resource with an explicit retry boundary. */
export class ReloadableResource<T> extends ObservableResource<T> {
  readonly #errorMessage: string;
  readonly #load: () => Promise<T>;
  #generation = 0;
  #pending: Promise<void> | null = null;
  #started = false;

  constructor(input: ReloadableResourceInput<T>) {
    super(input.initialValue);
    this.#errorMessage = input.errorMessage;
    this.#load = input.load;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.refresh().catch(() => undefined);
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    this.start();
    return unsubscribe;
  };

  refresh(): Promise<void> {
    this.#started = true;
    if (this.#pending !== null) return this.#pending;
    const generation = ++this.#generation;
    this.publish({ status: "loading", value: this.snapshot().value });
    const pending = this.#load().then(
      (value) => {
        if (generation === this.#generation) this.publish({ status: "ready", value });
      },
      () => {
        if (generation === this.#generation) {
          this.publish({
            message: this.#errorMessage,
            status: "error",
            value: this.snapshot().value,
          });
        }
      },
    );
    this.#pending = pending;
    pending
      .then(() => {
        if (this.#pending === pending) this.#pending = null;
      })
      .catch(() => undefined);
    return pending;
  }
}
