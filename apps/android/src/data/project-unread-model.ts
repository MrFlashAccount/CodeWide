import { observable } from "@legendapp/state";

import { threadSummaryKey } from "./thread-summary-projection";
import type { StoredThreadSummary } from "./thread-summary-types";

type SummaryChange =
  | { type: "insert" | "update"; value: StoredThreadSummary }
  | { key: string; type: "delete" };

/** A project belongs to a server and an exact directory, never just a display name. */
export function projectScopeKey(connectionId: string, cwd: string): string {
  return `${connectionId}\u0000${cwd}`;
}

/** Device-owned unread state spans the persisted catalog, not a visible page. */
export class ProjectUnreadModel {
  readonly projects$ = observable<readonly string[]>([]);
  readonly #threads = new Map<string, string>();
  #pending: Map<string, SummaryChange> | null = new Map();
  #load: Promise<void> | null = null;
  #closed = false;

  #apply(change: SummaryChange): boolean {
    if (change.type === "delete") {
      return this.#threads.delete(change.key);
    }
    const row = change.value;
    const key = threadSummaryKey(row.connectionId, row.remoteThreadId);
    if (
      row.unread > 0 &&
      !row.archived &&
      row.parentThreadId === null &&
      row.deleteCommandId === null
    ) {
      const project = projectScopeKey(row.connectionId, row.cwd);
      if (this.#threads.get(key) === project) {
        return false;
      }
      this.#threads.set(key, project);
      return true;
    }
    return this.#threads.delete(key);
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
        for (const row of rows) {
          this.#apply({ type: "insert", value: row });
        }
        for (const change of this.#pending?.values() ?? []) {
          this.#apply(change);
        }
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
    for (const change of changes) {
      const key =
        change.type === "delete"
          ? change.key
          : threadSummaryKey(change.value.connectionId, change.value.remoteThreadId);
      this.#pending?.set(key, change);
      changed = this.#apply(change) || changed;
    }
    if (changed) {
      this.#publish();
    }
  }

  close(): void {
    this.#closed = true;
    this.#pending?.clear();
    this.#threads.clear();
  }
}
