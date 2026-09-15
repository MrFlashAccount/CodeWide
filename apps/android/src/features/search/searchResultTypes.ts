import { type MessageSearchHit, type MessageSearchPage } from "../../data/message-search";

export interface SearchResultTarget {
  readonly connectionId: string;
  readonly hit: MessageSearchHit;
}

export type ServerSearchResult =
  | { readonly status: "ready"; readonly connectionId: string; readonly page: MessageSearchPage }
  | { readonly status: "error"; readonly connectionId: string; readonly message: string };
