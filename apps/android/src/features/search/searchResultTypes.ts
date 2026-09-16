import type { MessageSearchHit, MessageSearchPage } from "../../data/message-search";

export interface SearchResultTarget {
  readonly connectionId: string;
  readonly hit: MessageSearchHit;
}

export type ServerSearchResult =
  | { readonly connectionId: string; readonly page: MessageSearchPage; readonly status: "ready" }
  | { readonly connectionId: string; readonly message: string; readonly status: "error" };
