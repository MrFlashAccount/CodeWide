import { batch, observable } from "@legendapp/state";

import { searchDateBoundary } from "../../data/message-search";
import type { SearchFilterValue } from "./SearchFilters";
import { SearchResultFeed } from "./searchResultFeed";
import type { ServerSearchResult } from "./searchResultTypes";

type SearchRequestBase = SearchFilterValue & {
  readonly revision: number;
  readonly text: string;
};

export type SearchRequest =
  | (SearchRequestBase & { readonly kind: "initial" })
  | (SearchRequestBase & {
      readonly kind: "continuation";
      readonly offsets: Readonly<Record<string, number>>;
      readonly page: number;
    });

/** Owned by the workspace, not the sidebar: opening a mobile chat must not reset search. */
export class SearchSession {
  readonly text$ = observable("");
  readonly filters$ = observable<SearchFilterValue>({
    from: "",
    project: "",
    serverId: "",
    threadId: "",
    until: "",
  });
  readonly request$ = observable<SearchRequest | null>(null);
  readonly error$ = observable<string | null>(null);
  readonly results = new SearchResultFeed();
  scrollOffset = 0;
  private focusRequested = true;
  private loadingPage = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  changeText(text: string): void {
    this.text$.set(text);
    this.cancelPending();
    if (text.trim() === "") {
      this.loadingPage = false;
      this.scrollOffset = 0;
      batch(() => {
        this.results.reset();
        this.request$.set(null);
      });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.submit();
    }, 250);
  }

  submit(): boolean {
    this.cancelPending();
    const text = this.text$.peek().trim();
    if (text === "") {
      return false;
    }
    const filters = this.filters$.peek();
    try {
      const from = searchDateBoundary(filters.from, false);
      const until = searchDateBoundary(filters.until, true);
      if (from !== null && until !== null && from >= until) {
        throw new Error("The start date must precede the end date");
      }
    } catch (error) {
      this.error$.set(error instanceof Error ? error.message : "Check the date range");
      return false;
    }
    this.error$.set(null);
    this.scrollOffset = 0;
    this.loadingPage = true;
    batch(() => {
      const revision = (this.request$.peek()?.revision ?? 0) + 1;
      this.results.reset();
      this.request$.set({ ...filters, kind: "initial", revision, text });
    });
    return true;
  }

  loadMore(): boolean {
    const request = this.request$.peek();
    const results = this.results.snapshot$.peek();
    if (
      request === null ||
      this.loadingPage ||
      results.loadedPage !== (request.kind === "initial" ? 0 : request.page) ||
      Object.keys(results.nextOffsets).length === 0
    ) {
      return false;
    }
    this.loadingPage = true;
    this.request$.set({
      ...request,
      kind: "continuation",
      offsets: results.nextOffsets,
      page: results.loadedPage + 1,
    });
    return true;
  }

  acceptPage(request: SearchRequest, serverResults: readonly ServerSearchResult[]): void {
    const current = this.request$.peek();
    const page = request.kind === "initial" ? 0 : request.page;
    if (
      current?.revision !== request.revision ||
      (current.kind === "initial" ? 0 : current.page) !== page
    ) {
      return;
    }
    this.results.append(page, serverResults);
    this.loadingPage = false;
  }

  cancelPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = null;
  }

  rememberScroll(offset: number): void {
    this.scrollOffset = Math.max(0, offset);
  }
  shouldFocus(): boolean {
    return this.focusRequested;
  }
  requestFocus(): void {
    this.focusRequested = true;
  }
  didFocus(): void {
    this.focusRequested = false;
  }
}
