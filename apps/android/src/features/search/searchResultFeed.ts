import { observable } from "@legendapp/state";

import type { SearchResultTarget, ServerSearchResult } from "./searchResultTypes";

export type SearchResultFeedSnapshot = {
  readonly hits: readonly SearchResultTarget[];
  readonly loadedPage: number;
  readonly nextOffsets: Readonly<Record<string, number>>;
  readonly notices: readonly ServerSearchResult[];
};

const EMPTY_FEED: SearchResultFeedSnapshot = {
  hits: [],
  loadedPage: -1,
  nextOffsets: {},
  notices: [],
};

/** Keeps already displayed results and each server's continuation across route remounts. */
export class SearchResultFeed {
  readonly snapshot$ = observable<SearchResultFeedSnapshot>(EMPTY_FEED);

  reset(): void {
    this.snapshot$.set(EMPTY_FEED);
  }

  append(page: number, serverResults: readonly ServerSearchResult[]): void {
    const previous = this.snapshot$.peek();
    if (page !== previous.loadedPage + 1) {
      return;
    }
    const data = collectPage(serverResults);
    this.snapshot$.set({
      hits: appendUnique(previous.hits, data.hits),
      loadedPage: page,
      nextOffsets: data.nextOffsets,
      notices: mergeNotices(previous.notices, serverResults),
    });
  }
}

function collectPage(serverResults: readonly ServerSearchResult[]): {
  readonly hits: readonly SearchResultTarget[];
  readonly nextOffsets: Readonly<Record<string, number>>;
} {
  const nextOffsets: Record<string, number> = {};
  const hits: SearchResultTarget[] = [];
  for (const result of serverResults) {
    if (result.status === "error") {
      continue;
    }
    if (result.page.nextOffset !== null) {
      nextOffsets[result.connectionId] = result.page.nextOffset;
    }
    for (const hit of result.page.data) {
      hits.push({ connectionId: result.connectionId, hit });
    }
  }
  hits.sort((left, right) => right.hit.timestamp.localeCompare(left.hit.timestamp));
  return { hits, nextOffsets };
}

function appendUnique(
  previous: readonly SearchResultTarget[],
  incoming: readonly SearchResultTarget[],
): readonly SearchResultTarget[] {
  const seen = new Set<string>();
  for (const target of previous) {
    seen.add(resultKey(target));
  }
  const hits: SearchResultTarget[] = [...previous];
  for (const target of incoming) {
    const key = resultKey(target);
    if (!seen.has(key)) {
      seen.add(key);
      hits.push(target);
    }
  }
  return hits;
}

function mergeNotices(
  previous: readonly ServerSearchResult[],
  incoming: readonly ServerSearchResult[],
): readonly ServerSearchResult[] {
  const notices = new Map<string, ServerSearchResult>();
  for (const result of previous) {
    notices.set(result.connectionId, result);
  }
  for (const result of incoming) {
    notices.set(result.connectionId, result);
  }
  return [...notices.values()];
}

function resultKey(target: SearchResultTarget): string {
  return `${target.connectionId}:${String(target.hit.messageId)}`;
}
