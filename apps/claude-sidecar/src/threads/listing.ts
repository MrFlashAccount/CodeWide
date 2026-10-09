/**
 * `thread.list` filtering, ordering and cursors. Pure.
 *
 * Cursor format: `"v1:<sortKey>:<direction>:<valueSec>:<id>"`; a page starts
 * strictly after that position in the requested order. Ties on the sort
 * value are broken by thread id in the same direction. A null `recencyAt`
 * sorts by `updatedAt`.
 */

import type { AgentThread, SortDirection, SortWindow, ThreadListParams, ThreadSortKey } from "../protocol.js";

export interface CursorPosition {
  readonly sortKey: ThreadSortKey;
  readonly direction: SortDirection;
  readonly value: number;
  readonly id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return `v1:${position.sortKey}:${position.direction}:${position.value}:${position.id}`;
}

export function decodeCursor(cursor: string): CursorPosition | null {
  const match = /^v1:(createdAt|updatedAt|recencyAt):(asc|desc):(-?\d+):(.+)$/.exec(cursor);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) {
    return null;
  }
  return {
    // WHY: both values were matched against their exact literal alternatives.
    sortKey: match[1] as ThreadSortKey,
    direction: match[2] as SortDirection,
    value: Number(match[3]),
    id: match[4],
  };
}

export function sortValue(thread: AgentThread, key: ThreadSortKey): number {
  if (key === "createdAt") return thread.createdAt;
  if (key === "updatedAt") return thread.updatedAt;
  return thread.recencyAt ?? thread.updatedAt;
}

function inWindow(value: number, window: SortWindow | null): boolean {
  if (window === null) return true;
  if (window.lower !== null && (window.lowerInclusive ? value < window.lower : value <= window.lower)) return false;
  if (window.upper !== null && (window.upperInclusive ? value > window.upper : value >= window.upper)) return false;
  return true;
}

function compare(left: AgentThread, right: AgentThread, key: ThreadSortKey, direction: SortDirection): number {
  const delta = sortValue(left, key) - sortValue(right, key);
  const order = delta !== 0 ? delta : left.appThreadId < right.appThreadId ? -1 : left.appThreadId > right.appThreadId ? 1 : 0;
  return direction === "asc" ? order : -order;
}

export type ListResult =
  | { readonly status: "ok"; readonly threads: readonly AgentThread[]; readonly nextCursor: string | null }
  | { readonly status: "error"; readonly message: string };

/**
 * Lists threads. `searchText` returns the text a search term is matched
 * against (name, else first user message); `isShell` tells whether a thread
 * has no user message yet (shells are hidden from the non-archived list).
 */
export function listThreads(
  threads: readonly AgentThread[],
  params: ThreadListParams,
  isShell: (thread: AgentThread) => boolean,
  searchText: (thread: AgentThread) => string,
): ListResult {
  let after: CursorPosition | null = null;
  if (params.cursor !== null) {
    after = decodeCursor(params.cursor);
    if (after === null || after.sortKey !== params.sortKey || after.direction !== params.sortDirection) {
      return { status: "error", message: "invalid thread list cursor" };
    }
  }
  const term = params.searchTerm?.toLowerCase() ?? null;
  const filtered = threads.filter(
    (thread) =>
      thread.archived === params.archived &&
      (params.archived || !isShell(thread)) &&
      (params.cwd === null || thread.cwd === params.cwd) &&
      (term === null || term.length === 0 || searchText(thread).toLowerCase().includes(term)) &&
      inWindow(sortValue(thread, params.sortKey), params.window),
  );
  const ordered = [...filtered].sort((left, right) => compare(left, right, params.sortKey, params.sortDirection));
  const position = after;
  const start =
    position === null
      ? 0
      : ordered.findIndex((thread) => {
          const value = sortValue(thread, params.sortKey);
          const beyond = params.sortDirection === "desc" ? value < position.value : value > position.value;
          const tieBeyond =
            value === position.value && (params.sortDirection === "desc" ? thread.appThreadId < position.id : thread.appThreadId > position.id);
          return beyond || tieBeyond;
        });
  const from = start < 0 ? ordered.length : start;
  const limit = Math.max(1, Math.min(params.limit, 500));
  const page = ordered.slice(from, from + limit);
  const last = page.at(-1);
  const nextCursor =
    last !== undefined && from + limit < ordered.length
      ? encodeCursor({ sortKey: params.sortKey, direction: params.sortDirection, value: sortValue(last, params.sortKey), id: last.appThreadId })
      : null;
  return { status: "ok", threads: page, nextCursor };
}
