import { unknownRecord } from "./unknownRecord";

/** Reads Companion's catalog removal instruction; never infers membership from local state. */
export function isCatalogExcluded(value: unknown): boolean {
  const excluded = unknownRecord(value)?.codewideCatalogExcluded;
  if (excluded !== undefined && typeof excluded !== "boolean") {
    throw new Error("Companion returned invalid catalog membership");
  }
  return excluded === true;
}

/** Validates server-issued evictions, including stale pinned/unread cache entries. */
export function catalogExcludedThreadIds(summary: unknown): readonly string[] {
  const ids = unknownRecord(summary)?.excludedThreadIds;
  if (ids === undefined) {
    return [];
  }
  if (!Array.isArray(ids)) {
    throw new Error("Companion returned invalid catalog removals");
  }
  return ids.map((id: unknown) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Companion returned invalid catalog removal identity");
    }
    return id;
  });
}
