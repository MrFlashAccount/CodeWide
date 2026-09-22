import type { SyncSnapshotThread } from "@codewide/sync-client";
import type { ThreadCatalogPage, ThreadCatalogPageRequest } from "./thread-catalog-loader";

export interface ThreadCatalogWindowPort {
  close: () => void;
  load: (request: ThreadCatalogPageRequest) => Promise<ThreadCatalogPage>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  publish: (
    threads: SyncSnapshotThread[],
    archived: boolean,
    prefixIds: ReadonlySet<string>,
    replaceHead: boolean,
  ) => Promise<void>;
}

/** Owns one server/partition's requested prefix, not the entire catalog. */
export class ThreadCatalogWindow {
  readonly #port: ThreadCatalogWindowPort;
  readonly #archived: boolean;
  #cursor: string | null = null;
  #loaded = false;
  #ids = new Set<string>();
  #requested = 0;
  #inFlight: Promise<boolean> | null = null;
  #refreshRequested = false;
  #closed = false;

  constructor(port: ThreadCatalogWindowPort, archived: boolean) {
    this.#port = port;
    this.#archived = archived;
  }

  async ensure(count: number): Promise<boolean> {
    this.#requested = Math.max(this.#requested, count);
    return this.#run();
  }

  async refresh(): Promise<void> {
    if (this.#requested === 0) {
      return;
    }
    this.#refreshRequested = true;
    // A refresh waits for pagination, not the other way around. In particular,
    // the resource awaiting ensure() must settle even if live events continue
    // requesting subsequent catalog reads.
    if (this.#inFlight !== null) {
      await this.#inFlight;
    }
    await this.#run();
  }

  close(): void {
    this.#closed = true;
    this.#port.close();
  }

  async #run(): Promise<boolean> {
    if (this.#inFlight !== null) {
      return this.#inFlight;
    }
    const operation = this.#drain().finally(() => {
      if (this.#inFlight === operation) {
        this.#inFlight = null;
      }
    });
    this.#inFlight = operation;
    return operation;
  }

  async #drain(): Promise<boolean> {
    const seenCursors = new Set<string>();
    if (this.#refreshRequested) {
      this.#refreshRequested = false;
      this.#loaded = false;
      this.#cursor = null;
      this.#ids = new Set();
    }
    while (!this.#closed) {
      // Finish the requested prefix before restarting it. Catalog read leases
      // protect live row changes during publication; discarding in-flight pages
      // instead lets continuous activity starve the user's continuation.
      if (
        this.#requested === 0 ||
        (this.#loaded && (this.#cursor === null || this.#ids.size >= this.#requested))
      ) {
        return this.#cursor !== null;
      }
      const replaceHead = this.#cursor === null;
      const page = await this.#port.load({ archived: this.#archived, cursor: this.#cursor });
      // WHY: close() may run while the awaited catalog page is loading; TypeScript retains the loop-entry state.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (this.#closed) {
        return false;
      }
      if (page.nextCursor !== null && seenCursors.has(page.nextCursor)) {
        throw new Error("thread/list returned a repeated catalog cursor");
      }
      if (page.nextCursor !== null) {
        seenCursors.add(page.nextCursor);
      }
      // Publication may fail. Keep the prior committed continuation intact
      // until its newly extended prefix is durably accepted by the consumer.
      const ids = new Set(this.#ids);
      for (const row of page.threads) {
        ids.add(row.thread.id);
      }
      await this.#port.publish(page.threads, this.#archived, ids, replaceHead);
      this.#ids = ids;
      this.#loaded = true;
      this.#cursor = page.nextCursor;
    }
    return false;
  }
}
