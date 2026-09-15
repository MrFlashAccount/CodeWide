import { expect, it } from "vitest";
import {
  threadSummarySqlite,
  threadDetailDatabase,
  ownerCommandDelivery,
  threadChatProjection,
  threadUiStateDatabase,
  ownerThreadSyncProjection,
  threadProjectionStore,
  threadSummaryDatabase,
  threadDetailProjection,
  ownerThreadSyncItems,
  ownerThreadSyncRuntime,
  ownerThreadSyncHistory,
} from "./thread-runtime-sources";

it("preserves thread runtime integration contracts", () => {
  expect(threadSummarySqlite).not.toContain("DROP TABLE IF EXISTS");
  expect(threadDetailDatabase).toContain(
    "reconcileNativeCommands(connectionId, threadId, deliveries)",
  );
  expect(ownerCommandDelivery).toContain("details.applyCommandDelivery(delivery)");
  expect(ownerCommandDelivery).toMatch(
    /mode.type === "queue" \? \(?"queue"(?: as const)?\)? : \(?"delivery"(?: as const)?\)?/u,
  );
  expect(ownerCommandDelivery).toContain('"companion/queue/retry"');
  expect(threadChatProjection).toContain("materializePendingTimeline(view.liveRows)");
  expect(threadChatProjection).not.toContain("reconcileThreadLifecyclePresentation");
  expect(threadChatProjection).not.toContain("staleTurnLifecycleId");
  expect(threadChatProjection).toContain('turn.status === "inProgress"');
  expect(threadUiStateDatabase).toContain('id: "thread-ui-state-v1"');
  expect(ownerThreadSyncProjection).toContain(
    "projection.applySnapshot(connectionId, snapshots, cursor)",
  );
  expect(ownerThreadSyncProjection).toContain("projection.applyEvents(connectionId, events)");
  const liveProjectionStart = ownerThreadSyncProjection.indexOf(
    "async applyEvents(connectionId, events) {",
  );
  const liveProjectionEnd = ownerThreadSyncProjection.length;
  const liveProjection = ownerThreadSyncProjection.slice(liveProjectionStart, liveProjectionEnd);
  expect(liveProjection).not.toContain("workspaceRuntime.threadSyncLane.markDirty");
  expect(liveProjection).toContain("projectedThreads.get(threadId)?.after.cwd");
  expect(liveProjection).not.toContain("details.getThread(");
  expect(threadProjectionStore.indexOf("details.applyEvents(connectionId, events)")).toBeLessThan(
    threadProjectionStore.indexOf("summaries.applyEvents(connectionId, events)"),
  );
  expect(threadProjectionStore).not.toContain("reconcileBeforeSummary");
  expect(threadSummarySqlite).toContain('RUNTIME_ID = "thread-summaries-v2"');
  expect(threadSummaryDatabase).toContain("createThreadSummarySqlite()");
  expect(threadSummaryDatabase).not.toContain("createSqliteSyncRuntime");
  expect(threadSummaryDatabase).not.toContain("createSyncControlLease");
  expect(threadSummaryDatabase).toContain("createThreadSummaryModel()");
  expect(threadSummaryDatabase).toContain(
    "const loadView = async (request: ThreadSummaryViewRequest)",
  );
  expect(threadSummarySqlite).toContain("async loadView(request)");
  expect(threadSummaryDatabase).toContain("async applySnapshot(connectionId, snapshots)");
  expect(threadSummaryDatabase).toContain("async applyEvents(connectionId, events)");
  expect(threadSummaryDatabase).toContain("async updateArchived(connectionId, threadId, archived)");
  expect(threadSummaryDatabase).not.toContain("SqliteRemoteStore");
  expect(threadDetailDatabase).toContain('THREAD_DETAIL_COLLECTION_ID = "thread-details-v2"');
  expect(threadDetailDatabase).toContain("createThreadChatModel({");
  expect(threadDetailDatabase).toContain("createThreadDetailSqlite(");
  expect(threadDetailDatabase).toContain("detailStorage.loadResolvedWindow(");
  expect(threadDetailDatabase).toContain("preloadWindow(request)");
  expect(threadDetailDatabase).toContain("windowIntents.isCurrent(navigationToken)");
  expect(threadDetailDatabase).toContain("newerBuffer: THREAD_HISTORY_PAGE_SIZE");
  expect(threadDetailDatabase).not.toContain("createSqliteSyncRuntime<ThreadDetailRow, string>");
  expect(threadDetailDatabase).not.toContain("collection.startSyncImmediate()");
  expect(threadDetailDatabase).toContain("return detailStorage;");
  expect(threadDetailDatabase).toContain("if (!hasLoadedThread && startedThreadIds.size === 0)");
  const detailApplyEventsStart = threadDetailDatabase.indexOf(
    "async applyEvents(connectionId, events)",
  );
  expect(
    threadDetailDatabase.indexOf("const controls = ensureControls();", detailApplyEventsStart),
  ).toBeLessThan(threadDetailDatabase.indexOf("const byThread = new Map", detailApplyEventsStart));
  expect(threadDetailDatabase).not.toContain("WARM_THREAD_LIMIT");
  expect(threadDetailProjection).toContain(
    'kind: "thread" | "turn" | "turnMeta" | "activity" | "pending"',
  );
  expect(threadDetailProjection).toContain("previous?.sealed !== true");
  expect(threadDetailProjection).toContain("shouldWriteAuthoritativeThreadDetailRow");
  expect(ownerThreadSyncItems).toContain("page.nextCursor !== null && page.nextCursor === cursor");
  expect(threadDetailDatabase).toContain("const commitThreadProjection = async");
  expect(threadDetailProjection).toContain(
    "A sealed row is immutable inside one history generation",
  );
  expect(threadDetailDatabase).toContain("previous.turn === next.turn");
  expect(threadDetailDatabase).not.toContain("JSON.stringify(previous) === JSON.stringify(row)");
  expect(threadDetailDatabase).toContain("async replaceQueued(connectionId, threadId, commands");
  expect(threadDetailDatabase).not.toContain("deferredCommandDeliveries");
  expect(threadDetailDatabase).not.toContain("flushDeferredTimelineUpdates");
  expect(threadDetailDatabase).toContain("persistPendingMutation");
  expect(ownerCommandDelivery).toContain("details.stagePendingMutation(");
  expect(ownerCommandDelivery).toContain("details.applyCommandDelivery(delivery)");
  expect(ownerCommandDelivery).toContain('"companion/queue/put"');
  expect(threadDetailDatabase).toContain(
    "const coverage = threadWindowCoverage(request, cachedWindow)",
  );
  expect(threadDetailDatabase).toContain(
    "const requiresHydration = !coverage.complete || cachedThread === null",
  );
  expect(threadDetailDatabase).not.toContain(
    "if (!source.has(threadMetaKey(connectionId, threadId)) || turns.length === 0",
  );
  expect(threadDetailDatabase).not.toContain("collection.startSyncImmediate();");
  expect(ownerThreadSyncProjection).toContain(
    "projectThreadResourcePatch(current.value, cwd, patch, event.cursor)",
  );
  expect(ownerThreadSyncRuntime).toContain('session, "companion/thread/sync"');
  expect(ownerThreadSyncHistory).toContain("afterTurnId");
  expect(ownerThreadSyncRuntime).toContain("response.history.hasMore");
  expect(ownerThreadSyncRuntime).toContain("materialized = catchUp.accept(response)");
  expect(ownerThreadSyncRuntime).toContain("details.synchronizeThread(");
  expect(ownerThreadSyncHistory).toContain("limit: THREAD_HISTORY_PAGE_SIZE");
  expect(ownerThreadSyncHistory).toContain('itemsView: "summary"');
  expect(ownerThreadSyncItems).toMatch(/session,\s*"thread\/items\/list"/u);
  expect(ownerThreadSyncItems).toContain("loadTurnItemsFromFullTurns(session, threadId, turnId)");
  expect(ownerThreadSyncItems).toContain('itemsView: "full"');
  expect(ownerThreadSyncRuntime).toMatch(/threadSyncLane\.run\(\s*requestKey/u);
  expect(ownerThreadSyncItems).toContain("turnItemsInFlight.get(requestKey)");
  expect(threadChatProjection).toContain("...view.turnRows");
  expect(threadChatProjection).toContain("...view.detailRows");
  expect(threadChatProjection).toContain(
    "materializeThreadDetails(view.liveRows, database.sessionId)",
  );
  expect(threadDetailDatabase).toContain("await loader.hydrateWindow({");
  expect(threadDetailDatabase).toContain(
    "const requiresHydration = !coverage.complete || cachedThread === null",
  );
  expect(ownerThreadSyncRuntime).toContain("limit = THREAD_RESIDENT_TURN_LIMIT");
});
