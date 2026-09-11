import { observable } from "@legendapp/state";

/** Catalog totals are server-owned; an absent/old Companion response is not an empty archive. */
export function parseArchivedCatalogCount(value: unknown): number | null {
  if (value === null || typeof value !== "object" || !("archivedCount" in value)) return null;
  const count = value.archivedCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/** Fences late catalog responses after a live archive event or connection replacement. */
export class CatalogSummaryModel {
  readonly counts$ = observable<Record<string, number | null>>({});
  readonly #revisions = new Map<string, number>();

  revision(connectionId: string): number { return this.#revisions.get(connectionId) ?? 0; }

  invalidate(connectionId: string): void {
    this.#revisions.set(connectionId, this.revision(connectionId) + 1);
    this.counts$[connectionId]?.set(null);
  }

  publish(connectionId: string, revision: number, count: number | null): void {
    if (this.revision(connectionId) === revision) this.counts$[connectionId]?.set(count);
  }

  count(connectionIds: readonly string[]): number | null {
    if (connectionIds.length === 0) return null;
    let total = 0;
    for (const id of connectionIds) {
      const count = this.counts$[id]?.get();
      if (count === undefined || count === null) return null;
      total += count;
    }
    return total;
  }
}

export const catalogSummaryModel = new CatalogSummaryModel();
