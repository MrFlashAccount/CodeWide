import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import { ObservableResource } from "../../application/resources/resource";
import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { ItemOutputPage } from "./ItemOutputViewer";

const PAGE_LIMIT_BYTES = 65_536;

interface ItemOutputQueries {
  execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult>;
}

interface ItemOutputResourceInput {
  itemId: string;
  owner: QualifiedThread;
  queries: ItemOutputQueries;
  turnId: string;
}

/** Reads bounded pages of one authoritative item output and validates its owner. */
export class ItemOutputResource extends ObservableResource<ItemOutputPage | null> {
  readonly #input: ItemOutputResourceInput;
  #loading: Promise<void> | null = null;
  #subscriberCount = 0;

  constructor(input: ItemOutputResourceInput) {
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
    const operation = this.loadPage(null)
      .then((page) => this.publish({ status: "ready", value: page }))
      .catch((cause: unknown) =>
        this.publish({
          message: failureMessage(cause),
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

  async loadPage(cursor: string | null): Promise<ItemOutputPage> {
    const result = await this.#input.queries.execute(
      this.#input.owner.savedServerId,
      itemOutputQuery(this.#input, cursor),
    );
    return itemOutputPage(result, this.#input, cursor);
  }
}

function itemOutputQuery(input: ItemOutputResourceInput, cursor: string | null): V2Query {
  return {
    cursor,
    itemId: input.itemId,
    kind: "item.output",
    limitBytes: PAGE_LIMIT_BYTES,
    threadId: input.owner.threadId,
    turnId: input.turnId,
  };
}

function itemOutputPage(
  result: V2QueryResult,
  input: ItemOutputResourceInput,
  cursor: string | null,
): ItemOutputPage {
  if (
    result.kind !== "item.output" ||
    result.threadId !== input.owner.threadId ||
    result.turnId !== input.turnId ||
    result.itemId !== input.itemId
  ) {
    throw new Error("Item output query returned the wrong result");
  }
  if (cursor !== null && result.next === cursor)
    throw new Error("Item output query returned a repeated cursor");
  return {
    content: result.content,
    format: result.format,
    next: result.next,
    totalBytes: result.totalBytes,
  };
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Could not open full output";
}
