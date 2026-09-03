import type { V2Item, V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import { ObservableResource } from "../../application/resources/resource";
import type { SavedServerId } from "../../domain/ids";

/** @testOnly Defines the injectable query port used by paginated review regressions. */
export interface ResponseReviewQueries {
  execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult>;
}

interface ResponseReviewResourceInput {
  itemId: string;
  queries: ResponseReviewQueries;
  savedServerId: SavedServerId;
  threadId: string;
  turnId: string;
}

const PAGE_LIMIT = 100;

/** Reads authoritative turn-item pages until the exact response item is found. */
export class ResponseReviewResource extends ObservableResource<string | null> {
  readonly #input: ResponseReviewResourceInput;
  #loading: Promise<void> | null = null;
  #subscriberCount = 0;

  constructor(input: ResponseReviewResourceInput) {
    super(null);
    this.#input = input;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.refresh().catch(() => undefined);
    return () => {
      unsubscribe();
      this.#subscriberCount -= 1;
    };
  };

  async refresh(): Promise<void> {
    if (this.#loading !== null) return this.#loading;
    const operation = this.#read()
      .then((response) => this.publish({ status: "ready", value: response }))
      .catch((cause: unknown) =>
        this.publish({
          message: cause instanceof Error ? cause.message : "Could not open response review",
          status: "error",
          value: null,
        }),
      )
      .finally(() => {
        this.#loading = null;
      });
    this.#loading = operation;
    await operation;
  }

  async #read(): Promise<string> {
    let cursor: string | null = null;
    const seenCursors = new Set<string | null>();
    do {
      if (seenCursors.has(cursor)) {
        throw new Error("The server returned a cyclic response-review cursor");
      }
      seenCursors.add(cursor);
      const result = await this.#input.queries.execute(
        this.#input.savedServerId,
        turnItemsQuery(this.#input, cursor),
      );
      const response = responseText(result, this.#input);
      if (response !== null) return response;
      if (result.kind !== "turn.items")
        throw new Error("The server returned an invalid response-review page");
      cursor = result.next;
    } while (cursor !== null);
    throw new Error("The reviewed response is no longer available");
  }
}

function turnItemsQuery(input: ResponseReviewResourceInput, cursor: string | null): V2Query {
  return {
    cursor,
    kind: "turn.items",
    limit: PAGE_LIMIT,
    threadId: input.threadId,
    turnId: input.turnId,
  };
}

function responseText(result: V2QueryResult, input: ResponseReviewResourceInput): string | null {
  if (
    result.kind !== "turn.items" ||
    result.threadId !== input.threadId ||
    result.turnId !== input.turnId
  )
    throw new Error("The server returned the wrong turn while opening response review");
  const item: V2Item | undefined = result.items.find((candidate) => candidate.id === input.itemId);
  if (item === undefined) return null;
  if (item.kind !== "assistantText") throw new Error("The selected item is not an agent response");
  return item.text;
}
