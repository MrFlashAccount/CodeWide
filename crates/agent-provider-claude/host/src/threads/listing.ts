/**
 * `thread.list` filtering, ordering and cursors. Pure.
 *
 * Cursor format: `"v1:<sortKey>:<direction>:<valueSec>:<id>"`; a page starts
 * strictly after that position in the requested order. Ties on the sort
 * value are broken by thread id in the same direction. A null `recencyAt`
 * sorts by `updatedAt`.
 */

import type {
  AgentThread,
  SortDirection,
  SortWindow,
  ThreadListParams,
  ThreadSortKey,
} from "../protocol.js";

export interface CursorPosition {
  readonly direction: SortDirection;
  readonly id: string;
  readonly sortKey: ThreadSortKey;
  readonly value: number;
}

export function encodeCursor(position: CursorPosition): string {
  return `v1:${position.sortKey}:${position.direction}:${String(position.value)}:${position.id}`;
}

const SORT_KEYS: ReadonlySet<unknown> = new Set<ThreadSortKey>([
  "createdAt",
  "updatedAt",
  "recencyAt",
]);
const DIRECTIONS: ReadonlySet<unknown> = new Set<SortDirection>(["asc", "desc"]);
const isSortKey = (value: unknown): value is ThreadSortKey => SORT_KEYS.has(value);
const isDirection = (value: unknown): value is SortDirection => DIRECTIONS.has(value);
const CURSOR = /^v1:(createdAt|updatedAt|recencyAt):(asc|desc):(-?\d+):(.+)$/u;

export function decodeCursor(cursor: string): CursorPosition | null {
  const [, sortKey, direction, value, id] = CURSOR.exec(cursor) ?? [];
  if (!isSortKey(sortKey) || !isDirection(direction) || value === undefined || id === undefined) {
    return null;
  }
  return { direction, id, sortKey, value: Number(value) };
}

export function sortValue(thread: AgentThread, key: ThreadSortKey): number {
  if (key === "createdAt") {
    return thread.createdAt;
  }
  if (key === "updatedAt") {
    return thread.updatedAt;
  }
  return thread.recencyAt ?? thread.updatedAt;
}

function inWindow(value: number, window: SortWindow | null): boolean {
  if (window === null) {
    return true;
  }
  if (
    window.lower !== null &&
    (window.lowerInclusive ? value < window.lower : value <= window.lower)
  ) {
    return false;
  }
  if (
    window.upper !== null &&
    (window.upperInclusive ? value > window.upper : value >= window.upper)
  ) {
    return false;
  }
  return true;
}

/** Code-unit order, the same order the cursor comparison uses. */
function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compare(left: AgentThread, right: AgentThread, params: ThreadListParams): number {
  const delta = sortValue(left, params.sortKey) - sortValue(right, params.sortKey);
  const order = delta === 0 ? compareIds(left.appThreadId, right.appThreadId) : delta;
  return params.sortDirection === "asc" ? order : -order;
}

export type ListResult =
  | { readonly message: string; readonly status: "error" }
  | {
      readonly nextCursor: string | null;
      readonly status: "ok";
      readonly threads: readonly AgentThread[];
    };

/** One listable thread with the facts filtering needs beyond the projection. */
export interface ListRow {
  /** Text a search term is matched against (name, else first prompt). */
  readonly searchText: string;
  /** No user message yet: hidden from the non-archived list. */
  readonly shell: boolean;
  readonly thread: AgentThread;
}

function decodeAfter(params: ThreadListParams): CursorPosition | null | "invalid" {
  if (params.cursor === null) {
    return null;
  }
  const after = decodeCursor(params.cursor);
  return after === null ||
    after.sortKey !== params.sortKey ||
    after.direction !== params.sortDirection
    ? "invalid"
    : after;
}

/** Archive state and shells: shells are listed only among archived threads. */
const inArchiveScope = (row: ListRow, params: ThreadListParams): boolean =>
  row.thread.archived === params.archived && (params.archived || !row.shell);

function matchesSearch(row: ListRow, params: ThreadListParams): boolean {
  const term = params.searchTerm?.toLowerCase() ?? "";
  return term.length === 0 || row.searchText.toLowerCase().includes(term);
}

function matches(row: ListRow, params: ThreadListParams): boolean {
  return (
    inArchiveScope(row, params) &&
    (params.cwd === null || row.thread.cwd === params.cwd) &&
    matchesSearch(row, params) &&
    inWindow(sortValue(row.thread, params.sortKey), params.window)
  );
}

/** Index of the first thread strictly after `position` in the requested order. */
function startAfter(
  ordered: readonly AgentThread[],
  params: ThreadListParams,
  position: CursorPosition,
): number {
  const descending = params.sortDirection === "desc";
  const index = ordered.findIndex((thread) => {
    const value = sortValue(thread, params.sortKey);
    if (value !== position.value) {
      return descending ? value < position.value : value > position.value;
    }
    return descending ? thread.appThreadId < position.id : thread.appThreadId > position.id;
  });
  return index === -1 ? ordered.length : index;
}

const MAX_PAGE = 500;

/** Lists threads: filters, orders, and pages after the cursor. */
export function listThreads(rows: readonly ListRow[], params: ThreadListParams): ListResult {
  const after = decodeAfter(params);
  if (after === "invalid") {
    return { message: "invalid thread list cursor", status: "error" };
  }
  const ordered = rows
    .flatMap((row) => (matches(row, params) ? [row.thread] : []))
    .toSorted((left, right) => compare(left, right, params));
  const from = after === null ? 0 : startAfter(ordered, params, after);
  const limit = Math.max(1, Math.min(params.limit, MAX_PAGE));
  const page = ordered.slice(from, from + limit);
  const last = page.at(-1);
  const nextCursor =
    last !== undefined && from + limit < ordered.length
      ? encodeCursor({
          direction: params.sortDirection,
          id: last.appThreadId,
          sortKey: params.sortKey,
          value: sortValue(last, params.sortKey),
        })
      : null;
  return { nextCursor, status: "ok", threads: page };
}
