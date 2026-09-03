import type { V2Item, V2Query, V2QueryResult, V2TurnView } from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";
import {
  THREAD_HISTORY_RESIDENT_LIMIT,
  type ThreadHistorySearchSeed,
} from "./threadHistoryResource";

/** @testOnly Exposes the bounded traversal ceiling to its boundary regression. */
export const THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT = 8;

type ThreadSearchPhase =
  | { kind: "inactive" }
  | { kind: "ready" }
  | { direction: ThreadSearchDirection; kind: "loading" }
  | { message: string; kind: "error" };

export interface ThreadSearchSnapshot {
  canMoveNewer: boolean;
  canMoveOlder: boolean;
  matchCount: number;
  matchTurnIds: string[];
  phase: ThreadSearchPhase;
  query: string;
  selectedTurnId: string | null;
  turns: V2TurnView[];
}

interface ThreadSearchSource {
  searchSeed(): ThreadHistorySearchSeed;
  subscribe(listener: () => void): () => void;
}

interface ThreadSearchResourceInput {
  execute(query: V2Query): Promise<V2QueryResult>;
  source: ThreadSearchSource;
  threadId: string;
}

type ThreadSearchDirection = "newer" | "older";

interface SearchPage extends ThreadHistorySearchSeed {
  atSource: boolean;
}

/** Owns bounded authoritative history traversal for full-thread search. */
export class ThreadSearchResource extends ObservableResource<ThreadSearchSnapshot> {
  readonly #execute: ThreadSearchResourceInput["execute"];
  readonly #source: ThreadSearchSource;
  readonly #threadId: string;
  #generation = 0;
  #page: SearchPage;
  #query = "";
  #selectedTurnId: string | null = null;
  #subscriberCount = 0;
  #unsubscribe: (() => void) | null = null;

  constructor(input: ThreadSearchResourceInput) {
    const seed = input.source.searchSeed();
    const page = sourcePage(seed);
    super(snapshot(page, "", null, { kind: "inactive" }));
    this.#execute = input.execute;
    this.#source = input.source;
    this.#threadId = input.threadId;
    this.#page = page;
    this.publish({ status: "ready", value: this.snapshot().value });
  }

  override subscribe = (listener: () => void): (() => void) => {
    const subscription = (): void => listener();
    const unsubscribe = this.addListener(subscription);
    let subscribed = true;
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.#activate();
    return () => {
      if (!subscribed) return;
      subscribed = false;
      unsubscribe();
      this.#subscriberCount -= 1;
      if (this.#subscriberCount === 0) this.#deactivate();
    };
  };

  setQuery(query: string): void {
    this.#generation += 1;
    this.#query = query.trim();
    this.#page = sourcePage(this.#source.searchSeed());
    this.#selectedTurnId = newestMatchId(this.#page.turns, this.#query);
    this.#publishReady();
  }

  async moveOlder(): Promise<void> {
    await this.#move("older", this.#generation);
  }

  async moveNewer(): Promise<void> {
    await this.#move("newer", this.#generation);
  }

  #activate(): void {
    this.#unsubscribe = this.#source.subscribe(this.#synchronize);
    this.#synchronize();
  }

  #deactivate(): void {
    this.#generation += 1;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  readonly #synchronize = (): void => {
    const seed = this.#source.searchSeed();
    if (!this.#page.atSource && seed.generationId === this.#page.generationId) return;
    this.#generation += 1;
    this.#page = sourcePage(seed);
    this.#selectedTurnId = newestMatchId(this.#page.turns, this.#query);
    this.#publishReady();
  };

  async #move(direction: ThreadSearchDirection, generation: number): Promise<void> {
    if (this.#query === "" || generation !== this.#generation) return;
    const localMatch = adjacentMatchId(
      this.#page.turns,
      this.#query,
      this.#selectedTurnId,
      direction,
    );
    if (localMatch !== null) {
      this.#selectedTurnId = localMatch;
      this.#publishReady();
      return;
    }
    await this.#scan(direction, generation);
  }

  async #scan(direction: ThreadSearchDirection, generation: number): Promise<void> {
    let page = this.#page;
    let cursor = cursorFor(page, direction);
    if (cursor === null) return;
    this.publish({
      status: "ready",
      value: snapshot(page, this.#query, this.#selectedTurnId, { direction, kind: "loading" }),
    });
    try {
      for (let index = 0; index < THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT; index += 1) {
        const result = await this.#executePage(cursor, direction);
        if (generation !== this.#generation) return;
        page = resultPage(result, page.generationId);
        const match = edgeMatchId(page.turns, this.#query, direction);
        this.#page = page;
        this.#selectedTurnId = match;
        if (match !== null) {
          this.#publishReady();
          return;
        }
        cursor = cursorFor(page, direction);
        if (cursor === null) break;
      }
      this.#publishReady();
    } catch (cause: unknown) {
      if (generation !== this.#generation) return;
      const message = cause instanceof Error ? cause.message : "Could not search thread history";
      this.publish({
        message,
        status: "error",
        value: snapshot(this.#page, this.#query, this.#selectedTurnId, {
          kind: "error",
          message,
        }),
      });
    }
  }

  async #executePage(
    cursor: string,
    direction: ThreadSearchDirection,
  ): Promise<Extract<V2QueryResult, { kind: "history.page" }>> {
    const result = await this.#execute({
      cursor,
      detail: "summary",
      direction,
      kind: "history.page",
      limit: THREAD_HISTORY_RESIDENT_LIMIT,
      threadId: this.#threadId,
    });
    if (result.kind !== "history.page" || result.threadId !== this.#threadId) {
      throw new Error("Unexpected thread search response");
    }
    return result;
  }

  #publishReady(): void {
    const phase: ThreadSearchPhase = this.#query === "" ? { kind: "inactive" } : { kind: "ready" };
    this.publish({
      status: "ready",
      value: snapshot(this.#page, this.#query, this.#selectedTurnId, phase),
    });
  }
}

function sourcePage(seed: ThreadHistorySearchSeed): SearchPage {
  return {
    atSource: true,
    generationId: seed.generationId,
    newerCursor: seed.newerCursor,
    olderCursor: seed.olderCursor,
    turns: seed.turns,
  };
}

function resultPage(
  result: Extract<V2QueryResult, { kind: "history.page" }>,
  generationId: string | null,
): SearchPage {
  return {
    atSource: false,
    generationId,
    newerCursor: result.newerCursor,
    olderCursor: result.olderCursor,
    turns: result.turns,
  };
}

function snapshot(
  page: SearchPage,
  query: string,
  selectedTurnId: string | null,
  phase: ThreadSearchPhase,
): ThreadSearchSnapshot {
  const matches = matchingTurnIds(page.turns, query);
  const selectedIndex = selectedTurnId === null ? -1 : matches.indexOf(selectedTurnId);
  const active = query !== "";
  return {
    canMoveNewer: active && (selectedIndex < matches.length - 1 || page.newerCursor !== null),
    canMoveOlder: active && (selectedIndex > 0 || page.olderCursor !== null),
    matchCount: matches.length,
    matchTurnIds: matches,
    phase,
    query,
    selectedTurnId,
    turns: page.turns,
  };
}

function cursorFor(page: SearchPage, direction: ThreadSearchDirection): string | null {
  return direction === "older" ? page.olderCursor : page.newerCursor;
}

function adjacentMatchId(
  turns: V2TurnView[],
  query: string,
  selectedTurnId: string | null,
  direction: ThreadSearchDirection,
): string | null {
  const matches = matchingTurnIds(turns, query);
  if (matches.length === 0) return null;
  if (selectedTurnId === null) return edge(matches, direction);
  const current = matches.indexOf(selectedTurnId);
  if (direction === "older" && current > 0) return matches[current - 1] ?? null;
  if (direction === "newer" && current >= 0 && current < matches.length - 1) {
    return matches[current + 1] ?? null;
  }
  return null;
}

function edgeMatchId(
  turns: V2TurnView[],
  query: string,
  direction: ThreadSearchDirection,
): string | null {
  return edge(matchingTurnIds(turns, query), direction);
}

function edge(matches: string[], direction: ThreadSearchDirection): string | null {
  return direction === "older" ? (matches.at(-1) ?? null) : (matches[0] ?? null);
}

function newestMatchId(turns: V2TurnView[], query: string): string | null {
  return matchingTurnIds(turns, query).at(-1) ?? null;
}

function matchingTurnIds(turns: V2TurnView[], query: string): string[] {
  if (query === "") return [];
  const needle = query.toLocaleLowerCase();
  const matches: string[] = [];
  for (const turn of turns) {
    if (turnSearchText(turn).toLocaleLowerCase().includes(needle)) matches.push(turn.id);
  }
  return matches;
}

function turnSearchText(turn: V2TurnView): string {
  const text: string[] = [turn.state];
  for (const item of turn.items) appendItemText(text, item);
  for (const lifecycle of turn.lifecycle) appendItemText(text, lifecycle.item);
  return text.join(" ");
}

function appendItemText(text: string[], item: V2Item): void {
  switch (item.kind) {
    case "userMessage":
      for (const block of item.content) appendUserBlockText(text, block);
      return;
    case "assistantText":
      text.push(item.text);
      return;
    case "reasoning":
      text.push(item.summary, ...(item.summaryParts ?? []), ...(item.contentParts ?? []));
      return;
    case "command":
      text.push(item.command, item.cwd, item.status, item.outputPreview);
      return;
    case "fileChange":
      text.push(item.path, item.change, item.status);
      for (const change of item.changes ?? []) {
        text.push(change.path, change.change, change.diff ?? "");
      }
      return;
    case "tool":
      text.push(item.name, item.status, item.summary, item.server ?? "", item.error?.message ?? "");
      return;
    case "plan":
      text.push(item.text ?? "");
      for (const step of item.steps) text.push(step.text, step.status);
      return;
    case "attachment":
      text.push(item.attachment.name, item.attachment.mediaType);
      return;
    case "hookPrompt":
      text.push(...item.fragments);
      return;
    case "collaboration":
      text.push(item.tool, item.status, item.prompt ?? "", item.model ?? "");
      return;
    case "subagentActivity":
      text.push(item.activityKind, ...item.agentPath);
      return;
    case "webSearch":
      text.push(item.query);
      return;
    case "imageView":
      text.push(item.path);
      return;
    case "imageGeneration":
      text.push(item.prompt, item.status);
      return;
    case "reviewMode":
      text.push(item.state, item.review ?? "");
      return;
    case "unsupported":
      text.push(item.sourceKind);
      return;
    case "sleep":
    case "contextCompaction":
      return;
    default:
      unreachableItem(item);
  }
}

function appendUserBlockText(
  text: string[],
  block: Extract<V2Item, { kind: "userMessage" }>["content"][number],
): void {
  if (block.kind === "text") {
    text.push(block.text);
    return;
  }
  if (block.kind === "skill" || block.kind === "mention") {
    text.push(block.name, block.path);
    return;
  }
  text.push("url" in block ? block.url : block.path);
}

function unreachableItem(item: never): never {
  throw new Error(`Unsupported searchable item: ${String(item)}`);
}
