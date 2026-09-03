import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import { ObservableResource } from "../../application/resources/resource";
import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { PagedTextPage } from "../../presentation/output/PagedTextViewer";

const PAGE_LIMIT_BYTES = 65_536;

export type ThreadChangeScope = Extract<V2Query, { kind: "thread.changeOutput" }>["scope"];

interface ThreadChangeOutputQueries {
  execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult>;
}

interface ThreadChangeOutputResourceInput {
  owner: QualifiedThread;
  path: string;
  queries: ThreadChangeOutputQueries;
  scope: ThreadChangeScope;
}

/** Reads owner-bound pages for one authoritative change without retaining hidden content. */
export class ThreadChangeOutputResource extends ObservableResource<PagedTextPage | null> {
  readonly #input: ThreadChangeOutputResourceInput;
  #loading: Promise<void> | null = null;
  #subscriberCount = 0;

  constructor(input: ThreadChangeOutputResourceInput) {
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
        this.publish({ message: failureMessage(cause), status: "error", value: null }),
      )
      .finally(() => {
        this.#loading = null;
      });
    this.#loading = operation;
    await operation;
  }

  async loadPage(cursor: string | null): Promise<PagedTextPage> {
    const result = await this.#input.queries.execute(
      this.#input.owner.savedServerId,
      changeOutputQuery(this.#input, cursor),
    );
    return changeOutputPage(result, this.#input, cursor);
  }
}

function changeOutputQuery(input: ThreadChangeOutputResourceInput, cursor: string | null): V2Query {
  return {
    cursor,
    kind: "thread.changeOutput",
    limitBytes: PAGE_LIMIT_BYTES,
    path: input.path,
    scope: input.scope,
    threadId: input.owner.threadId,
  };
}

function changeOutputPage(
  result: V2QueryResult,
  input: ThreadChangeOutputResourceInput,
  cursor: string | null,
): PagedTextPage {
  if (
    result.kind !== "thread.changeOutput" ||
    result.threadId !== input.owner.threadId ||
    result.path !== input.path ||
    result.scope !== input.scope
  ) {
    throw new Error("Change output query returned the wrong result");
  }
  if (cursor !== null && result.next === cursor)
    throw new Error("Change output query returned a repeated cursor");
  return {
    content: result.content,
    format: "text",
    next: result.next,
    totalBytes: result.totalBytes,
  };
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Could not open full diff";
}
