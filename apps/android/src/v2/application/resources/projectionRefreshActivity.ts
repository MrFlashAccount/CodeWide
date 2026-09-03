/** Real projection reads currently owned by one resource generation. */
export type ProjectionRefreshState =
  | { status: "idle" }
  | { inFlight: number; status: "refreshing" };

const IDLE: ProjectionRefreshState = { status: "idle" };

/** Publishes exact overlapping refresh activity without changing projection data. */
export class ProjectionRefreshActivity {
  readonly #active = new Set<number>();
  readonly #listeners = new Set<() => void>();
  #nextToken = 0;
  #snapshot: ProjectionRefreshState = IDLE;

  snapshot = (): ProjectionRefreshState => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  begin(): () => void {
    const token = ++this.#nextToken;
    this.#active.add(token);
    this.#publish();
    return () => {
      if (this.#active.delete(token)) this.#publish();
    };
  }

  reset(): void {
    if (this.#active.size === 0) return;
    this.#active.clear();
    this.#publish();
  }

  #publish(): void {
    this.#snapshot =
      this.#active.size === 0 ? IDLE : { inFlight: this.#active.size, status: "refreshing" };
    for (const listener of this.#listeners) listener();
  }
}
