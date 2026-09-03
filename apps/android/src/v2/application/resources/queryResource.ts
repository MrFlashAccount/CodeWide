import type {
  SyncV2ConnectionState,
  SyncV2Session,
  V2Error,
  V2ProjectionChange,
  V2Query,
  V2QueryResult,
} from "@codewide/sync-client/v2";
import { SyncV2RequestError } from "@codewide/sync-client/v2";

import { correlateQueryResult, queryResultHasKind, type QueryResultFor } from "./queryCorrelation";
import { readAllThreadResources } from "./threadResourcesPages";

export interface QueryResourceFailure {
  cause: Error;
  error: V2Error | null;
  message: string;
}

export type QueryResourceSnapshot<Q extends V2Query = V2Query> = (
  | { authority: "none"; status: "loading"; value: null }
  | {
      authority: "none";
      failure: QueryResourceFailure;
      message: string;
      status: "error";
      value: null;
    }
  | { authority: "retained"; status: "loading"; value: QueryResultFor<Q> }
  | {
      authority: "retained";
      failure: QueryResourceFailure;
      message: string;
      status: "error";
      value: QueryResultFor<Q>;
    }
  | { authority: "live"; status: "ready"; value: QueryResultFor<Q> }
) & { operation?: "loadMore" };

export interface QueryResourceHandle {
  actionable(): boolean;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
  snapshot(): QueryResourceSnapshot;
  stop(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A reference-counted live query. Preserved values are readable after authority
 * changes, but only a successful query in the current live generation is actionable.
 */
export class QueryResource<Q extends V2Query = V2Query> {
  readonly #listeners = new Set<() => void>();
  readonly #query: Q;
  readonly #session: SyncV2Session;
  #activeGeneration = 0;
  #dirty = false;
  #lastState: SyncV2ConnectionState;
  #loadMorePromise: Promise<void> | null = null;
  #loadMorePromiseGeneration: number | null = null;
  #loadMorePromiseVersion: number | null = null;
  readonly #queueVisitedCursors = new Set<string | null>();
  #refreshPromise: Promise<void> | null = null;
  #refreshPromiseGeneration: number | null = null;
  #requestVersion = 0;
  #snapshot: QueryResourceSnapshot<Q> = { authority: "none", status: "loading", value: null };
  #subscriberCount = 0;
  #unsubscribeChanges: (() => void) | null = null;
  #unsubscribeState: (() => void) | null = null;

  constructor(session: SyncV2Session, query: Q) {
    this.#session = session;
    this.#query = query;
    this.#lastState = session.state;
  }

  snapshot = (): QueryResourceSnapshot<Q> => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    const subscription = (): void => listener();
    this.#listeners.add(subscription);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.#activate();
    return () => {
      if (!this.#listeners.delete(subscription)) return;
      this.#subscriberCount -= 1;
      if (this.#subscriberCount === 0) this.#deactivate();
    };
  };

  actionable(): boolean {
    return this.#snapshot.authority === "live";
  }

  async loadMore(): Promise<void> {
    if (this.#query.kind !== "queue.list") return;
    const value = this.#snapshot.value;
    if (value === null || !queryResultHasKind(value, "queue.list") || value.nextCursor === null) {
      return;
    }
    const retryingPageFailure =
      this.#snapshot.operation === "loadMore" && this.#snapshot.status === "error";
    if (
      this.#session.state !== "live" ||
      (this.#snapshot.authority !== "live" && !retryingPageFailure)
    ) {
      this.#markRetained();
      return;
    }
    const generation = this.#activeGeneration;
    if (
      this.#loadMorePromise !== null &&
      this.#loadMorePromiseGeneration === generation &&
      this.#loadMorePromiseVersion === this.#requestVersion
    ) {
      await this.#loadMorePromise;
      return;
    }
    const version = this.#requestVersion + 1;
    this.#requestVersion = version;
    const cursor = value.nextCursor;
    this.#publish({ authority: "retained", operation: "loadMore", status: "loading", value });
    const operation = this.#loadQueuePage(value, cursor, generation, version);
    this.#loadMorePromise = operation;
    this.#loadMorePromiseGeneration = generation;
    this.#loadMorePromiseVersion = version;
    try {
      await operation;
    } finally {
      if (this.#loadMorePromise === operation) {
        this.#loadMorePromise = null;
        this.#loadMorePromiseGeneration = null;
        this.#loadMorePromiseVersion = null;
      }
    }
  }

  async refresh(): Promise<void> {
    if (this.#session.state !== "live") {
      this.#markRetained();
      return;
    }
    const generation = this.#activeGeneration;
    if (this.#refreshPromise !== null && this.#refreshPromiseGeneration === generation) {
      this.#dirty = true;
      await this.#refreshPromise;
      return;
    }
    this.#requestVersion += 1;
    this.#markRefreshing();
    const refreshPromise = this.#refreshUntilClean(generation);
    this.#refreshPromise = refreshPromise;
    this.#refreshPromiseGeneration = generation;
    try {
      await refreshPromise;
    } finally {
      if (this.#refreshPromise === refreshPromise) {
        this.#refreshPromise = null;
        this.#refreshPromiseGeneration = null;
      }
    }
  }

  stop(): void {
    this.#subscriberCount = 0;
    this.#listeners.clear();
    this.#deactivate();
  }

  #activate(): void {
    this.#activeGeneration += 1;
    this.#lastState = this.#session.state;
    this.#unsubscribeState = this.#session.subscribe(this.#stateChanged);
    this.#unsubscribeChanges = this.#session.subscribeChange(this.#projectionChanged);
    if (this.#session.state === "live") this.refresh().catch(() => undefined);
    else this.#markRetained();
  }

  #deactivate(): void {
    this.#activeGeneration += 1;
    this.#dirty = false;
    this.#unsubscribeChanges?.();
    this.#unsubscribeState?.();
    this.#unsubscribeChanges = null;
    this.#unsubscribeState = null;
  }

  readonly #projectionChanged = (change: V2ProjectionChange): void => {
    if (queryMatchesChange(this.#query, change)) this.refresh().catch(() => undefined);
  };

  readonly #stateChanged = (): void => {
    const state = this.#session.state;
    const becameLive = state === "live" && this.#lastState !== "live";
    this.#lastState = state;
    if (becameLive) {
      this.#activeGeneration += 1;
      this.#markRefreshing();
      this.refresh().catch(() => undefined);
      return;
    }
    if (state !== "live") {
      this.#activeGeneration += 1;
      this.#markRetained();
    }
  };

  async #refreshUntilClean(generation: number): Promise<void> {
    do {
      this.#dirty = false;
      try {
        const value = await this.#executeQuery();
        if (generation !== this.#activeGeneration || this.#session.state !== "live") return;
        if (value.kind === "queue.list" && this.#query.kind === "queue.list") {
          this.#queueVisitedCursors.clear();
          this.#queueVisitedCursors.add(this.#query.cursor);
        }
        this.#publish({ authority: "live", status: "ready", value });
      } catch (cause: unknown) {
        if (generation !== this.#activeGeneration) return;
        const value = this.#snapshot.value;
        const failure = queryFailure(cause, value === null);
        this.#publish(
          value === null
            ? {
                authority: "none",
                failure,
                message: failure.message,
                status: "error",
                value: null,
              }
            : {
                authority: "retained",
                failure,
                message: failure.message,
                status: "error",
                value,
              },
        );
      }
    } while (
      this.#dirty &&
      generation === this.#activeGeneration &&
      this.#session.state === "live"
    );
  }

  async #executeQuery(): Promise<QueryResultFor<Q>> {
    if (this.#query.kind === "thread.agents") {
      return correlateQueryResult(this.#query, await this.#executeThreadAgentsQuery());
    }
    if (this.#query.kind === "thread.resources") {
      return correlateQueryResult(
        this.#query,
        await readAllThreadResources(this.#session, this.#query),
      );
    }
    if (this.#query.kind !== "queue.list") {
      return correlateQueryResult(this.#query, await this.#session.query(this.#query));
    }
    return correlateQueryResult(this.#query, await this.#readQueuePage(this.#query.cursor));
  }

  async #loadQueuePage(
    current: Extract<V2QueryResult, { kind: "queue.list" }>,
    cursor: string,
    generation: number,
    version: number,
  ): Promise<void> {
    try {
      const page = await this.#readQueuePage(cursor);
      if (
        generation !== this.#activeGeneration ||
        version !== this.#requestVersion ||
        this.#session.state !== "live"
      ) {
        return;
      }
      if (page.revision !== current.revision) {
        throw new Error("Queue changed while its next page was being read");
      }
      if (page.nextCursor !== null && this.#queueVisitedCursors.has(page.nextCursor)) {
        throw new Error("Queue query returned a repeated cursor");
      }
      assertQueuePageDoesNotOverlap(current, page);
      this.#queueVisitedCursors.add(cursor);
      // WHY: published query snapshots remain valid for existing consumers, so pagination must
      // publish a new item collection instead of mutating the array owned by the prior snapshot.
      const items = current.items.slice();
      items.push(...page.items);
      const value = correlateQueryResult(this.#query, {
        items,
        kind: "queue.list",
        nextCursor: page.nextCursor,
        revision: page.revision,
      });
      this.#publish({ authority: "live", status: "ready", value });
    } catch (cause: unknown) {
      if (generation !== this.#activeGeneration || version !== this.#requestVersion) return;
      const failure = queryFailure(cause, false);
      const value = correlateQueryResult(this.#query, current);
      this.#publish({
        authority: "retained",
        failure,
        message: failure.message,
        operation: "loadMore",
        status: "error",
        value,
      });
    }
  }

  async #readQueuePage(
    cursor: string | null,
  ): Promise<Extract<V2QueryResult, { kind: "queue.list" }>> {
    if (this.#query.kind !== "queue.list") throw new Error("Expected queue query");
    const query: Extract<V2Query, { kind: "queue.list" }> = {
      cursor,
      kind: "queue.list",
      limit: this.#query.limit,
      threadId: this.#query.threadId,
    };
    const result = correlateQueryResult(query, await this.#session.query(query));
    if (result.nextCursor !== null && result.nextCursor === cursor) {
      throw new Error("Queue query returned a repeated cursor");
    }
    return result;
  }

  async #executeThreadAgentsQuery(): Promise<V2QueryResult> {
    if (this.#query.kind !== "thread.agents") throw new Error("Expected thread agents query");
    const agents: Extract<V2QueryResult, { kind: "thread.agents" }>["agents"] = [];
    const visitedCursors = new Set<string | null>();
    let cursor = this.#query.cursor;
    for (let page = 0; page < THREAD_AGENTS_PAGE_LIMIT; page += 1) {
      if (visitedCursors.has(cursor)) {
        throw new Error("Thread agents query returned a repeated cursor");
      }
      visitedCursors.add(cursor);
      const query: Extract<V2Query, { kind: "thread.agents" }> = {
        cursor,
        kind: "thread.agents",
        limit: THREAD_AGENTS_PAGE_SIZE,
        threadId: this.#query.threadId,
      };
      const result = correlateQueryResult(query, await this.#session.query(query));
      if (result.threadId !== this.#query.threadId) {
        throw new Error("Unexpected thread agents query response");
      }
      agents.push(...result.agents);
      cursor = result.next;
      if (cursor === null) break;
    }
    return {
      agents,
      kind: "thread.agents",
      next: cursor,
      threadId: this.#query.threadId,
    };
  }

  #markRefreshing(): void {
    const value = this.#snapshot.value;
    this.#publish(
      value === null
        ? { authority: "none", status: "loading", value: null }
        : { authority: "retained", status: "loading", value },
    );
  }

  #markRetained(): void {
    const value = this.#snapshot.value;
    this.#publish(
      value === null
        ? { authority: "none", status: "loading", value: null }
        : { authority: "retained", status: "loading", value },
    );
  }

  #publish(snapshot: QueryResourceSnapshot<Q>): void {
    if (sameSnapshot(this.#snapshot, snapshot)) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

const THREAD_AGENTS_PAGE_SIZE = 100;
const THREAD_AGENTS_PAGE_LIMIT = 10;

function sameSnapshot<Q extends V2Query>(
  left: QueryResourceSnapshot<Q>,
  right: QueryResourceSnapshot<Q>,
): boolean {
  return (
    left.authority === right.authority &&
    left.status === right.status &&
    left.value === right.value &&
    left.operation === right.operation &&
    (left.status !== "error" ||
      right.status !== "error" ||
      (left.message === right.message && left.failure === right.failure))
  );
}

function assertQueuePageDoesNotOverlap(
  current: Extract<V2QueryResult, { kind: "queue.list" }>,
  page: Extract<V2QueryResult, { kind: "queue.list" }>,
): void {
  const itemIds = new Set(current.items.map(queueItemId));
  if (page.items.some((item) => itemIds.has(item.id))) {
    throw new Error("Queue query returned an overlapping page");
  }
}

function queueItemId(
  item: Extract<V2QueryResult, { kind: "queue.list" }>["items"][number],
): string {
  return item.id;
}

function queryFailure(cause: unknown, initial: boolean): QueryResourceFailure {
  if (cause instanceof SyncV2RequestError) {
    return { cause, error: cause.detail, message: cause.detail.message };
  }
  if (cause instanceof Error) {
    return {
      cause,
      error: null,
      message:
        cause.message.trim() === ""
          ? initial
            ? "Could not read this server resource"
            : "Could not refresh this server resource"
          : cause.message,
    };
  }
  const message = initial
    ? "Could not read this server resource"
    : "Could not refresh this server resource";
  return { cause: new Error(message, { cause }), error: null, message };
}

function queryMatchesChange(query: V2Query, change: V2ProjectionChange): boolean {
  if (query.kind === "catalog.page")
    return change.kind === "threadUpserted" || change.kind === "threadRemoved";
  if (query.kind === "history.page")
    return (
      (change.kind === "turnUpserted" && change.turn.threadId === query.threadId) ||
      (change.kind === "currentThreadReplaced" && change.currentThread.thread.id === query.threadId)
    );
  if (query.kind === "turn.items")
    return (
      change.kind === "turnUpserted" &&
      change.turn.threadId === query.threadId &&
      change.turn.id === query.turnId
    );
  if (query.kind === "thread.resources" || query.kind === "thread.change")
    return change.kind === "resourcesChanged" && change.threadId === query.threadId;
  if (query.kind === "queue.list")
    return (
      change.kind === "queueChanged" &&
      (query.threadId === null || change.threadId === null || change.threadId === query.threadId)
    );
  if (query.kind === "thread.goal")
    return change.kind === "threadGoalChanged" && change.threadId === query.threadId;
  if (query.kind === "thread.agents")
    return (
      change.kind === "agentsChanged" &&
      (change.threadId === null || change.threadId === query.threadId)
    );
  if (query.kind === "skills.list")
    return (
      change.kind === "skillsChanged" &&
      (change.workspace === null || change.workspace === query.workspace)
    );
  if (query.kind === "accounts.list") return change.kind === "accountsChanged";
  return false;
}
