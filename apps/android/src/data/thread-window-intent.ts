export type ThreadWindowIntentLease = {
  token: number;
  scope: string;
  identity: string;
};

type ActiveIntent = ThreadWindowIntentLease & {
  release(): void;
};

/**
 * Owns at most one transient navigation window. The mounted conversation
 * acquires its own lease before the transient lease is released, so adopting
 * a preload can never evict the already-loaded destination between render and
 * the passive retention effect.
 */
export class ThreadWindowIntentController {
  #nextToken = 0;
  #currentToken = 0;
  #intent: ActiveIntent | null = null;

  begin(scope: string, identity: string, retain: () => () => void): ThreadWindowIntentLease {
    if (this.#intent?.identity === identity) return this.#intent;
    const release = retain();
    const previous = this.#intent;
    const lease = { token: ++this.#nextToken, scope, identity, release };
    this.#currentToken = lease.token;
    this.#intent = lease;
    previous?.release();
    return lease;
  }

  /** The token remains current after adoption while its SQLite read settles. */
  adopt(scope: string): void {
    if (this.#intent?.scope !== scope) return;
    const adopted = this.#intent;
    this.#intent = null;
    adopted.release();
  }

  cancel(lease: ThreadWindowIntentLease): void {
    if (this.#intent?.token !== lease.token) return;
    const cancelled = this.#intent;
    this.#intent = null;
    this.#currentToken = ++this.#nextToken;
    cancelled.release();
  }

  isCurrent(token: number): boolean {
    return token === this.#currentToken;
  }

  close(): void {
    const current = this.#intent;
    this.#intent = null;
    this.#currentToken = ++this.#nextToken;
    current?.release();
  }
}
