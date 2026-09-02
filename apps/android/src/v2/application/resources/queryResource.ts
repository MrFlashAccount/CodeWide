import type {
  SyncV2ConnectionState,
  SyncV2Session,
  V2ProjectionChange,
  V2Query,
  V2QueryResult,
} from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";

/** A live-only query projection that refreshes after matching semantic invalidations. */
export class QueryResource extends ObservableResource<V2QueryResult | null> {
  readonly #session: SyncV2Session;
  readonly #query: V2Query;
  #unsubscribeChanges: (() => void) | null = null;
  #unsubscribeState: (() => void) | null = null;
  #refreshing = false;
  #lastState: SyncV2ConnectionState;

  constructor(session: SyncV2Session, query: V2Query) {
    super(null);
    this.#session = session;
    this.#query = query;
    this.#lastState = session.state;
  }

  start(): void {
    this.#unsubscribeState ??= this.#session.subscribe(() => {
      const state = this.#session.state;
      const becameLive = state === "live" && this.#lastState !== "live";
      this.#lastState = state;
      if (becameLive) this.refresh().catch(() => undefined);
    });
    this.#unsubscribeChanges ??= this.#session.subscribeChange((change) => {
      if (queryMatchesChange(this.#query, change)) this.refresh().catch(() => undefined);
    });
    if (this.#session.state === "live") this.refresh().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    if (this.#refreshing || this.#session.state !== "live") return;
    this.#refreshing = true;
    try {
      this.publish({ status: "ready", value: await this.#session.query(this.#query) });
    } catch {
      this.publish({
        message: "Could not read this server resource",
        status: "error",
        value: this.snapshot().value,
      });
    } finally {
      this.#refreshing = false;
    }
  }

  stop(): void {
    this.#unsubscribeChanges?.();
    this.#unsubscribeState?.();
    this.#unsubscribeChanges = null;
    this.#unsubscribeState = null;
  }
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
  if (query.kind === "thread.resources")
    return change.kind === "resourcesChanged" && change.threadId === query.threadId;
  if (query.kind === "queue.list")
    return (
      change.kind === "queueChanged" &&
      (query.threadId === null || change.threadId === null || change.threadId === query.threadId)
    );
  if (query.kind === "accounts.list") return change.kind === "accountsChanged";
  return false;
}
