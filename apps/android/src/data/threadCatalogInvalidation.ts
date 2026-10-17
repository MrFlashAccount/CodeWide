import {
  threadIdFromEvent,
  threadProjectionPatchFromEvent,
  type SyncEvent,
} from "@codewide/sync-client";
import { isCatalogExcluded } from "./threadCatalogMembership";
import type { StoredThreadSummary } from "./thread-summary-types";

type ThreadActivity = { active: boolean; archived: boolean };
type CatalogSummary = Pick<StoredThreadSummary, "archived" | "provisionalThread" | "status">;

const CATALOG_REPAIR_METHODS = new Set([
  "companion/thread/invalidated",
  "thread/archived",
  "thread/unarchived",
  "companion/thread/pin/updated",
]);

type CatalogInvalidationPorts = {
  /** Reads the thread's summary after the ordered summary projection of the same batch. */
  readSummary: (connectionId: string, threadId: string) => Promise<CatalogSummary | null>;
  refresh: (connectionId: string) => void;
};

/** What one event asks of the catalog. */
type EventDemand =
  | { readonly kind: "none" }
  | { readonly kind: "refresh" }
  | { readonly kind: "started"; readonly threadId: string }
  | { readonly activity: ThreadActivity; readonly kind: "progress"; readonly threadId: string };

/** The summary lookups a batch needs before it can skip a catalog refresh. */
type BatchLookups = {
  readonly activity: Map<string, ThreadActivity>;
  readonly started: Set<string>;
};

const NO_DEMAND: EventDemand = { kind: "none" };
const REFRESH: EventDemand = { kind: "refresh" };

/** Reconciles catalog membership without turning live preview updates into full catalog reads. */
export function createThreadCatalogInvalidation({
  readSummary,
  refresh,
}: CatalogInvalidationPorts) {
  return async (connectionId: string, events: readonly SyncEvent[]): Promise<void> => {
    const lookups = batchLookups(events);
    if (lookups === null || (await needsLookupRepair(readSummary, connectionId, lookups))) {
      refresh(connectionId);
    }
  };
}

/** Collects the batch's summary lookups; `null` when an event refreshes unconditionally. */
function batchLookups(events: readonly SyncEvent[]): BatchLookups | null {
  const lookups: BatchLookups = { activity: new Map(), started: new Set() };
  for (const event of events) {
    const demand = eventDemand(event);
    if (demand.kind === "refresh") {
      return null;
    }
    if (demand.kind === "started") {
      lookups.started.add(demand.threadId);
    } else if (demand.kind === "progress") {
      lookups.activity.set(demand.threadId, demand.activity);
    }
  }
  return lookups;
}

function eventDemand(event: SyncEvent): EventDemand {
  const method = event.payload.method;
  if (isCatalogExcluded(event.payload)) {
    return NO_DEMAND;
  }
  if (requiresCatalogRepair(method)) {
    return REFRESH;
  }
  if (method === "turn/started") {
    const threadId = threadIdFromEvent(event.payload);
    return threadId === null ? REFRESH : { kind: "started", threadId };
  }
  if (method !== "companion/thread/progress") {
    return NO_DEMAND;
  }
  const progress = readProgressActivity(event);
  return progress === null ? REFRESH : { kind: "progress", ...progress };
}

/**
 * Reads summaries after the ordered summary projection already updated each preview.
 * A start needs repair only when its thread has no listed summary yet; progress also
 * when activity or archive membership changed.
 */
async function needsLookupRepair(
  readSummary: CatalogInvalidationPorts["readSummary"],
  connectionId: string,
  { activity, started }: BatchLookups,
): Promise<boolean> {
  for (const threadId of started) {
    // Progress for the same thread checks a superset below.
    if (!activity.has(threadId) && lacksListedSummary(await readSummary(connectionId, threadId))) {
      return true;
    }
  }
  for (const [threadId, threadActivity] of activity) {
    if (needsMetadataRepair(await readSummary(connectionId, threadId), threadActivity)) {
      return true;
    }
  }
  return false;
}

function readProgressActivity(
  event: SyncEvent,
): { activity: ThreadActivity; threadId: string } | null {
  const patch = threadProjectionPatchFromEvent(event.payload);
  if (
    patch === null ||
    typeof patch.operation.archived !== "boolean" ||
    typeof patch.operation.turnActive !== "boolean"
  ) {
    return null;
  }
  return {
    activity: { active: patch.operation.turnActive, archived: patch.operation.archived },
    threadId: patch.threadId,
  };
}

/**
 * A `turn/started` patch carries no archive state, so only a missing or provisional
 * summary, not activity or archive membership, makes it a catalog repair.
 */
function lacksListedSummary(summary: CatalogSummary | null): boolean {
  return (
    summary === null ||
    (summary.provisionalThread !== null && summary.provisionalThread !== undefined)
  );
}

function needsMetadataRepair(summary: CatalogSummary | null, activity: ThreadActivity): boolean {
  return (
    summary === null ||
    summary.provisionalThread !== null ||
    summary.archived !== activity.archived ||
    (summary.status.type === "active") !== activity.active
  );
}

function requiresCatalogRepair(method: unknown): boolean {
  return typeof method === "string" && CATALOG_REPAIR_METHODS.has(method);
}
