import type {
  V2AggregateProjection,
  V2CatalogAnchor,
  V2Projection,
  V2Query,
  V2QueryResult,
  V2ThreadSummary,
} from "@codewide/sync-client/v2";

import { savedServerId, type SavedServerId } from "../../domain/ids";
import type { ResourceSnapshot } from "./resource";
import { ObservableResource } from "./resource";
import { THREAD_CATALOG_PAGE_LIMIT, type ThreadCatalogPartition } from "./threadCatalogResource";

export interface AggregateThreadCatalogEntry {
  coverage: "current" | "outsideCurrentScope";
  savedServerId: SavedServerId;
  thread: V2ThreadSummary;
}

export interface AggregateThreadCatalogSnapshot {
  active: AggregateThreadCatalogEntry[];
  archived: AggregateThreadCatalogEntry[];
  canLoadMore: Record<ThreadCatalogPartition, boolean>;
  errors: Record<ThreadCatalogPartition, string | null>;
  loading: Record<ThreadCatalogPartition, boolean>;
}

interface AggregateProjectionSource {
  snapshot(): ResourceSnapshot<V2AggregateProjection>;
  subscribe(listener: () => void): () => void;
}

interface CatalogQueryAvailabilitySource {
  snapshot(): ResourceSnapshot<ReadonlyMap<SavedServerId, { state: string }>>;
  subscribe(listener: () => void): () => void;
}

interface AggregateThreadCatalogResourceInput {
  availability: CatalogQueryAvailabilitySource;
  execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult>;
  source: AggregateProjectionSource;
}

interface ServerCatalog {
  active: AggregateThreadCatalogEntry[];
  archived: AggregateThreadCatalogEntry[];
  errors: Record<ThreadCatalogPartition, string | null>;
  generationId: string;
  next: Record<ThreadCatalogPartition, V2CatalogAnchor | null>;
  paged: Record<ThreadCatalogPartition, boolean>;
  sourceIds: Set<string>;
}

/** Owns independent catalog cursors for every saved server shown in All Servers. */
export class AggregateThreadCatalogResource extends ObservableResource<AggregateThreadCatalogSnapshot> {
  readonly #availability: CatalogQueryAvailabilitySource;
  readonly #execute: AggregateThreadCatalogResourceInput["execute"];
  readonly #source: AggregateProjectionSource;
  readonly #inFlight = new Map<ThreadCatalogPartition, Promise<void>>();
  readonly #servers = new Map<SavedServerId, ServerCatalog>();
  #sourceError: string | null = null;
  #sourceLoading = true;
  #subscriberCount = 0;
  #unsubscribeAvailability: (() => void) | null = null;
  #unsubscribeSource: (() => void) | null = null;

  constructor(input: AggregateThreadCatalogResourceInput) {
    super(emptySnapshot());
    this.#availability = input.availability;
    this.#execute = input.execute;
    this.#source = input.source;
    this.#synchronize();
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) {
      this.#unsubscribeSource = this.#source.subscribe(() => this.#synchronize());
      this.#unsubscribeAvailability = this.#availability.subscribe(() => this.#publish());
      this.#synchronize();
    }
    return () => {
      unsubscribe();
      this.#subscriberCount -= 1;
      if (this.#subscriberCount !== 0) return;
      this.#unsubscribeSource?.();
      this.#unsubscribeAvailability?.();
      this.#unsubscribeSource = null;
      this.#unsubscribeAvailability = null;
    };
  };

  async loadMore(partition: ThreadCatalogPartition): Promise<void> {
    const current = this.#inFlight.get(partition);
    if (current !== undefined) return current;
    const requests = [...this.#servers.entries()].filter(
      (entry) => entry[1].next[partition] !== null && this.#canQuery(entry[0]),
    );
    if (requests.length === 0) return;
    for (const [, catalog] of requests) catalog.errors[partition] = null;
    this.#publish();
    const operation = Promise.all(
      requests.map(async (entry) => {
        const [savedServerId, catalog] = entry;
        const before = catalog.next[partition];
        if (before === null) return;
        const generationId = catalog.generationId;
        try {
          const result = await this.#execute(savedServerId, {
            before,
            kind: "catalog.page",
            limit: THREAD_CATALOG_PAGE_LIMIT,
            partition,
          });
          const currentCatalog = this.#servers.get(savedServerId);
          if (currentCatalog?.generationId !== generationId) return;
          acceptPage(currentCatalog, savedServerId, partition, before, result);
        } catch (cause: unknown) {
          const currentCatalog = this.#servers.get(savedServerId);
          if (currentCatalog?.generationId !== generationId) return;
          currentCatalog.errors[partition] = safeErrorMessage(cause);
        }
      }),
    )
      .then(() => undefined)
      .finally(() => {
        this.#inFlight.delete(partition);
        this.#publish();
      });
    this.#inFlight.set(partition, operation);
    this.#publish();
    await operation;
  }

  #synchronize(): void {
    const snapshot = this.#source.snapshot();
    this.#sourceError = snapshot.status === "error" ? snapshot.message : null;
    this.#sourceLoading = snapshot.status === "loading";
    const incomingIds = new Set<SavedServerId>();
    for (const server of snapshot.value.servers) {
      const id = savedServerId(server.savedServerId);
      incomingIds.add(id);
      const incoming = serverCatalog(id, server.projection);
      const resident = this.#servers.get(id);
      if (resident === undefined || resident.generationId !== incoming.generationId) {
        this.#servers.set(id, incoming);
        continue;
      }
      mergeServerCatalog(resident, incoming);
    }
    for (const id of this.#servers.keys()) {
      if (!incomingIds.has(id)) this.#servers.delete(id);
    }
    this.#publish();
  }

  #publish(): void {
    const value = presentation(
      this.#servers,
      this.#inFlight,
      this.#sourceError,
      this.#availability.snapshot().value,
    );
    const error = value.errors.active ?? value.errors.archived;
    if (error !== null) {
      this.publish({ message: error, status: "error", value });
      return;
    }
    this.publish({ status: this.#sourceLoading ? "loading" : "ready", value });
  }

  #canQuery(savedServerId: SavedServerId): boolean {
    return this.#availability.snapshot().value.get(savedServerId)?.state === "connected";
  }
}

function serverCatalog(savedServerId: SavedServerId, projection: V2Projection): ServerCatalog {
  const active: AggregateThreadCatalogEntry[] = [];
  const archived: AggregateThreadCatalogEntry[] = [];
  const currentActive: V2ThreadSummary[] = [];
  const currentArchived: V2ThreadSummary[] = [];
  const sourceIds = new Set<string>();
  for (const entry of projection.catalog) {
    if (entry.thread.parentId !== null) continue;
    const row = { coverage: entry.coverage, savedServerId, thread: entry.thread };
    (entry.thread.archived ? archived : active).push(row);
    sourceIds.add(entry.thread.id);
    if (entry.coverage === "current") {
      (entry.thread.archived ? currentArchived : currentActive).push(entry.thread);
    }
  }
  const selected = projection.currentThread?.thread;
  if (selected !== undefined && selected.parentId === null) {
    const target = selected.archived ? archived : active;
    const index = target.findIndex((entry) => entry.thread.id === selected.id);
    const current = { coverage: "current" as const, savedServerId, thread: selected };
    if (index === -1) target.unshift(current);
    else target[index] = current;
    sourceIds.add(selected.id);
  }
  return {
    active,
    archived,
    errors: { active: null, archived: null },
    generationId: projection.generationId,
    next: {
      active: projection.scope.active.complete ? null : pageAnchor(currentActive.at(-1)),
      archived: projection.scope.archived.complete ? null : pageAnchor(currentArchived.at(-1)),
    },
    paged: { active: false, archived: false },
    sourceIds,
  };
}

function mergeServerCatalog(resident: ServerCatalog, incoming: ServerCatalog): void {
  resident.active = mergePartition(
    resident.active,
    resident.sourceIds,
    incoming.sourceIds,
    incoming.active,
  );
  resident.archived = mergePartition(
    resident.archived,
    resident.sourceIds,
    incoming.sourceIds,
    incoming.archived,
  );
  for (const partition of ["active", "archived"] as const) {
    if (!resident.paged[partition]) resident.next[partition] = incoming.next[partition];
  }
  resident.sourceIds = incoming.sourceIds;
}

function mergePartition(
  resident: AggregateThreadCatalogEntry[],
  previousSourceIds: Set<string>,
  incomingSourceIds: Set<string>,
  incoming: AggregateThreadCatalogEntry[],
): AggregateThreadCatalogEntry[] {
  const incomingById = new Map(incoming.map((entry) => [entry.thread.id, entry]));
  const next: AggregateThreadCatalogEntry[] = [];
  for (const entry of resident) {
    const id = entry.thread.id;
    const replacement = incomingById.get(id);
    if (replacement !== undefined) {
      next.push(replacement);
      incomingById.delete(id);
      continue;
    }
    if (previousSourceIds.has(id) || incomingSourceIds.has(id)) continue;
    next.push(entry);
  }
  return [...incomingById.values(), ...next];
}

function acceptPage(
  catalog: ServerCatalog,
  savedServerId: SavedServerId,
  partition: ThreadCatalogPartition,
  before: V2CatalogAnchor,
  result: V2QueryResult,
): void {
  if (result.kind !== "catalog.page") throw new Error("Server returned the wrong catalog result");
  if (result.threads.some((thread) => thread.archived !== (partition === "archived"))) {
    throw new Error("Server returned a thread from the wrong catalog partition");
  }
  if (sameAnchor(before, result.next)) throw new Error("Server catalog page did not advance");
  const incoming = result.threads
    .filter((thread) => thread.parentId === null)
    .map((thread) => ({ coverage: "current" as const, savedServerId, thread }));
  catalog[partition] = mergePage(catalog[partition], incoming);
  catalog.next[partition] = result.next;
  catalog.paged[partition] = true;
}

function mergePage(
  resident: AggregateThreadCatalogEntry[],
  incoming: AggregateThreadCatalogEntry[],
): AggregateThreadCatalogEntry[] {
  const byId = new Map(resident.map((entry) => [entry.thread.id, entry]));
  for (const entry of incoming) byId.set(entry.thread.id, entry);
  return [...byId.values()];
}

function pageAnchor(thread: V2ThreadSummary | undefined): V2CatalogAnchor | null {
  if (thread === undefined) return null;
  return {
    lastActivityAt: thread.lastActivityAt,
    threadId: thread.id,
    updatedAt: thread.updatedAt,
  };
}

function sameAnchor(left: V2CatalogAnchor, right: V2CatalogAnchor | null): boolean {
  return (
    right !== null &&
    left.lastActivityAt === right.lastActivityAt &&
    left.threadId === right.threadId &&
    left.updatedAt === right.updatedAt
  );
}

function presentation(
  servers: ReadonlyMap<SavedServerId, ServerCatalog>,
  inFlight: ReadonlyMap<ThreadCatalogPartition, Promise<void>>,
  sourceError: string | null,
  availability: ReadonlyMap<SavedServerId, { state: string }>,
): AggregateThreadCatalogSnapshot {
  const active: AggregateThreadCatalogEntry[] = [];
  const archived: AggregateThreadCatalogEntry[] = [];
  let activeMore = false;
  let archivedMore = false;
  const activeErrors: string[] = [];
  const archivedErrors: string[] = [];
  for (const [savedServerId, catalog] of servers) {
    active.push(...catalog.active);
    archived.push(...catalog.archived);
    const available = availability.get(savedServerId)?.state === "connected";
    activeMore ||= available && catalog.next.active !== null;
    archivedMore ||= available && catalog.next.archived !== null;
    if (catalog.errors.active !== null) activeErrors.push(catalog.errors.active);
    if (catalog.errors.archived !== null) archivedErrors.push(catalog.errors.archived);
  }
  return {
    active,
    archived,
    canLoadMore: { active: activeMore, archived: archivedMore },
    errors: {
      active: sourceError ?? firstError(activeErrors),
      archived: sourceError ?? firstError(archivedErrors),
    },
    loading: { active: inFlight.has("active"), archived: inFlight.has("archived") },
  };
}

function emptySnapshot(): AggregateThreadCatalogSnapshot {
  return {
    active: [],
    archived: [],
    canLoadMore: { active: false, archived: false },
    errors: { active: null, archived: null },
    loading: { active: false, archived: false },
  };
}

function firstError(errors: string[]): string | null {
  return errors[0] ?? null;
}

function safeErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Could not load more threads";
  const message = cause.message.trim();
  return message === "" ? "Could not load more threads" : message.slice(0, 512);
}
