import { observable } from "@legendapp/state";

import { searchDateBoundary } from "../../data/message-search";
import type { SearchFilterValue } from "./SearchFilters";

export interface SearchRequest extends SearchFilterValue {
  readonly page: number;
  readonly revision: number;
  readonly text: string;
}

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
  scrollOffset = 0;
  private focusRequested = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  changeText(text: string): void {
    this.text$.set(text);
    this.cancelPending();
    if (text.trim() === "") {
      this.request$.set(null);
      this.scrollOffset = 0;
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
    this.request$.set({
      ...filters,
      page: 0,
      revision: (this.request$.peek()?.revision ?? 0) + 1,
      text,
    });
    return true;
  }

  changePage(delta: number): void {
    const request = this.request$.peek();
    if (request === null) {
      return;
    }
    this.scrollOffset = 0;
    this.request$.set({ ...request, page: Math.max(0, request.page + delta) });
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
