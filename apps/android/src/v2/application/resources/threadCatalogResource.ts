import type {
  SyncV2SessionSnapshot,
  V2CatalogAnchor,
  V2ProjectionChange,
  V2Query,
  V2QueryResult,
  V2ThreadSummary,
} from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";

export const THREAD_CATALOG_PAGE_LIMIT = 40;

export type ThreadCatalogPartition = "active" | "archived";

export interface ThreadCatalogSnapshot {
  active: V2ThreadSummary[];
  archived: V2ThreadSummary[];
  canLoadMore: Record<ThreadCatalogPartition, boolean>;
  errors: Record<ThreadCatalogPartition, string | null>;
  loading: Record<ThreadCatalogPartition, boolean>;
}

interface ProjectionSnapshot {
  value: SyncV2SessionSnapshot;
}

interface ThreadCatalogProjectionSource {
  snapshot(): ProjectionSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeChange(listener: (change: V2ProjectionChange) => void): () => void;
}

interface ThreadCatalogResourceInput {
  execute(query: V2Query): Promise<V2QueryResult>;
  source: ThreadCatalogProjectionSource;
}

interface ResidentCatalog {
  active: V2ThreadSummary[];
  archived: V2ThreadSummary[];
  coverage: Map<string, "current" | "outsideCurrentScope">;
  errors: Record<ThreadCatalogPartition, string | null>;
  generationId: string | null;
  loading: Record<ThreadCatalogPartition, boolean>;
  next: Record<ThreadCatalogPartition, V2CatalogAnchor | null>;
  paged: Record<ThreadCatalogPartition, boolean>;
  sourceIds: Set<string>;
}

interface ProjectionCatalog {
  active: V2ThreadSummary[];
  archived: V2ThreadSummary[];
  coverage: Map<string, "current" | "outsideCurrentScope">;
  generationId: string;
  next: Record<ThreadCatalogPartition, V2CatalogAnchor | null>;
  sourceIds: Set<string>;
}

/** Owns the authoritative, incrementally paged catalog for one saved server. */
export class ThreadCatalogResource extends ObservableResource<ThreadCatalogSnapshot> {
  readonly #execute: ThreadCatalogResourceInput["execute"];
  readonly #source: ThreadCatalogProjectionSource;
  readonly #inFlight = new Map<ThreadCatalogPartition, Promise<void>>();
  #resident: ResidentCatalog;
  #subscriberCount = 0;
  #unsubscribe: (() => void) | null = null;
  #unsubscribeChanges: (() => void) | null = null;

  constructor(input: ThreadCatalogResourceInput) {
    const resident = residentCatalog(projectionCatalog(input.source.snapshot().value));
    super(presentation(resident));
    this.#execute = input.execute;
    this.#source = input.source;
    this.#resident = resident;
  }

  start(): void {
    this.#unsubscribe ??= this.#source.subscribe(() => this.#synchronize());
    this.#unsubscribeChanges ??= this.#source.subscribeChange((change) =>
      this.#applyChange(change),
    );
    this.#synchronize();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribeChanges?.();
    this.#unsubscribe = null;
    this.#unsubscribeChanges = null;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.start();
    return () => {
      unsubscribe();
      this.#subscriberCount -= 1;
      if (this.#subscriberCount === 0) this.stop();
    };
  };

  async loadMore(partition: ThreadCatalogPartition): Promise<void> {
    const current = this.#inFlight.get(partition);
    if (current !== undefined) return current;
    const before = this.#resident.next[partition];
    if (before === null) return;
    const generationId = this.#resident.generationId;
    this.#resident.errors[partition] = null;
    this.#resident.loading[partition] = true;
    this.#publishResident();
    const operation = this.#execute({
      before,
      kind: "catalog.page",
      limit: THREAD_CATALOG_PAGE_LIMIT,
      partition,
    })
      .then((result) => this.#acceptPage(partition, before, generationId, result))
      .catch((cause: unknown) => {
        if (this.#resident.generationId !== generationId) return;
        this.#resident.errors[partition] =
          cause instanceof Error ? cause.message : "Could not load more threads";
      })
      .finally(() => {
        this.#inFlight.delete(partition);
        if (this.#resident.generationId !== generationId) return;
        this.#resident.loading[partition] = false;
        this.#publishResident();
      });
    this.#inFlight.set(partition, operation);
    await operation;
  }

  coverage(threadId: string): "current" | "outsideCurrentScope" {
    return this.#resident.coverage.get(threadId) ?? "outsideCurrentScope";
  }

  #acceptPage(
    partition: ThreadCatalogPartition,
    before: V2CatalogAnchor,
    generationId: string | null,
    result: V2QueryResult,
  ): void {
    if (this.#resident.generationId !== generationId) return;
    if (result.kind !== "catalog.page") {
      throw new Error("Server returned the wrong catalog result");
    }
    if (result.threads.some((thread) => thread.archived !== (partition === "archived"))) {
      throw new Error("Server returned a thread from the wrong catalog partition");
    }
    if (sameAnchor(before, result.next)) {
      throw new Error("Server catalog page did not advance");
    }
    this.#resident[partition] = mergeThreads(
      this.#resident[partition],
      result.threads.filter(isRootThread),
    );
    for (const thread of result.threads) {
      if (isRootThread(thread)) this.#resident.coverage.set(thread.id, "current");
    }
    this.#resident.next[partition] = result.next;
    this.#resident.paged[partition] = true;
  }

  #synchronize(): void {
    const incoming = projectionCatalog(this.#source.snapshot().value);
    if (incoming === null) return;
    if (incoming.generationId !== this.#resident.generationId) {
      this.#resident = residentCatalog(incoming);
      this.#publishResident();
      return;
    }
    const changed = mergeProjection(this.#resident, incoming);
    if (changed) this.#publishResident();
  }

  #applyChange(change: V2ProjectionChange): void {
    if (change.kind === "threadUpserted") {
      if (!isRootThread(change.thread)) {
        const active = removeThread(this.#resident.active, change.thread.id);
        const archived = removeThread(this.#resident.archived, change.thread.id);
        if (active === this.#resident.active && archived === this.#resident.archived) return;
        this.#resident.active = active;
        this.#resident.archived = archived;
        this.#resident.coverage.delete(change.thread.id);
        this.#publishResident();
        return;
      }
      const target = change.thread.archived ? "archived" : "active";
      const other = change.thread.archived ? "active" : "archived";
      const otherThreads = removeThread(this.#resident[other], change.thread.id);
      const targetThreads = upsertLiveThread(this.#resident[target], change.thread);
      const coverageChanged = this.#resident.coverage.get(change.thread.id) !== "current";
      if (
        otherThreads === this.#resident[other] &&
        targetThreads === this.#resident[target] &&
        !coverageChanged
      ) {
        return;
      }
      this.#resident[other] = otherThreads;
      this.#resident[target] = targetThreads;
      this.#resident.coverage.set(change.thread.id, "current");
      this.#publishResident();
      return;
    }
    if (change.kind !== "threadRemoved" || change.reason !== "deleted") return;
    const active = removeThread(this.#resident.active, change.threadId);
    const archived = removeThread(this.#resident.archived, change.threadId);
    if (active === this.#resident.active && archived === this.#resident.archived) return;
    this.#resident.active = active;
    this.#resident.archived = archived;
    this.#resident.coverage.delete(change.threadId);
    this.#publishResident();
  }

  #publishResident(): void {
    const error = this.#resident.errors.active ?? this.#resident.errors.archived;
    if (error === null) {
      this.publish({ status: "ready", value: presentation(this.#resident) });
      return;
    }
    this.publish({ message: error, status: "error", value: presentation(this.#resident) });
  }
}

function projectionCatalog(snapshot: SyncV2SessionSnapshot): ProjectionCatalog | null {
  const projection = snapshot.projections.live ?? snapshot.projections.retained;
  if (projection === null) return null;
  const active: V2ThreadSummary[] = [];
  const archived: V2ThreadSummary[] = [];
  const currentActive: V2ThreadSummary[] = [];
  const currentArchived: V2ThreadSummary[] = [];
  const sourceIds = new Set<string>();
  const coverage = new Map<string, "current" | "outsideCurrentScope">();
  for (const entry of projection.catalog) {
    if (!isRootThread(entry.thread)) continue;
    const target = entry.thread.archived ? archived : active;
    target.push(entry.thread);
    sourceIds.add(entry.thread.id);
    coverage.set(entry.thread.id, entry.coverage);
    if (entry.coverage !== "current") continue;
    const currentTarget = entry.thread.archived ? currentArchived : currentActive;
    currentTarget.push(entry.thread);
  }
  const selected = projection.currentThread?.thread;
  if (selected !== undefined && isRootThread(selected)) {
    const target = selected.archived ? archived : active;
    const index = target.findIndex((thread) => thread.id === selected.id);
    if (index === -1) target.unshift(selected);
    else target[index] = selected;
    sourceIds.add(selected.id);
    coverage.set(selected.id, "current");
  }
  return {
    active,
    archived,
    coverage,
    generationId: projection.generationId,
    next: {
      active: projection.scope.active.complete ? null : pageAnchor(currentActive.at(-1)),
      archived: projection.scope.archived.complete ? null : pageAnchor(currentArchived.at(-1)),
    },
    sourceIds,
  };
}

function isRootThread(thread: V2ThreadSummary): boolean {
  return thread.parentId === null;
}

function residentCatalog(incoming: ProjectionCatalog | null): ResidentCatalog {
  return {
    active: incoming?.active ?? [],
    archived: incoming?.archived ?? [],
    coverage: incoming?.coverage ?? new Map(),
    errors: { active: null, archived: null },
    generationId: incoming?.generationId ?? null,
    loading: { active: false, archived: false },
    next: incoming?.next ?? { active: null, archived: null },
    paged: { active: false, archived: false },
    sourceIds: incoming?.sourceIds ?? new Set(),
  };
}

function mergeProjection(resident: ResidentCatalog, incoming: ProjectionCatalog): boolean {
  const active = mergeProjectionPartition(
    resident.active,
    resident.sourceIds,
    incoming.sourceIds,
    incoming.active,
  );
  const archived = mergeProjectionPartition(
    resident.archived,
    resident.sourceIds,
    incoming.sourceIds,
    incoming.archived,
  );
  const changed = active !== resident.active || archived !== resident.archived;
  resident.active = active;
  resident.archived = archived;
  const coverage = mergeCoverage(resident, incoming);
  const coverageChanged = !sameCoverage(resident.coverage, coverage);
  resident.coverage = coverage;
  const nextChanged = synchronizeNext(resident, incoming);
  resident.sourceIds = incoming.sourceIds;
  return changed || coverageChanged || nextChanged;
}

function mergeCoverage(
  resident: ResidentCatalog,
  incoming: ProjectionCatalog,
): Map<string, "current" | "outsideCurrentScope"> {
  const coverage = new Map<string, "current" | "outsideCurrentScope">();
  for (const thread of [...resident.active, ...resident.archived]) {
    coverage.set(
      thread.id,
      incoming.coverage.get(thread.id) ?? resident.coverage.get(thread.id) ?? "current",
    );
  }
  return coverage;
}

function sameCoverage(
  left: ReadonlyMap<string, "current" | "outsideCurrentScope">,
  right: ReadonlyMap<string, "current" | "outsideCurrentScope">,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, coverage] of left) {
    if (right.get(id) !== coverage) return false;
  }
  return true;
}

function synchronizeNext(resident: ResidentCatalog, incoming: ProjectionCatalog): boolean {
  let changed = false;
  for (const partition of ["active", "archived"] as const) {
    if (
      resident.paged[partition] ||
      sameNullableAnchor(resident.next[partition], incoming.next[partition])
    ) {
      continue;
    }
    resident.next[partition] = incoming.next[partition];
    changed = true;
  }
  return changed;
}

function mergeProjectionPartition(
  resident: V2ThreadSummary[],
  previousSourceIds: Set<string>,
  incomingSourceIds: Set<string>,
  incoming: V2ThreadSummary[],
): V2ThreadSummary[] {
  const incomingById = new Map(incoming.map((thread) => [thread.id, thread]));
  const next: V2ThreadSummary[] = [];
  let changed = false;
  for (const thread of resident) {
    const replacement = incomingById.get(thread.id);
    if (replacement !== undefined) {
      next.push(replacement);
      incomingById.delete(thread.id);
      if (replacement !== thread) changed = true;
      continue;
    }
    if (previousSourceIds.has(thread.id) || incomingSourceIds.has(thread.id)) {
      changed = true;
      continue;
    }
    next.push(thread);
  }
  if (incomingById.size === 0) return changed ? next : resident;
  return [...incomingById.values(), ...next];
}

function mergeThreads(resident: V2ThreadSummary[], incoming: V2ThreadSummary[]): V2ThreadSummary[] {
  const byId = new Map(resident.map((thread) => [thread.id, thread]));
  for (const thread of incoming) byId.set(thread.id, thread);
  return [...byId.values()];
}

function upsertLiveThread(
  resident: V2ThreadSummary[],
  incoming: V2ThreadSummary,
): V2ThreadSummary[] {
  const index = resident.findIndex((thread) => thread.id === incoming.id);
  if (index === -1) return [incoming, ...resident];
  if (index === 0 && resident[index] === incoming) return resident;
  return [incoming, ...resident.filter((thread) => thread.id !== incoming.id)];
}

function removeThread(resident: V2ThreadSummary[], threadId: string): V2ThreadSummary[] {
  const index = resident.findIndex((thread) => thread.id === threadId);
  if (index === -1) return resident;
  return resident.filter((thread) => thread.id !== threadId);
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

function sameNullableAnchor(left: V2CatalogAnchor | null, right: V2CatalogAnchor | null): boolean {
  if (left === null || right === null) return left === right;
  return sameAnchor(left, right);
}

function presentation(resident: ResidentCatalog): ThreadCatalogSnapshot {
  return {
    active: resident.active,
    archived: resident.archived,
    canLoadMore: {
      active: resident.next.active !== null,
      archived: resident.next.archived !== null,
    },
    errors: {
      active: resident.errors.active,
      archived: resident.errors.archived,
    },
    loading: {
      active: resident.loading.active,
      archived: resident.loading.archived,
    },
  };
}
