// Adapted from TanStack Query's default structural-sharing implementation:
// https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts
// TanStack Query is distributed under the MIT License.

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Returns `previous` when `next` is deeply equal. Otherwise, deeply equal
 * children in `next` are replaced with their references from `previous`.
 *
 * This intentionally has TanStack Query's JSON-value semantics: only plain
 * objects and dense arrays are traversed. Other values are treated atomically.
 */
export function replaceEqualDeep<T>(previous: unknown, next: T, depth?: number): T;
export function replaceEqualDeep(previous: any, next: any, depth = 0): any {
  if (previous === next) return previous;
  if (depth > 500) return next;

  const array = isPlainArray(previous) && isPlainArray(next);
  if (!array && !(isPlainObject(previous) && isPlainObject(next))) return next;

  const previousItems = array ? previous : Object.keys(previous);
  const previousSize = previousItems.length;
  const nextItems = array ? next : Object.keys(next);
  const nextSize = nextItems.length;
  const copy: any = array ? new Array(nextSize) : {};
  let equalItems = 0;

  for (let index = 0; index < nextSize; index += 1) {
    const key: any = array ? index : nextItems[index];
    const previousItem = previous[key];
    const nextItem = next[key];
    if (previousItem === nextItem) {
      copy[key] = previousItem;
      if (array ? index < previousSize : hasOwn.call(previous, key)) equalItems += 1;
      continue;
    }

    if (
      previousItem === null
      || nextItem === null
      || typeof previousItem !== "object"
      || typeof nextItem !== "object"
    ) {
      copy[key] = nextItem;
      continue;
    }

    const value = replaceEqualDeep(previousItem, nextItem, depth + 1);
    copy[key] = value;
    if (value === previousItem) equalItems += 1;
  }

  return previousSize === nextSize && equalItems === previousSize ? previous : copy;
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length === Object.keys(value).length;
}

function isPlainObject(value: any): value is Record<PropertyKey, unknown> {
  if (!hasObjectPrototype(value)) return false;

  const constructor = value.constructor;
  if (constructor === undefined) return true;

  const prototype = constructor.prototype;
  if (!hasObjectPrototype(prototype)) return false;
  if (!prototype.hasOwnProperty("isPrototypeOf")) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  return true;
}

function hasObjectPrototype(value: any): boolean {
  return Object.prototype.toString.call(value) === "[object Object]";
}
