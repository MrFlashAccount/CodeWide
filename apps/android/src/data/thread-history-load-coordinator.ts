export type ThreadHistoryLoadDirection = "older" | "newer" | "latest";

export type ThreadHistoryLoadSettlement =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "failed"; cause: unknown };

type ThreadHistoryLoadFailure = { status: "none" } | { status: "failed"; cause: unknown };

/** Owns one visible loading state across independently coalesced directions. */
export class ThreadHistoryLoadCoordinator {
  readonly #active = new Set<ThreadHistoryLoadDirection>();
  #failure: ThreadHistoryLoadFailure = { status: "none" };

  begin(direction: ThreadHistoryLoadDirection): boolean {
    if (this.#active.has(direction)) throw new Error(`History load ${direction} is already active`);
    const wasIdle = this.#active.size === 0;
    if (wasIdle) this.#failure = { status: "none" };
    this.#active.add(direction);
    return wasIdle;
  }

  succeed(direction: ThreadHistoryLoadDirection): ThreadHistoryLoadSettlement {
    return this.#settle(direction);
  }

  fail(direction: ThreadHistoryLoadDirection, cause: unknown): ThreadHistoryLoadSettlement {
    if (this.#failure.status === "none") this.#failure = { status: "failed", cause };
    return this.#settle(direction);
  }

  #settle(direction: ThreadHistoryLoadDirection): ThreadHistoryLoadSettlement {
    if (!this.#active.delete(direction)) throw new Error(`History load ${direction} is not active`);
    if (this.#active.size > 0) return { status: "pending" };
    const failure = this.#failure;
    this.#failure = { status: "none" };
    return failure.status === "failed" ? failure : { status: "ready" };
  }
}
