import { batch, beginBatch, endBatch, observable, type Observable } from "@legendapp/state";

import { threadSummaryKey } from "./thread-summary-projection";
import type { StoredThreadSummary } from "./thread-summary-types";

type SummaryChange =
  | { type: "insert" | "update"; value: StoredThreadSummary }
  | { key: string; type: "delete" };

/** A project belongs to a server and an exact directory, never just a display name. */
export function projectScopeKey(connectionId: string, cwd: string): string {
  return `${connectionId}\u0000${cwd}`;
}

/** Catalog-wide unread root chats, keyed by `threadSummaryKey`. */
export type UnreadThreadIndex = {
  readonly threads$: Observable<Readonly<Record<string, true>>>;
};

/** Whether one chat is unread; one connection's id space. */
export type ThreadUnreadReader = (threadId: string) => boolean;

/**
 * Binds the unread index to one connection. The reader reads Legend state, so
 * call it inside a selector; without an index every chat reads as read.
 */
export function threadUnreadReader(
  index: UnreadThreadIndex | null,
  connectionId: string,
): ThreadUnreadReader {
  return (threadId) =>
    index !== null && index.threads$[threadSummaryKey(connectionId, threadId)]?.get() === true;
}

/** Root chats count toward unread membership; archived, child and deleting rows do not. */
function isUnreadRootChat(row: StoredThreadSummary): boolean {
  return (
    row.unread > 0 && !row.archived && row.parentThreadId === null && row.deleteCommandId === null
  );
}

/** Device-owned unread state spans the persisted catalog, not a visible page. */
export class ProjectUnreadModel implements UnreadThreadIndex {
  readonly projects$ = observable<readonly string[]>([]);
  /** The same unread membership per chat, for surfaces that mark one known chat. */
  readonly threads$ = observable<Record<string, true>>({});
  readonly #threads = new Map<string, string>();
  #pending: Map<string, SummaryChange> | null = new Map();
  #load: Promise<void> | null = null;
  #closed = false;

  #apply(change: SummaryChange): boolean {
    if (change.type === "delete") {
      return this.#remove(change.key);
    }
    const row = change.value;
    const key = threadSummaryKey(row.connectionId, row.remoteThreadId);
    return isUnreadRootChat(row)
      ? this.#add(key, projectScopeKey(row.connectionId, row.cwd))
      : this.#remove(key);
  }

  #add(key: string, project: string): boolean {
    const previous = this.#threads.get(key);
    if (previous === project) {
      return false;
    }
    this.#threads.set(key, project);
    if (previous === undefined) {
      this.threads$[key]?.set(true);
    }
    return true;
  }

  #remove(key: string): boolean {
    if (!this.#threads.delete(key)) {
      return false;
    }
    this.threads$[key]?.delete();
    return true;
  }

  #publish(): void {
    const projects = [...new Set(this.#threads.values())].sort();
    const previous = this.projects$.peek();
    if (projects.length !== previous.length || projects.some((key, i) => key !== previous[i])) {
      this.projects$.set(projects);
    }
  }

  /** Hydrates unread membership once; events received during the read take precedence. */
  async resource(loader: () => Promise<readonly StoredThreadSummary[]>): Promise<void> {
    if (this.#load !== null) {
      return this.#load;
    }
    this.#load = loader()
      .then((rows) => {
        if (this.#closed) {
          return;
        }
        batch(() => {
          for (const row of rows) {
            this.#apply({ type: "insert", value: row });
          }
          for (const change of this.#pending?.values() ?? []) {
            this.#apply(change);
          }
        });
        this.#pending = null;
        this.#publish();
      })
      .catch((error: unknown) => {
        this.#load = null;
        throw error;
      });
    return this.#load;
  }

  /** Maintains unread membership even for threads outside every resident list window. */
  publish(changes: readonly SummaryChange[]): void {
    if (this.#closed) {
      return;
    }
    let changed = false;
    beginBatch();
    try {
      for (const change of changes) {
        const key =
          change.type === "delete"
            ? change.key
            : threadSummaryKey(change.value.connectionId, change.value.remoteThreadId);
        this.#pending?.set(key, change);
        changed = this.#apply(change) || changed;
      }
    } finally {
      endBatch();
    }
    if (changed) {
      this.#publish();
    }
  }

  close(): void {
    this.#closed = true;
    this.#pending?.clear();
    batch(() => {
      for (const key of this.#threads.keys()) {
        this.#remove(key);
      }
    });
  }
}
