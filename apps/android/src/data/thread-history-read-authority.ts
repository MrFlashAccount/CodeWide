/** Invalidates pending history reads when connection or snapshot authority changes. */
export class ThreadHistoryReadAuthority {
  readonly #leases = new Map<string, object>();

  capture(connectionId: string): () => boolean {
    let lease = this.#leases.get(connectionId);
    if (lease === undefined) {
      lease = {};
      this.#leases.set(connectionId, lease);
    }
    return () => this.#leases.get(connectionId) === lease;
  }

  invalidate(connectionId: string): void {
    this.#leases.delete(connectionId);
  }
}
