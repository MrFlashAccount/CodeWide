import type { V2SavedServerId } from "./canonical";
import type { V2SavedServerDeletionStore } from "./deletion-store";
import type { V2CommandTerminalFrame } from "./frames";
import type { V2Command, V2Query, V2QueryResult } from "./operations";
import type { V2Projection, V2ProjectionStore } from "./projection";

export type V2ServerSelection =
  | { kind: "all" }
  | { kind: "selected"; savedServerIds: readonly V2SavedServerId[] };

export type V2QualifiedThreadId = Readonly<{
  savedServerId: V2SavedServerId;
  threadId: string;
}>;

export type V2QualifiedOperationId = Readonly<{
  savedServerId: V2SavedServerId;
  operationId: string;
}>;

export type V2AggregateServerProjection = Readonly<{
  savedServerId: V2SavedServerId;
  projection: V2Projection;
}>;

export type V2AggregateThread = Readonly<{
  identity: V2QualifiedThreadId;
  entry: V2Projection["catalog"][number];
}>;

export type V2AggregateProjection = Readonly<{
  selection: V2ServerSelection;
  servers: readonly V2AggregateServerProjection[];
  threads: readonly V2AggregateThread[];
}>;

export type V2SemanticSession = {
  readonly savedServerId: V2SavedServerId;
  query(query: V2Query): Promise<V2QueryResult>;
  command(operationId: string, command: V2Command): Promise<V2CommandTerminalFrame>;
};

/**
 * Reads an application-facing one, arbitrary-many, or All view without
 * mutating, merging, or re-keying any saved-server partition.
 */
export async function deriveV2AggregateProjection(
  store: Pick<V2ProjectionStore, "active">,
  deletionStore: Pick<V2SavedServerDeletionStore, "listPending">,
  knownSavedServerIds: readonly V2SavedServerId[],
  selection: V2ServerSelection,
): Promise<V2AggregateProjection> {
  const known = unique(knownSavedServerIds);
  const blocked = new Set(await deletionStore.listPending());
  const selected = selection.kind === "all"
    ? known
    : unique(selection.savedServerIds).filter((savedServerId) => known.includes(savedServerId));
  const projections = await Promise.all(selected.map(async (savedServerId) => ({
    savedServerId,
    projection: blocked.has(savedServerId) ? null : await store.active(savedServerId),
  })));
  const servers = projections.filter((entry): entry is V2AggregateServerProjection => entry.projection !== null);
  return {
    selection: cloneSelection(selection),
    servers,
    threads: servers.flatMap(({ savedServerId, projection }) => projection.catalog.map((entry) => ({
      identity: { savedServerId, threadId: entry.thread.id },
      entry,
    }))),
  };
}

/** Explicit selections drop a deleted owner; All remains a non-destructive mode. */
export function removeSavedServerFromV2Selection(
  selection: V2ServerSelection,
  deletedSavedServerId: V2SavedServerId,
): V2ServerSelection {
  return selection.kind === "all"
    ? selection
    : { kind: "selected", savedServerIds: selection.savedServerIds.filter((id) => id !== deletedSavedServerId) };
}

/** Routes every semantic request through its explicit saved-server owner. */
export class SyncV2SessionRouter {
  readonly #sessions = new Map<V2SavedServerId, V2SemanticSession>();
  readonly #deletionStore: Pick<V2SavedServerDeletionStore, "pending">;

  constructor(deletionStore: Pick<V2SavedServerDeletionStore, "pending">) {
    this.#deletionStore = deletionStore;
  }

  register(session: V2SemanticSession): () => void {
    if (this.#sessions.has(session.savedServerId)) throw new Error(`Sync V2 session already registered for ${session.savedServerId}`);
    this.#sessions.set(session.savedServerId, session);
    return () => {
      if (this.#sessions.get(session.savedServerId) === session) this.#sessions.delete(session.savedServerId);
    };
  }

  async query(savedServerId: V2SavedServerId, query: V2Query): Promise<V2QueryResult> {
    return await (await this.#owner(savedServerId)).query(query);
  }

  async command(identity: V2QualifiedOperationId, command: V2Command): Promise<V2CommandTerminalFrame> {
    return await (await this.#owner(identity.savedServerId)).command(identity.operationId, command);
  }

  async #owner(savedServerId: V2SavedServerId): Promise<V2SemanticSession> {
    if (await this.#deletionStore.pending(savedServerId)) {
      throw new Error(`Sync V2 saved server ${savedServerId} is blocked by durable deletion intent`);
    }
    const session = this.#sessions.get(savedServerId);
    if (session === undefined) throw new Error(`No live Sync V2 session owns saved server ${savedServerId}`);
    return session;
  }
}

function unique(values: readonly V2SavedServerId[]): V2SavedServerId[] {
  return [...new Set(values)];
}

function cloneSelection(selection: V2ServerSelection): V2ServerSelection {
  return selection.kind === "all" ? { kind: "all" } : { kind: "selected", savedServerIds: [...selection.savedServerIds] };
}
