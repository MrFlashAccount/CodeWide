/** Protects live row updates while a remote catalog page is in flight. This
 * is an in-process read boundary, not a persisted or wire event cursor. */
export interface ThreadCatalogRead {
  readonly changed: ReadonlySet<string>;
  release: () => void;
}

export class ThreadCatalogReads {
  readonly #reads = new Map<string, Set<Set<string>>>();

  begin(connectionId: string): ThreadCatalogRead {
    const changed = new Set<string>();
    const active = this.#reads.get(connectionId) ?? new Set<Set<string>>();
    this.#reads.set(connectionId, active);
    active.add(changed);
    return {
      changed,
      release: () => {
        active.delete(changed);
        if (active.size === 0 && this.#reads.get(connectionId) === active) {
          this.#reads.delete(connectionId);
        }
      },
    };
  }

  changed(connectionId: string, threadId: string): void {
    for (const read of this.#reads.get(connectionId) ?? []) {
      read.add(threadId);
    }
  }
}
