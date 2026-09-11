import { observable } from "@legendapp/state";
import type { ComposerMention } from "./composer-mentions";

export type MentionQuery = { readonly indicator: "/" | "@"; readonly text: string };
export type SearchComposerMentions = (query: MentionQuery) => Promise<readonly ComposerMention[]>;
export type SuggestionState =
  | { readonly status: "closed" }
  | { readonly status: "loading"; readonly query: MentionQuery; readonly items: readonly ComposerMention[] }
  | { readonly status: "ready"; readonly query: MentionQuery; readonly items: readonly ComposerMention[] }
  | { readonly status: "error"; readonly query: MentionQuery };

/** An input owns its search lifetime. Late results cannot reopen a dismissed popup. */
export class ComposerSuggestions {
  readonly state$ = observable<{ value: SuggestionState }>({ value: { status: "closed" } });
  private request = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  search(query: MentionQuery, search: SearchComposerMentions): void {
    const current = this.state$.peek().value;
    if (current.status !== "closed" && current.status !== "error"
      && current.query.indicator === query.indicator && current.query.text === query.text) return;
    const items = (current.status === "ready" || current.status === "loading")
      && current.query.indicator === query.indicator ? current.items : [];
    const request = ++this.request;
    if (this.timer !== null) clearTimeout(this.timer);
    // Keep the existing menu while a query settles; do not publish closed/loading
    // flashes for native selection events that repeat the same mention.
    this.state$.set({ value: { status: "loading", query, items } });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.resolve(request, query, search);
    }, query.text.length === 0 ? 0 : 120);
  }

  close(): void {
    this.request += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.state$.set({ value: { status: "closed" } });
  }

  private async resolve(request: number, query: MentionQuery, search: SearchComposerMentions): Promise<void> {
    try {
      const items = await search(query);
      if (request === this.request) this.state$.set({ value: { status: "ready", query, items } });
    } catch {
      if (request === this.request) this.state$.set({ value: { status: "error", query } });
    }
  }
}
