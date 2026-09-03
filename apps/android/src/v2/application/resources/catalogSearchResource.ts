import type { V2Query, V2QueryResult, V2ThreadSummary } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type { ResourceSnapshot } from "./resource";
import { ObservableResource } from "./resource";
import type { ServerConnectionStatus } from "./serverConnectionStatusesResource";
import { THREAD_CATALOG_PAGE_LIMIT, type ThreadCatalogPartition } from "./threadCatalogResource";

export interface CatalogSearchEntry {
  savedServerId: SavedServerId;
  thread: V2ThreadSummary;
}

export interface CatalogSearchSnapshot {
  active: CatalogSearchEntry[];
  archived: CatalogSearchEntry[];
  canLoadMore: Record<ThreadCatalogPartition, boolean>;
  errors: Record<ThreadCatalogPartition, string | null>;
  loading: Record<ThreadCatalogPartition, boolean>;
  query: string;
}

interface CatalogSearchResourceInput {
  availability?: CatalogSearchAvailability;
  execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult>;
}

interface CatalogSearchAvailability {
  snapshot(): ResourceSnapshot<ReadonlyMap<SavedServerId, ServerConnectionStatus>>;
  subscribe(listener: () => void): () => void;
}

interface SearchPartition {
  complete: Set<SavedServerId>;
  entries: Map<string, CatalogSearchEntry>;
  errors: Map<SavedServerId, string>;
  next: Map<SavedServerId, string | null>;
}

interface SearchState {
  active: SearchPartition;
  archived: SearchPartition;
  generation: number;
  query: string;
  servers: SavedServerId[];
}

interface InFlightSearch {
  generation: number;
  operation: Promise<void>;
}

const PARTITIONS: readonly ThreadCatalogPartition[] = ["active", "archived"];
const SEARCH_CONCURRENCY = 4;

/** Owns bounded, server/index-backed search result pages without materializing the catalog. */
export class CatalogSearchResource extends ObservableResource<CatalogSearchSnapshot> {
  readonly #availability: CatalogSearchAvailability | null;
  readonly #execute: CatalogSearchResourceInput["execute"];
  readonly #inFlight = new Map<ThreadCatalogPartition, InFlightSearch>();
  #connected = new Set<SavedServerId>();
  #generation = 0;
  #state = emptyState(0);
  #subscriberCount = 0;
  #unsubscribeAvailability: (() => void) | null = null;

  constructor(input: CatalogSearchResourceInput) {
    super(emptySnapshot());
    this.#availability = input.availability ?? null;
    this.#execute = input.execute;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.#startAvailability();
    return () => {
      unsubscribe();
      this.#subscriberCount -= 1;
      if (this.#subscriberCount === 0) this.#stopAvailability();
    };
  };

  async search(query: string, servers: readonly SavedServerId[]): Promise<void> {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const generation = ++this.#generation;
    this.#state = {
      active: emptyPartition(),
      archived: emptyPartition(),
      generation,
      query: normalizedQuery,
      servers: [...new Set(servers)],
    };
    this.#inFlight.clear();
    this.#publish();
    if (normalizedQuery === "") return;
    await Promise.all(PARTITIONS.map((partition) => this.loadMore(partition)));
  }

  async loadMore(partition: ThreadCatalogPartition): Promise<void> {
    if (this.#state.query === "") return;
    const current = this.#inFlight.get(partition);
    if (current?.generation === this.#state.generation) return current.operation;
    const generation = this.#state.generation;
    const state = this.#state[partition];
    const servers = this.#state.servers.filter((server) => !state.complete.has(server));
    if (servers.length === 0) return;
    for (const server of servers) state.errors.delete(server);
    const operation = this.#loadServerPages(generation, partition, servers).then(() => {
      const inFlight = this.#inFlight.get(partition);
      if (inFlight?.generation === generation) this.#inFlight.delete(partition);
      this.#publish();
    });
    this.#inFlight.set(partition, { generation, operation });
    this.#publish();
    await operation;
  }

  async #loadServerPages(
    generation: number,
    partition: ThreadCatalogPartition,
    servers: SavedServerId[],
  ): Promise<void> {
    const jobs = [...servers];
    const workerCount = Math.min(SEARCH_CONCURRENCY, jobs.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (generation === this.#state.generation) {
          const server = jobs.shift();
          if (server === undefined) return;
          await this.#loadServerPage(generation, partition, server);
        }
      }),
    );
  }

  async #loadServerPage(
    generation: number,
    partition: ThreadCatalogPartition,
    savedServerId: SavedServerId,
  ): Promise<void> {
    const partitionState = this.#state[partition];
    const requestedCursor = partitionState.next.get(savedServerId) ?? null;
    const result = await settlePage(() =>
      this.#execute(savedServerId, {
        cursor: requestedCursor,
        kind: "catalog.search",
        limit: THREAD_CATALOG_PAGE_LIMIT,
        partition,
        text: this.#state.query,
      }),
    );
    if (generation !== this.#state.generation) return;
    if (!result.ok) {
      partitionState.errors.set(savedServerId, searchFailure(savedServerId, result.cause));
      return;
    }
    const page = result.value;
    if (page.kind !== "catalog.search") {
      partitionState.errors.set(
        savedServerId,
        `Server ${savedServerId} returned the wrong catalog search result`,
      );
      return;
    }
    if (page.threads.some((thread) => thread.archived !== (partition === "archived"))) {
      partitionState.errors.set(
        savedServerId,
        `Server ${savedServerId} returned a thread from the wrong partition`,
      );
      return;
    }
    if (page.nextCursor !== null && page.nextCursor === requestedCursor) {
      partitionState.errors.set(
        savedServerId,
        `Server ${savedServerId} returned a catalog search cursor that did not advance`,
      );
      return;
    }
    for (const thread of page.threads) {
      if (thread.parentId === null) {
        partitionState.entries.set(entryKey(savedServerId, thread.id), {
          savedServerId,
          thread,
        });
      }
    }
    partitionState.next.set(savedServerId, page.nextCursor);
    if (page.nextCursor === null) partitionState.complete.add(savedServerId);
  }

  #publish(): void {
    const value = presentation(this.#state, this.#inFlight);
    const error = value.errors.active ?? value.errors.archived;
    if (error !== null) {
      this.publish({ message: error, status: "error", value });
      return;
    }
    const loading = value.loading.active || value.loading.archived;
    this.publish({ status: loading ? "loading" : "ready", value });
  }

  #startAvailability(): void {
    if (this.#availability === null || this.#unsubscribeAvailability !== null) return;
    this.#connected = connectedServers(this.#availability.snapshot().value);
    this.#unsubscribeAvailability = this.#availability.subscribe(() => {
      this.#availabilityChanged();
    });
  }

  #stopAvailability(): void {
    this.#unsubscribeAvailability?.();
    this.#unsubscribeAvailability = null;
    this.#connected.clear();
  }

  #availabilityChanged(): void {
    if (this.#availability === null) return;
    const connected = connectedServers(this.#availability.snapshot().value);
    const reconnected = this.#state.servers.some(
      (server) => connected.has(server) && !this.#connected.has(server),
    );
    this.#connected = connected;
    if (!reconnected || this.#state.query === "") return;
    this.search(this.#state.query, this.#state.servers).catch(() => undefined);
  }
}

type SettledPage = { ok: true; value: V2QueryResult } | { cause: unknown; ok: false };

function settlePage(operation: () => Promise<V2QueryResult>): Promise<SettledPage> {
  const page = new Promise<V2QueryResult>((resolve) => {
    resolve(operation());
  });
  return page.then(
    (value): SettledPage => ({ ok: true, value }),
    (cause: unknown): SettledPage => ({ cause, ok: false }),
  );
}

function presentation(
  state: SearchState,
  inFlight: Map<ThreadCatalogPartition, InFlightSearch>,
): CatalogSearchSnapshot {
  return {
    active: [...state.active.entries.values()],
    archived: [...state.archived.entries.values()],
    canLoadMore: {
      active: canLoadMore(state, "active"),
      archived: canLoadMore(state, "archived"),
    },
    errors: {
      active: partitionError(state.active),
      archived: partitionError(state.archived),
    },
    loading: {
      active: inFlight.get("active")?.generation === state.generation,
      archived: inFlight.get("archived")?.generation === state.generation,
    },
    query: state.query,
  };
}

function canLoadMore(state: SearchState, partition: ThreadCatalogPartition): boolean {
  return (
    state.query !== "" && state.servers.some((server) => !state[partition].complete.has(server))
  );
}

function partitionError(partition: SearchPartition): string | null {
  const errors = [...partition.errors.values()];
  return errors.length === 0 ? null : errors.join(" · ");
}

function entryKey(savedServerId: SavedServerId, threadId: string): string {
  return `${savedServerId}\n${threadId}`;
}

function searchFailure(savedServerId: SavedServerId, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : "Could not search threads";
  return `Server ${savedServerId}: ${detail}`;
}

function emptyPartition(): SearchPartition {
  return { complete: new Set(), entries: new Map(), errors: new Map(), next: new Map() };
}

function emptyState(generation: number): SearchState {
  return {
    active: emptyPartition(),
    archived: emptyPartition(),
    generation,
    query: "",
    servers: [],
  };
}

function emptySnapshot(): CatalogSearchSnapshot {
  return {
    active: [],
    archived: [],
    canLoadMore: { active: false, archived: false },
    errors: { active: null, archived: null },
    loading: { active: false, archived: false },
    query: "",
  };
}

function connectedServers(
  statuses: ReadonlyMap<SavedServerId, ServerConnectionStatus>,
): Set<SavedServerId> {
  const connected = new Set<SavedServerId>();
  for (const [savedServerId, status] of statuses) {
    if (status.state === "connected") connected.add(savedServerId);
  }
  return connected;
}
