import { threadProjectionPatchFromEvent, type SyncEvent } from "@codewide/sync-client";
import { isCatalogExcluded } from "./threadCatalogMembership";
import type { StoredThreadSummary } from "./thread-summary-types";

type ThreadActivity = { active: boolean; archived: boolean };
type CatalogSummary = Pick<StoredThreadSummary, "archived" | "provisionalThread" | "status">;

const CATALOG_REPAIR_METHODS = new Set([
  "turn/started",
  "companion/thread/invalidated",
  "thread/archived",
  "thread/unarchived",
]);

type CatalogInvalidationPorts = {
  readSummary: (connectionId: string, threadId: string) => Promise<CatalogSummary | null>;
  refresh: (connectionId: string) => void;
};

/** Reconciles catalog membership without turning live preview updates into full catalog reads. */
export function createThreadCatalogInvalidation({
  readSummary,
  refresh,
}: CatalogInvalidationPorts) {
  return async (connectionId: string, events: readonly SyncEvent[]): Promise<void> => {
    const activityThreads = new Map<string, ThreadActivity>();
    for (const event of events) {
      if (isCatalogExcluded(event.payload)) {
        continue;
      }
      const method = event.payload.method;
      if (requiresCatalogRepair(method)) {
        refresh(connectionId);
        return;
      }
      if (method !== "companion/thread/progress") {
        continue;
      }
      const progress = readProgressActivity(event);
      if (progress === null) {
        refresh(connectionId);
        return;
      }
      activityThreads.set(progress.threadId, progress.activity);
    }
    // The ordered summary projection already updated each preview. Starts and
    // terminal invalidations above retain authoritative metadata repair; progress
    // needs it only for missing metadata or changed activity/archive membership.
    for (const [threadId, activity] of activityThreads) {
      const summary = await readSummary(connectionId, threadId);
      if (needsMetadataRepair(summary, activity)) {
        refresh(connectionId);
        return;
      }
    }
  };
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
