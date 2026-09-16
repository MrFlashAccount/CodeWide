import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { observablePrimitive } from "@legendapp/state";

import type { SearchContextQuery, SearchConversationPage } from "../../data/message-search";
import { ThreadHistoryViewportFill } from "../../data/thread-history-viewport-fill";
import type { LocatedSearchHit } from "./GlobalSearchScreen";

type ReadWindow = (
  connectionId: string,
  query: SearchContextQuery,
) => Promise<SearchConversationPage>;
type WindowState =
  | { readonly page: SearchConversationPage | null; readonly status: "loading" }
  | { readonly page: SearchConversationPage; readonly status: "ready" }
  | {
      readonly message: string;
      readonly page: SearchConversationPage | null;
      readonly status: "error";
    };

/** A bounded historical viewport inside the real chat; it cannot mutate live cache or queue. */
export class SearchConversationWindow {
  readonly state$ = observablePrimitive<WindowState>({ page: null, status: "loading" });
  private resolvedMessageItemId: string;
  private pending: Promise<void> | null = null;
  private initialized = false;
  private readonly viewportFill: ThreadHistoryViewportFill;

  readonly target: LocatedSearchHit;
  readonly query: string;
  private readonly load: ReadWindow;

  constructor(
    target: LocatedSearchHit,
    query: string,
    load: ReadWindow,
    afterLayout: () => Promise<void> = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    },
  ) {
    this.target = target;
    this.query = query;
    this.load = load;
    this.resolvedMessageItemId = `search-message:${String(target.hit.messageId)}`;
    this.viewportFill = new ThreadHistoryViewportFill({
      afterLayout,
      isCurrent: () => true,
      loadPage: async (direction) => this.loadAdjacentPage(direction),
    });
  }

  get messageItemId(): string {
    return this.resolvedMessageItemId;
  }

  async read(): Promise<void> {
    if (this.pending !== null) {
      return this.pending;
    }
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    return this.request("around", this.target.hit.messageId);
  }

  async retry(): Promise<void> {
    return this.request("around", this.target.hit.messageId);
  }

  async loadRange(direction: "older" | "newer"): Promise<void> {
    return this.viewportFill.load(direction);
  }

  async reportViewport(viewportHeight: number, contentHeight: number): Promise<void> {
    return this.viewportFill.reportViewport(viewportHeight, contentHeight);
  }

  cancelViewportFill(): void {
    this.viewportFill.cancel();
  }

  private async loadAdjacentPage(direction: "older" | "newer"): Promise<boolean> {
    const page = this.state$.peek().page;
    const boundary = page?.[direction];
    if (boundary === null || boundary === undefined || this.pending !== null) {
      return false;
    }
    await this.request(direction, boundary);
    const next = this.state$.peek();
    if (next.status === "error") {
      throw new Error(next.message);
    }
    return (
      next.page !== null &&
      (next.page[direction] !== boundary || next.page.messages.length !== page?.messages.length)
    );
  }

  replaceItems(turnId: string, items: Turn["items"]): void {
    const current = this.state$.peek();
    if (current.page === null) {
      return;
    }
    const previous = current.page.turns.find((turn) => turn.id === turnId);
    if (turnId === this.target.hit.turnId && previous !== undefined) {
      this.resolvedMessageItemId = resolveLoadedMessageId(
        previous.items,
        items,
        this.messageItemId,
      );
    }
    this.state$.set({
      ...current,
      page: {
        ...current.page,
        turns: current.page.turns.map((turn) =>
          turn.id === turnId ? { ...turn, items, itemsView: "full" } : turn,
        ),
      },
    });
  }

  private async request(
    direction: SearchContextQuery["direction"],
    messageId: number,
  ): Promise<void> {
    if (this.pending !== null) {
      return this.pending;
    }
    const previous = this.state$.peek().page;
    this.state$.set({ page: previous, status: "loading" });
    const operation = this.load(this.target.connectionId, {
      direction,
      messageId,
      threadId: this.target.hit.threadId,
    })
      .then((page) => {
        const next =
          previous === null || direction === "around"
            ? page
            : mergeSearchWindows(previous, page, direction);
        const indexedId = `search-message:${String(this.target.hit.messageId)}`;
        if (next.turns.some((turn) => turn.items.some((item) => item.id === indexedId))) {
          this.resolvedMessageItemId = indexedId;
        }
        this.state$.set({ page: next, status: "ready" });
      })
      .catch((error: unknown) => {
        this.state$.set({
          message: error instanceof Error ? error.message : "Could not load this search position",
          page: previous,
          status: "error",
        });
      })
      .finally(() => {
        this.pending = null;
      });
    this.pending = operation;
    return operation;
  }
}

// Indexed messages and full activity use different IDs. Match the same ordered
// occurrence, not just the first equal text; never change canonical activity IDs.
function resolveLoadedMessageId(
  previous: Turn["items"],
  loaded: Turn["items"],
  selectedId: string,
): string {
  const selected = previous.find((item) => item.id === selectedId);
  if (selected === undefined) {
    return selectedId;
  }
  const text = messageText(selected);
  if (text === null) {
    return selectedId;
  }
  let occurrence = 0;
  for (const item of previous) {
    if (item.id === selectedId) {
      break;
    }
    if (item.type === selected.type && messageText(item) === text) {
      occurrence += 1;
    }
  }
  for (const item of loaded) {
    if (item.type !== selected.type || messageText(item) !== text) {
      continue;
    }
    if (occurrence === 0) {
      return item.id;
    }
    occurrence -= 1;
  }
  return selectedId;
}

function messageText(item: Turn["items"][number]): string | null {
  if (item.type === "agentMessage") {
    return item.text;
  }
  if (item.type === "userMessage") {
    return item.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  }
  return null;
}

/** Maintains chronological, deduplicated turns while bounding residency on both sides. */
export function mergeSearchWindows(
  previous: SearchConversationPage,
  page: SearchConversationPage,
  direction: "older" | "newer",
): SearchConversationPage {
  const messages = new Map(previous.messages.map((message) => [message.messageId, message]));
  for (const message of page.messages) {
    messages.set(message.messageId, message);
  }
  const ordered = Array.from(messages.values()).sort(
    (left, right) => left.sourceOffset - right.sourceOffset,
  );
  const turns = new Map(previous.turns.map((turn) => [turn.id, turn]));
  for (const turn of page.turns) {
    turns.set(turn.id, turn);
  }
  const ids = Array.from(new Set(ordered.map((message) => message.turnId)));
  const retainedIds = direction === "older" ? ids.slice(0, 15) : ids.slice(-15);
  const retained = new Set(retainedIds);
  const visible = ordered.filter((message) => retained.has(message.turnId));
  return {
    messages: visible,
    newer:
      direction === "newer"
        ? page.newer
        : ids.length > 15
          ? (visible.at(-1)?.messageId ?? null)
          : previous.newer,
    older:
      direction === "older"
        ? page.older
        : ids.length > 15
          ? (visible[0]?.messageId ?? null)
          : previous.older,
    turns: retainedIds.flatMap((id) => {
      const turn = turns.get(id);
      return turn === undefined ? [] : [turn];
    }),
  };
}
