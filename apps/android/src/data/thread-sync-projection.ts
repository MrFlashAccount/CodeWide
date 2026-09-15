import type {
  AccountRateLimitsUpdatedNotification,
  Thread,
} from "@codewide/codex-protocol/v0.147.0/v2";
import { threadIdFromEvent, threadProjectionPatchFromEvent } from "@codewide/sync-client";
import type { AccountPoolSnapshot } from "./account-pool";
import type { AccountRateLimitsDatabase } from "./account-rate-limits-database";
import type { createCatalogRuntime } from "./catalog-runtime";
import { reconcileDeliveredCommandReceipts } from "./command-delivery";
import { operationConfirmsDeliveredCommand } from "./command-receipt-evidence";
import { hasAppServerAcceptedPendingDelivery, parseHostQueueSnapshot } from "./queue-event";
import { subagentActivityRootThreadId } from "./subagent-loader";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import { threadPatchRequiresAuthoritativeRefresh } from "./thread-detail-refresh-policy";
import type { ThreadProjectionStore } from "./thread-projection-store";
import { createThreadProjectionStore } from "./thread-projection-store";
import { projectThreadResourcePatch } from "./thread-resource-projection";
import type { ThreadSummaryDatabase } from "./thread-summary-database";
import type { createThreadSyncRuntime } from "./thread-sync-runtime";
import type { WorkspaceResourceDatabase } from "./workspace-resource-database";
import { threadResourceKey } from "./workspace-resource-keys";
/** Applies native projection effects without awaiting fallback network repair in the ordered lane. */
export function createThreadSyncProjection({
  details,
  summaries,
  resources,
  accountRateLimits,
  sync,
  catalog,
}: {
  details: ThreadDetailDatabase;
  summaries: ThreadSummaryDatabase;
  resources: WorkspaceResourceDatabase;
  accountRateLimits: AccountRateLimitsDatabase;
  sync: ReturnType<typeof createThreadSyncRuntime>;
  catalog: ReturnType<typeof createCatalogRuntime>;
}): ThreadProjectionStore {
  const projection = createThreadProjectionStore({ summaries, details });
  return {
    async applySnapshot(connectionId, snapshots, cursor) {
      sync.invalidateHistoryReads(connectionId);
      details.invalidateHistoryExhaustion(connectionId);
      await projection.applySnapshot(connectionId, snapshots, cursor);
      catalog.markRefreshed(connectionId);
      // Catalog snapshots persist receipt evidence, but not canonical turn
      // content. Retain the native receipt until detail persistence takes over.
    },
    async applyEvents(connectionId, events) {
      const projected = await projection.applyEvents(connectionId, events);
      const projectedThreads = projected.threads;
      const receiptThreadIds = new Set<string>();
      const deliveredReceiptThreads = new Set<string>();
      const subagentRoots = new Set<string>();
      for (const event of events) {
        const params = asRecord(event.payload.params);
        const patch = threadProjectionPatchFromEvent(event.payload);
        if (
          event.payload.method === "thread/archived" ||
          event.payload.method === "thread/unarchived"
        ) {
          catalog.refreshConnectionWindows(connectionId);
        }
        if (event.payload.method === "account/rateLimits/updated" && params !== null) {
          // WHY: The pre-migration V1 contract forwarded every non-null method-qualified payload.
          // The generic event envelope cannot narrow params statically, and validating here would
          // reject updates previously accepted by the account database.
          accountRateLimits.mergeUpdate(
            connectionId,
            params as AccountRateLimitsUpdatedNotification,
          );
        }
        if (event.payload.method === "companion/accountPool/updated" && params !== null) {
          // WHY: The pre-migration V1 contract forwarded every non-null method-qualified payload.
          // This companion event is outside the generated union, so no safe static narrowing is
          // available without adding runtime rejection or normalization that changes behavior.
          accountRateLimits.putAccountPool(connectionId, params as AccountPoolSnapshot);
        }
        if (
          event.payload.method === "companion/queue/changed" &&
          params !== null &&
          "threadId" in params &&
          "data" in params &&
          typeof params.threadId === "string"
        ) {
          const queueThreadId = params.threadId;
          const commands = parseHostQueueSnapshot(params.data);
          if (commands !== null) {
            // A host acceptance receipt starts bounded canonical repair,
            // but does not retire the durable optimistic row. Only the
            // matching stable client id in thread history owns that handoff.
            await details.replaceQueued(connectionId, queueThreadId, commands);
            const appServerAcceptedPendingDelivery = hasAppServerAcceptedPendingDelivery(
              commands,
              (commandId) => details.hasPendingDelivery(connectionId, queueThreadId, commandId),
            );
            if (appServerAcceptedPendingDelivery) deliveredReceiptThreads.add(queueThreadId);
          }
        }
        if (patch !== null && threadPatchRequiresAuthoritativeRefresh(patch.operation.kind)) {
          catalog.refreshInvalidatedThread(
            connectionId,
            patch.threadId,
            patch.operation.archived === true,
          );
        }
        const subagentRoot = subagentActivityRootThreadId(event.payload);
        if (subagentRoot !== null) subagentRoots.add(subagentRoot);
        const threadId = threadIdFromEvent(event.payload);
        if (threadId === null) continue;
        if (patch !== null) {
          if (operationConfirmsDeliveredCommand(patch.operation)) receiptThreadIds.add(threadId);
          const key = threadResourceKey(connectionId, threadId);
          const current = resources.threadResources.get(key);
          const cwd = projectedThreads.get(threadId)?.after.cwd;
          if (current?.value !== null && current?.value !== undefined && typeof cwd === "string") {
            const value = projectThreadResourcePatch(current.value, cwd, patch, event.cursor);
            if (value !== current.value)
              resources.putThreadResources({
                id: key,
                connectionId,
                threadId,
                status: current.status,
                value,
                error: current.error,
                ...(current.pendingKinds === undefined
                  ? {}
                  : { pendingKinds: current.pendingKinds }),
                ...(current.readyKinds === undefined ? {} : { readyKinds: current.readyKinds }),
                ...(current.resourceErrors === undefined
                  ? {}
                  : { resourceErrors: current.resourceErrors }),
              });
          }
        }
      }
      const receiptThreads: Thread[] = [];
      for (const threadId of receiptThreadIds) {
        const thread = projectedThreads.get(threadId)?.after;
        if (thread !== undefined) receiptThreads.push(thread);
      }
      await reconcileDeliveredCommandReceipts(connectionId, receiptThreads);
      for (const threadId of deliveredReceiptThreads) {
        // `queue/changed: delivered` should be followed by the canonical
        // `turn/started` frame. Do not put an authoritative network read in
        // the ordered projection lane: doing so holds that lifecycle frame
        // (and the visible Running state) behind thread/resume. The repair
        // remains a fallback for a genuinely missed canonical frame, but
        // it runs independently of live event publication.
        void sync
          .repairThreadProjection(connectionId, threadId)
          .then(async (repaired) => {
            if (repaired === null)
              throw new Error(`Accepted message receipt repair returned no thread for ${threadId}`);
            await reconcileDeliveredCommandReceipts(connectionId, [repaired.thread]);
          })
          .catch((cause: unknown) => {
            console.warn(
              "Accepted message receipt background repair failed:",
              cause instanceof Error ? cause.message : "unknown error",
            );
          });
      }
      for (const rootThreadId of subagentRoots) {
        void catalog.refreshSubagents(connectionId, rootThreadId, true).catch((cause: unknown) => {
          console.warn(
            "CodeWide subagent event refresh failed:",
            cause instanceof Error ? cause.message : "unknown error",
          );
        });
      }
      return projected;
    },
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
