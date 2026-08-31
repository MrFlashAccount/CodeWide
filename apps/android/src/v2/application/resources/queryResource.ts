import type { SyncV2Session, V2Query, V2QueryResult } from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";

/** A live-only query projection that refreshes after matching semantic invalidations. */
export class QueryResource extends ObservableResource<V2QueryResult | null> {
  readonly #session: SyncV2Session;
  readonly #query: V2Query;
  #unsubscribe: (() => void) | null = null;
  #refreshing = false;

  constructor(session: SyncV2Session, query: V2Query) {
    super(null);
    this.#session = session;
    this.#query = query;
  }

  start(): void {
    this.#unsubscribe ??= this.#session.subscribe(() => {
      const state = this.#session.state;
      if (state === "live") this.refresh().catch(() => undefined);
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
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
