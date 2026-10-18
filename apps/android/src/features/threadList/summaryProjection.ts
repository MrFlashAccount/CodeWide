import type { PendingServerRequest } from "../../data/pending-request-types";
import { replaceEqualDeep } from "../../data/replace-equal-deep";
import { projectThreadHotStates } from "../../data/thread-hot-state";
import type { StoredThreadSummary } from "../../data/thread-summary-types";

/** One listed summary row and its pending-request projection. */
type ProjectedRow = {
  /** The published summary row this projection was derived from. */
  readonly source: StoredThreadSummary;
  /** The row joined with its pending requests; identity-stable while deeply equal. */
  readonly value: StoredThreadSummary;
};

/** The rows of one publication and what changed against the previous one. */
type Publication = {
  changed: boolean;
  reorder: boolean;
  /** Rows that were already listed; fewer than before means rows were removed. */
  retained: number;
  readonly rows: Map<string, ProjectedRow>;
};

const NO_REQUESTS: readonly PendingServerRequest[] = [];

/**
 * Keeps the listed thread rows referentially stable while unrelated live queries
 * (for example the active turn stream) re-render the workspace.
 *
 * A publication is applied by row identity: a row is re-projected only when its
 * summary object or its pending requests changed, every other row keeps its
 * projected identity, and the list is re-sorted only when a row was added or a
 * changed row's order key (`pinned`, `recencyAt ?? updatedAt`) moved. Removals
 * preserve the existing order. The result equals a full filter, hot-state
 * projection and sort of the same input.
 */
export class ThreadListProjection {
  #summaries: readonly StoredThreadSummary[] | null = null;
  #pendingRequests: readonly PendingServerRequest[] | null = null;
  #requests: ReadonlyMap<string, readonly PendingServerRequest[]> = new Map();
  /** Threads whose request group changed in the current publication. */
  #changedRequests: ReadonlySet<string> = new Set();
  #rows: ReadonlyMap<string, ProjectedRow> = new Map();
  #value: readonly StoredThreadSummary[] = [];
  /** False after a duplicate-row fallback: `#value` is then not indexed by `#rows`. */
  #indexed = true;

  /** Projects listed root rows with their pending-request state, newest first and pins on top. */
  project(
    summaries: readonly StoredThreadSummary[],
    pendingRequests: readonly PendingServerRequest[],
  ): readonly StoredThreadSummary[] {
    if (summaries === this.#summaries && pendingRequests === this.#pendingRequests) {
      return this.#value;
    }
    this.#changedRequests =
      pendingRequests === this.#pendingRequests
        ? new Set()
        : this.#regroupRequests(pendingRequests);
    this.#summaries = summaries;
    this.#pendingRequests = pendingRequests;
    const publication = this.#collect(summaries);
    if (publication === null) {
      return this.#projectAll(summaries, pendingRequests);
    }
    const removed = publication.retained !== this.#rows.size;
    this.#rows = publication.rows;
    this.#indexed = true;
    if (publication.changed || removed) {
      this.#value = publication.reorder
        ? sortedRows(publication.rows)
        : retainOrder(this.#value, publication.rows);
    }
    return this.#value;
  }

  /** Applies listed rows by identity; `null` when a thread appears twice. */
  #collect(summaries: readonly StoredThreadSummary[]): Publication | null {
    const publication: Publication = {
      changed: !this.#indexed,
      reorder: !this.#indexed,
      retained: 0,
      rows: new Map(),
    };
    for (const summary of summaries) {
      if (!isListed(summary)) {
        continue;
      }
      const key = summaryKey(summary);
      // The callers deduplicate by thread identity; keep the full semantics if one does not.
      if (publication.rows.has(key)) {
        return null;
      }
      const previous = this.#rows.get(key);
      const row = this.#row(previous, summary, key);
      publication.rows.set(key, row);
      trackRow(publication, previous, row);
    }
    return publication;
  }

  #row(
    previous: ProjectedRow | undefined,
    summary: StoredThreadSummary,
    key: string,
  ): ProjectedRow {
    if (previous?.source === summary && !this.#changedRequests.has(key)) {
      return previous;
    }
    // One row in, one row out: the hot-state projection maps rows one to one.
    const projected =
      projectThreadHotStates([summary], this.#requests.get(key) ?? NO_REQUESTS)[0] ?? summary;
    return { source: summary, value: replaceEqualDeep(previous?.value, projected) };
  }

  /** Groups requests by thread and returns the threads whose request group changed. */
  #regroupRequests(pendingRequests: readonly PendingServerRequest[]): ReadonlySet<string> {
    const groups = new Map<string, PendingServerRequest[]>();
    for (const request of pendingRequests) {
      const threadId = request.params.threadId;
      if (typeof threadId !== "string") {
        continue;
      }
      const key = `${request.connectionId}\u0000${threadId}`;
      const group = groups.get(key) ?? [];
      group.push(request);
      groups.set(key, group);
    }
    const changed = new Set<string>();
    for (const [key, group] of groups) {
      if (!sameRequests(this.#requests.get(key), group)) {
        changed.add(key);
      }
    }
    for (const key of this.#requests.keys()) {
      if (!groups.has(key)) {
        changed.add(key);
      }
    }
    this.#requests = groups;
    return changed;
  }

  #projectAll(
    summaries: readonly StoredThreadSummary[],
    pendingRequests: readonly PendingServerRequest[],
  ): readonly StoredThreadSummary[] {
    this.#rows = new Map();
    this.#indexed = false;
    this.#value = replaceEqualDeep(
      this.#value,
      projectThreadHotStates(summaries.filter(isListed), pendingRequests).sort(
        compareThreadSummaryRecency,
      ),
    );
    return this.#value;
  }
}

/** Optimistic deletes and subagent threads are not rows of the main list. */
function isListed(summary: StoredThreadSummary): boolean {
  return typeof summary.deleteCommandId !== "string" && typeof summary.parentThreadId !== "string";
}

/** A new row or a moved order key needs a sort; any other changed row keeps the order. */
function trackRow(
  publication: Publication,
  previous: ProjectedRow | undefined,
  row: ProjectedRow,
): void {
  if (previous === undefined) {
    publication.changed = true;
    publication.reorder = true;
    return;
  }
  publication.retained += 1;
  if (row.value !== previous.value) {
    publication.changed = true;
    publication.reorder ||= orderKeyChanged(previous.value, row.value);
  }
}

function summaryKey(summary: StoredThreadSummary): string {
  return `${summary.connectionId}\u0000${summary.remoteThreadId}`;
}

function sameRequests(
  previous: readonly PendingServerRequest[] | undefined,
  next: readonly PendingServerRequest[],
): boolean {
  return (
    previous !== undefined &&
    previous.length === next.length &&
    previous.every((request, index) => request === next[index])
  );
}

function orderKeyChanged(previous: StoredThreadSummary, next: StoredThreadSummary): boolean {
  return previous.pinned !== next.pinned || recency(previous) !== recency(next);
}

/** The list order key besides `pinned`; a preview without `recencyAt` moves only rows lacking one. */
function recency(summary: StoredThreadSummary): number {
  return summary.recencyAt ?? summary.updatedAt;
}

function sortedRows(rows: ReadonlyMap<string, ProjectedRow>): StoredThreadSummary[] {
  return Array.from(rows.values(), (row) => row.value).sort(compareThreadSummaryRecency);
}

/** Replaces rows in place and drops removed ones; no order key moved, so the order holds. */
function retainOrder(
  previous: readonly StoredThreadSummary[],
  rows: ReadonlyMap<string, ProjectedRow>,
): StoredThreadSummary[] {
  const value: StoredThreadSummary[] = [];
  for (const summary of previous) {
    const row = rows.get(summaryKey(summary));
    if (row !== undefined) {
      value.push(row.value);
    }
  }
  return value;
}

function compareThreadSummaryRecency(
  left: StoredThreadSummary,
  right: StoredThreadSummary,
): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  if (recency(left) !== recency(right)) {
    return recency(right) - recency(left);
  }
  return left.remoteThreadId.localeCompare(right.remoteThreadId);
}
