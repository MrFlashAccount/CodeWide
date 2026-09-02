import type { V2SavedServerId } from "./canonical";
import type { V2SnapshotFrame } from "./frames";
import type {
  V2CatalogScope,
  V2PendingRequest,
  V2ProjectionChange,
  V2SnapshotLimits,
  V2ThreadSummary,
  V2ThreadWindow,
  V2U64,
} from "./model";

export type V2CatalogEntry = {
  thread: V2ThreadSummary;
  coverage: "current" | "outsideCurrentScope";
};

export type V2SemanticInvalidation = Extract<
  V2ProjectionChange,
  {
    kind: "resourcesChanged" | "queueChanged" | "accountsChanged";
  }
> & { watermark: V2U64 };

export type V2Projection = {
  generationId: string;
  sourceGeneration: V2U64;
  epochId: string;
  revision: string;
  watermark: V2U64;
  scope: V2CatalogScope;
  limits: V2SnapshotLimits;
  catalog: V2CatalogEntry[];
  currentThread: V2ThreadWindow | null;
  pendingRequests: V2PendingRequest[];
  resourceRevisions: Record<string, string>;
  queueRevisions: Record<string, string>;
  accountsRevision: string | null;
  invalidations: V2SemanticInvalidation[];
};

export type V2ProjectionViews = {
  live: V2Projection | null;
  retained: V2Projection | null;
};

export type V2StoreUnsubscribe = () => void;

/**
 * Durable implementations publish one complete saved-server generation and
 * its active marker atomically. An aborted commit returns null and is invisible.
 */
export interface V2ProjectionStore {
  /** Projection for the currently Live epoch, or null outside Live authority. */
  active(savedServerId: V2SavedServerId): Promise<V2Projection | null>;
  retained(savedServerId: V2SavedServerId): Promise<V2Projection | null>;
  subscribe(savedServerId: V2SavedServerId, listener: () => void): V2StoreUnsubscribe;
  commitSnapshot(
    savedServerId: V2SavedServerId,
    snapshot: V2SnapshotFrame,
    signal?: AbortSignal,
  ): Promise<V2Projection | null>;
  applyChange(
    savedServerId: V2SavedServerId,
    epochId: string,
    watermark: V2U64,
    change: V2ProjectionChange,
  ): Promise<void>;
  abandonEpoch(savedServerId: V2SavedServerId, epochId: string): Promise<void>;
  hasSavedServerData(savedServerId: V2SavedServerId): Promise<boolean>;
  deleteSavedServer(savedServerId: V2SavedServerId): Promise<void>;
}

/** In-memory reference implementation of the generation publication rules. */
export class MemoryV2ProjectionStore implements V2ProjectionStore {
  readonly #active = new Map<string, V2Projection>();
  readonly #retained = new Map<string, V2Projection>();
  readonly #listeners = new Map<string, Set<() => void>>();

  async active(savedServerId: V2SavedServerId): Promise<V2Projection | null> {
    return this.#active.get(savedServerId) ?? null;
  }

  async retained(savedServerId: V2SavedServerId): Promise<V2Projection | null> {
    return this.#retained.get(savedServerId) ?? null;
  }

  subscribe(savedServerId: V2SavedServerId, listener: () => void): V2StoreUnsubscribe {
    let listeners = this.#listeners.get(savedServerId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(savedServerId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(savedServerId);
    };
  }

  async commitSnapshot(
    savedServerId: V2SavedServerId,
    snapshot: V2SnapshotFrame,
    signal?: AbortSignal,
  ): Promise<V2Projection | null> {
    if (isAborted(signal)) return null;
    const previous = this.#retained.get(savedServerId) ?? this.#active.get(savedServerId) ?? null;
    const projection = buildV2Projection(previous, snapshot);
    if (isAborted(signal)) return null;
    this.#active.set(savedServerId, projection);
    this.#retained.set(savedServerId, projection);
    this.#publish(savedServerId);
    return projection;
  }

  async applyChange(
    savedServerId: V2SavedServerId,
    epochId: string,
    watermark: V2U64,
    change: V2ProjectionChange,
  ): Promise<void> {
    const current = this.#active.get(savedServerId);
    if (current === undefined || current.epochId !== epochId)
      throw new Error("Sync V2 change does not belong to the active projection generation");
    if (compareV2Watermarks(watermark, current.watermark) <= 0)
      throw new Error("Sync V2 watermark did not advance");
    const next = reduceV2Projection(current, watermark, change);
    this.#active.set(savedServerId, next);
    this.#retained.set(savedServerId, next);
    this.#publish(savedServerId);
  }

  async abandonEpoch(savedServerId: V2SavedServerId, epochId: string): Promise<void> {
    const current = this.#active.get(savedServerId);
    if (current?.epochId !== epochId) return;
    this.#retained.set(savedServerId, retainV2ProjectionOutsideCoverage(current));
    this.#active.delete(savedServerId);
    this.#publish(savedServerId);
  }

  async deleteSavedServer(savedServerId: V2SavedServerId): Promise<void> {
    this.#active.delete(savedServerId);
    this.#retained.delete(savedServerId);
    this.#publish(savedServerId);
  }

  async hasSavedServerData(savedServerId: V2SavedServerId): Promise<boolean> {
    return this.#active.has(savedServerId) || this.#retained.has(savedServerId);
  }

  #publish(savedServerId: V2SavedServerId): void {
    for (const listener of this.#listeners.get(savedServerId) ?? []) {
      try {
        listener();
      } catch {
        // Observation is advisory and must never roll back a committed mutation.
      }
    }
  }
}

export function buildV2Projection(
  previous: V2Projection | null,
  snapshot: V2SnapshotFrame,
): V2Projection {
  assertSnapshotCoverage(snapshot);
  const entries = new Map<string, V2CatalogEntry>();
  for (const entry of previous?.catalog ?? [])
    entries.set(entry.thread.id, { thread: entry.thread, coverage: "outsideCurrentScope" });
  for (const thread of [...snapshot.catalog.active, ...snapshot.catalog.archived])
    entries.set(thread.id, { thread, coverage: "current" });
  let projection: V2Projection = {
    generationId: `${snapshot.epochId}:${snapshot.revision}`,
    sourceGeneration: snapshot.sourceGeneration,
    epochId: snapshot.epochId,
    revision: snapshot.revision,
    watermark: snapshot.includedTail[0]?.watermark ?? snapshot.watermark,
    scope: copyScope(snapshot.scope),
    limits: { ...snapshot.limits },
    catalog: [...entries.values()],
    currentThread: snapshot.currentThread,
    pendingRequests: snapshot.pendingRequests,
    resourceRevisions: {},
    queueRevisions: {},
    accountsRevision: null,
    invalidations: [],
  };
  for (const sequenced of snapshot.includedTail)
    projection = reduceV2Projection(projection, sequenced.watermark, sequenced.change);
  projection.watermark = snapshot.watermark;
  return projection;
}

export function reduceV2Projection(
  projection: V2Projection,
  watermark: V2U64,
  change: V2ProjectionChange,
): V2Projection {
  const next: V2Projection = { ...projection, watermark };
  if (change.kind === "threadUpserted") {
    next.catalog = projection.catalog.map((entry) => ({ ...entry }));
    next.scope = copyScope(projection.scope);
    upsertScopedThread(next, change.thread);
    if (projection.currentThread?.thread.id === change.thread.id)
      next.currentThread = { ...projection.currentThread, thread: change.thread };
  } else if (change.kind === "threadRemoved") {
    next.catalog = projection.catalog.map((entry) => ({ ...entry }));
    next.scope = copyScope(projection.scope);
    const index = next.catalog.findIndex((entry) => entry.thread.id === change.threadId);
    if (index !== -1) {
      if (change.reason === "deleted") next.catalog.splice(index, 1);
      else next.catalog[index] = { ...next.catalog[index]!, coverage: "outsideCurrentScope" };
    }
    if (change.reason === "deleted" && next.currentThread?.thread.id === change.threadId)
      next.currentThread = null;
    refreshScopeCounts(next);
  } else if (change.kind === "currentThreadReplaced") {
    next.currentThread = change.currentThread;
    next.pendingRequests = change.pendingRequests;
  } else if (
    change.kind === "turnUpserted" &&
    projection.currentThread !== null &&
    projection.currentThread.thread.id === change.turn.threadId
  ) {
    const currentThread = projection.currentThread;
    const turns = [...currentThread.turns];
    const index = turns.findIndex((turn) => turn.id === change.turn.id);
    if (index === -1) turns.push(change.turn);
    else turns[index] = change.turn;
    if (turns.length > next.limits.turnWindowMax)
      turns.splice(
        0,
        turns.length - next.limits.turnWindowMax,
      );
    next.currentThread = {
      ...currentThread,
      thread: {
        ...currentThread.thread,
        headTurnId: turns.at(-1)?.id ?? currentThread.thread.headTurnId,
      },
      turns,
    };
  } else if (change.kind === "pendingRequestOpened") {
    if (
      change.request.threadId !== null &&
      change.request.threadId !== next.currentThread?.thread.id
    )
      return next;
    const index = next.pendingRequests.findIndex(
      (request) =>
        request.id === change.request.id && request.generation === change.request.generation,
    );
    next.pendingRequests = [...projection.pendingRequests];
    if (index === -1) next.pendingRequests.push(change.request);
    else next.pendingRequests[index] = change.request;
  } else if (change.kind === "pendingRequestClosed") {
    next.pendingRequests = next.pendingRequests.filter(
      (request) => request.id !== change.requestId || request.generation !== change.generation,
    );
  } else if (change.kind === "resourcesChanged") {
    next.resourceRevisions = { ...projection.resourceRevisions, [change.threadId]: change.revision };
    next.invalidations = [...projection.invalidations];
    appendInvalidation(next, { ...change, watermark });
  } else if (change.kind === "queueChanged") {
    next.queueRevisions = {
      ...projection.queueRevisions,
      [change.threadId ?? "*"]: change.revision,
    };
    next.invalidations = [...projection.invalidations];
    appendInvalidation(next, { ...change, watermark });
  } else if (change.kind === "accountsChanged") {
    next.accountsRevision = change.revision;
    next.invalidations = [...projection.invalidations];
    appendInvalidation(next, { ...change, watermark });
  }
  return next;
}

function copyScope(scope: V2CatalogScope): V2CatalogScope {
  return { active: { ...scope.active }, archived: { ...scope.archived } };
}

export function compareV2Watermarks(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, "");
  const normalizedRight = right.replace(/^0+(?=\d)/u, "");
  return normalizedLeft.length === normalizedRight.length
    ? normalizedLeft.localeCompare(normalizedRight)
    : normalizedLeft.length - normalizedRight.length;
}

function assertSnapshotCoverage(snapshot: V2SnapshotFrame): void {
  const partitions = [
    ["active", snapshot.catalog.active, snapshot.scope.active, false],
    ["archived", snapshot.catalog.archived, snapshot.scope.archived, true],
  ] as const;
  for (const [name, threads, scope, archived] of partitions) {
    if (
      threads.length !== scope.returned ||
      scope.returned > scope.limit ||
      threads.some((thread) => thread.archived !== archived)
    ) {
      throw new Error(`Sync V2 snapshot ${name} catalog violates declared coverage`);
    }
  }
}

function upsertScopedThread(projection: V2Projection, thread: V2ThreadSummary): void {
  const existingIndex = projection.catalog.findIndex((entry) => entry.thread.id === thread.id);
  const limit = thread.archived ? projection.scope.archived.limit : projection.scope.active.limit;
  const entry: V2CatalogEntry = {
    thread,
    coverage: limit === 0 ? "outsideCurrentScope" : "current",
  };
  if (existingIndex === -1) projection.catalog.unshift(entry);
  else projection.catalog[existingIndex] = entry;
  enforcePartitionLimit(projection, thread.archived, limit, thread.id);
  enforcePartitionLimit(
    projection,
    !thread.archived,
    (!thread.archived ? projection.scope.archived : projection.scope.active).limit,
  );
  refreshScopeCounts(projection);
}

function enforcePartitionLimit(
  projection: V2Projection,
  archived: boolean,
  limit: number,
  preferredId?: string,
): void {
  const current = projection.catalog.filter(
    (entry) => entry.coverage === "current" && entry.thread.archived === archived,
  );
  if (current.length <= limit) return;
  const preferredIsCurrent =
    preferredId !== undefined && current.some((entry) => entry.thread.id === preferredId);
  const retainedOthers = Math.max(0, limit - (preferredIsCurrent ? 1 : 0));
  const demote = current.filter((entry) => entry.thread.id !== preferredId).slice(retainedOthers);
  for (const entry of demote) entry.coverage = "outsideCurrentScope";
}

function refreshScopeCounts(projection: V2Projection): void {
  projection.scope.active.returned = projection.catalog.filter(
    (entry) => entry.coverage === "current" && !entry.thread.archived,
  ).length;
  projection.scope.archived.returned = projection.catalog.filter(
    (entry) => entry.coverage === "current" && entry.thread.archived,
  ).length;
}

function appendInvalidation(projection: V2Projection, invalidation: V2SemanticInvalidation): void {
  projection.invalidations.push(invalidation);
  if (projection.invalidations.length > projection.limits.queueMaxEvents) {
    projection.invalidations.splice(
      0,
      projection.invalidations.length - projection.limits.queueMaxEvents,
    );
  }
}

export function retainV2ProjectionOutsideCoverage(projection: V2Projection): V2Projection {
  return projection;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
