// Adapted from TanStack Query's default structural-sharing implementation:
// https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts
// TanStack Query is distributed under the MIT License.

const MAX_DEPTH = 500;

/**
 * Returns `previous` when `next` is deeply equal. Otherwise, deeply equal
 * children in `next` are replaced with their references from `previous`.
 *
 * This intentionally has TanStack Query's JSON-value semantics: only plain
 * objects and dense arrays are traversed. Other values are treated atomically.
 */
export function replaceEqualDeep<T>(previous: unknown, next: T, depth = 0): T {
  const shared = replaceEqualValue(previous, next, depth);
  // WHY: replaceEqualValue returns next, a subtree from next, or a container rebuilt with next's exact shape; the generic type is intentionally preserved at this public boundary.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return shared as T;
}

function replaceEqualValue(previous: unknown, next: unknown, depth: number): unknown {
  if (previous === next) {
    return previous;
  }
  if (depth > MAX_DEPTH) {
    return next;
  }
  if (isPlainArray(previous) && isPlainArray(next)) {
    return replaceEqualArray(previous, next, depth);
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    return replaceEqualObject(previous, next, depth);
  }
  return next;
}

function replaceEqualArray(
  previous: readonly unknown[],
  next: readonly unknown[],
  depth: number,
): unknown {
  const copy = new Array<unknown>(next.length);
  let equalItems = 0;
  for (let index = 0; index < next.length; index += 1) {
    const value = replaceEqualValue(previous[index], next[index], depth + 1);
    copy[index] = value;
    if (value === previous[index] && index < previous.length) {
      equalItems += 1;
    }
  }
  return previous.length === next.length && equalItems === previous.length ? previous : copy;
}

function replaceEqualObject(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  depth: number,
): unknown {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  const copy: Record<string, unknown> = {};
  let equalItems = 0;
  for (const key of nextKeys) {
    const value = replaceEqualValue(previous[key], next[key], depth + 1);
    copy[key] = value;
    if (value === previous[key] && Object.hasOwn(previous, key)) {
      equalItems += 1;
    }
  }
  return previousKeys.length === nextKeys.length && equalItems === previousKeys.length
    ? previous
    : copy;
}

function isPlainArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value.length === Object.keys(value).length;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
