import type { SyncSnapshotThread } from "@codewide/sync-client";
import { type ThreadCatalogPage, type ThreadCatalogPageRequest } from "./thread-catalog-loader";

export interface ThreadCatalogWindowPort {
  load(request: ThreadCatalogPageRequest): Promise<ThreadCatalogPage>;
  publish(
    threads: SyncSnapshotThread[],
    archived: boolean,
    prefixIds: ReadonlySet<string>,
    replaceHead: boolean,
  ): Promise<void>;
  close(): void;
}

/** Owns one server/partition's requested prefix, not the entire catalog. */
export class ThreadCatalogWindow {
  readonly #port: ThreadCatalogWindowPort;
  readonly #archived: boolean;
  #cursor: string | null = null;
  #loaded = false;
  #ids = new Set<string>();
  #requested = 0;
  #inFlight: Promise<void> | null = null;
  #refreshRequested = false;
  #closed = false;

  constructor(port: ThreadCatalogWindowPort, archived: boolean) {
    this.#port = port;
    this.#archived = archived;
  }

  ensure(count: number): Promise<void> {
    this.#requested = Math.max(this.#requested, count);
    return this.#run();
  }

  refresh(): Promise<void> {
    if (this.#requested === 0) return Promise.resolve();
    this.#refreshRequested = true;
    return this.#run();
  }

  close(): void {
    this.#closed = true;
    this.#port.close();
  }

  #run(): Promise<void> {
    if (this.#inFlight !== null) return this.#inFlight;
    const operation = this.#drain().finally(() => {
      if (this.#inFlight === operation) this.#inFlight = null;
    });
    this.#inFlight = operation;
    return operation;
  }

  async #drain(): Promise<void> {
    const seenCursors = new Set<string>();
    while (!this.#closed) {
      if (this.#refreshRequested) {
        this.#refreshRequested = false;
        this.#loaded = false;
        this.#cursor = null;
        this.#ids = new Set();
        seenCursors.clear();
      }
      if (
        this.#requested === 0 ||
        (this.#loaded && (this.#cursor === null || this.#ids.size >= this.#requested))
      )
        return;
      const replaceHead = this.#cursor === null;
      const page = await this.#port.load({ archived: this.#archived, cursor: this.#cursor });
      if (this.#closed) return;
      if (this.#refreshRequested) continue;
      if (page.nextCursor !== null && seenCursors.has(page.nextCursor))
        throw new Error("thread/list returned a repeated catalog cursor");
      if (page.nextCursor !== null) seenCursors.add(page.nextCursor);
      // Publication may fail. Keep the prior committed continuation intact
      // until its newly extended prefix is durably accepted by the consumer.
      const ids = new Set(this.#ids);
      for (const row of page.threads) ids.add(row.thread.id);
      await this.#port.publish(page.threads, this.#archived, ids, replaceHead);
      this.#ids = ids;
      this.#loaded = true;
      this.#cursor = page.nextCursor;
    }
  }
}
