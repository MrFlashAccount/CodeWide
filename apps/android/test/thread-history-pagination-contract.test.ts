import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
const timelineListSource = readFileSync(new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url), "utf8");
const initialPositionSource = readFileSync(new URL("../src/rendering/timeline-initial-position.ts", import.meta.url), "utf8");
const uiStateDatabase = readFileSync(new URL("../src/data/thread-ui-state-database.native.ts", import.meta.url), "utf8");
const detailDatabase = readFileSync(new URL("../src/data/thread-detail-database.native.ts", import.meta.url), "utf8");
const detailSqlite = readFileSync(new URL("../src/data/thread-detail-sqlite.native.ts", import.meta.url), "utf8");
const chatModel = readFileSync(new URL("../src/data/thread-chat-model.ts", import.meta.url), "utf8");
const chatWindowHook = readFileSync(new URL("../src/data/use-thread-chat-window.ts", import.meta.url), "utf8");
const historyController = readFileSync(new URL("../src/data/use-thread-history-controller.ts", import.meta.url), "utf8");
const remoteWorkspace = readFileSync(new URL("../src/data/thread-sync-history.ts", import.meta.url), "utf8");

const ownerTimelineViewport = compactSource(readFileSync(new URL("../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url), "utf8"));
const ownerConversationDetail = compactSource(readFileSync(new URL("../src/features/conversation/ConversationDetail.tsx", import.meta.url), "utf8"));
const ownerTimelineViewportState = compactSource(readFileSync(new URL("../src/features/conversation/timeline/timelineViewport.ts", import.meta.url), "utf8"));
const ownerTimelineProjection = compactSource(readFileSync(new URL("../src/features/conversation/timeline/timelineProjection.ts", import.meta.url), "utf8"));
const ownerConversationWorkspace = compactSource(readFileSync(new URL("../src/features/conversation/ConversationWorkspace.tsx", import.meta.url), "utf8"));

const ownerThreadSyncHistory = readFileSync(new URL("../src/data/thread-sync-history.ts", import.meta.url), "utf8");
const ownerThreadSyncRuntime = readFileSync(new URL("../src/data/thread-sync-runtime.ts", import.meta.url), "utf8");

const ownerThreadSyncRemoteLoader = readFileSync(new URL("../src/data/thread-sync-remote-loader.ts", import.meta.url), "utf8");

const ownerTimelineGestureBindings = compactSource(readFileSync(new URL("../src/features/conversation/timeline/timelineGestureBindings.ts", import.meta.url), "utf8"));
const ownerMainConversationHistory = compactSource(readFileSync(new URL("../src/features/conversation/mainConversationHistory.ts", import.meta.url), "utf8"));
const ownerMainConversationPublication = compactSource(readFileSync(new URL("../src/features/conversation/MainConversationPublication.tsx", import.meta.url), "utf8"));
const ownerConversationDestinationSurface = compactSource(readFileSync(new URL("../src/features/conversation/ConversationDestinationSurface.tsx", import.meta.url), "utf8"));

describe("thread history pagination contract", () => {
  it("keeps range fetching in the model and coalesces viewport intents", () => {
    expect(historyController).toContain("const loadedLocally = await context.pullRange(direction)");
    expect(historyController).not.toContain("loadOlderTurns");
    expect(historyController).not.toContain("while (");
    expect(historyController).not.toContain("for (");
    expect(detailDatabase).toContain("async pullRange(connectionId, threadId, direction)");
    expect(detailDatabase).toContain('direction === "older"');
    expect(detailDatabase).toContain("chat.commitRange(");
    expect(chatModel).toContain("commitRange(connectionId, threadId, expected, loaded)");
    expect(chatModel).toContain("pruneUnreferencedRows()");
    expect(detailDatabase).not.toContain("shiftWindow");
    expect(chatModel).not.toContain("requestedMaxOrdinal");
    expect(historyController).not.toContain("prefetch");
    expect(screen).not.toContain("historyViewport.prefetch()");
    expect(historyController).not.toContain("mutationRef");
    expect(detailDatabase).not.toContain('"chat.history.range_blocked_with_optimistic"');
    expect(detailDatabase).toContain('"chat.optimistic.reconciliation_stalled"');
    expect(historyController).toContain("runtime.operations[direction]");
    expect(detailDatabase).toContain('const pullKey = `${scope}\\u0000${direction}`');
    expect(detailDatabase).toContain("await remoteLoader.loadOlder(");
    expect(detailDatabase).toContain("await remoteLoader.loadNewer(");
    expect(detailDatabase).toContain("await remoteLoader.loadBefore(");
    expect(historyController).toContain("ThreadHistoryViewportFill");
  });

  it("leaves scroll position to MVCP while paging and follows only the authoritative tail", () => {
    expect(historyController).not.toContain("maintainAtEnd");
    expect(screen).not.toContain("maintainAtEnd=");
    expect(historyController).toContain("containsLatest: options.isLatestRange");
    expect(ownerTimelineViewport).toContain("!props.fullscreenCovered && props.historyViewport.containsLatest && !props.awayFromLatest && !props.threadSearchActive");
    expect(ownerTimelineGestureBindings).toContain("const away = !props.historyViewport.containsLatest || distance > LATEST_TIMELINE_THRESHOLD_PX;");
    expect(timelineListSource).toContain("maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}");
    expect(timelineListSource).toContain("dataChange: true");
    expect(timelineListSource).toContain("itemLayout: true");
    expect(timelineListSource).toContain("maintainVisibleContentPosition={{ data: true, size: true }}");
  });

  it("does not advance a backend cursor before its page is durable", () => {
    expect(ownerThreadSyncHistory).toContain("const persisted = await threadDetails.prependTurns(");
    expect(ownerThreadSyncHistory).toContain('if (!persisted.accepted) throw new Error("Backend history page was not persisted")');
    expect(remoteWorkspace).not.toContain("threadDetails?.prependTurns(");
    expect(ownerThreadSyncHistory).toContain('"companion/thread/history/after"');
    expect(ownerThreadSyncHistory).toContain("await threadDetails.appendTurnsAfter(");
    // Reopened-SQLite regressions verify durable-before-visible ordering.
    // This source check protects the ownership boundary only.
    expect(ownerThreadSyncHistory).toContain("await threadDetails.prependTurnsBefore(");
    expect(historyController).not.toContain("acceptedHistory");
  });

  it("tops up a short cached head from the canonical fifteen-turn tail", () => {
    expect(ownerThreadSyncRuntime).toContain("residentTurnCount < THREAD_RESIDENT_TURN_LIMIT");
    expect(ownerThreadSyncRuntime).toMatch(/new ThreadSyncCatchUp\(\s*cached,\s*details\.historyCursor\(connectionId, threadId\)/u);
    expect(remoteWorkspace).not.toContain("new ThreadSyncCatchUp(cached, details.historyCursor(connectionId, threadId) ?? null");
    expect(ownerThreadSyncRemoteLoader).toContain('reason !== "activation"');
    expect(ownerThreadSyncRuntime).toContain("repairShortWindow || details.historyCursor(connectionId, threadId) !== null");
    expect(ownerThreadSyncHistory).toContain("cursor: null");
    expect(ownerThreadSyncHistory).toContain("limit: THREAD_RESIDENT_TURN_LIMIT");
    expect(ownerThreadSyncHistory).toContain('sortDirection: "desc"');
    expect(ownerThreadSyncHistory).toMatch(/parseThreadTurnsListPage\(\s*await rpcAfterAttach<unknown>/u);
    expect(ownerThreadSyncHistory).toMatch(/await details\.mergeTailTurns\(\s*connectionId,\s*threadId,\s*\[\.\.\.page\.turns\]\.reverse\(\),\s*page\.nextCursor,\s*isCurrent,?\s*\)/u);
    expect(detailDatabase).toContain('mode: "authoritative" | "reset" | "live" | "append" | "tail"');
    expect(detailDatabase).toContain('mode === "reset" || mode === "tail"');
    expect(detailDatabase).not.toContain('replaceExisting: mode === "reset" || mode === "tail"');
  });

  it("publishes a visible loading state for every explicit range request", () => {
    const loading = historyController.indexOf('context.putState({ ...current, status: "loading-history", error: null })');
    const operation = historyController.indexOf("const operation = loadRange(context, direction)");
    const settlement = historyController.indexOf("publishLoadSettlement(context, settlement)");

    expect(loading).toBeGreaterThan(-1);
    expect(loading).toBeLessThan(operation);
    expect(settlement).toBeGreaterThan(operation);
    expect(historyController).toContain("ThreadHistoryLoadCoordinator");
  });

  it("keeps SQLite residency bounded and derives one atomic ready surface", () => {
    expect(detailSqlite).toContain("await database.transaction(async (executor) => {");
    expect(detailDatabase).toContain("createThreadChatModel({");
    expect(detailDatabase).not.toContain("createSqliteSyncRuntime<ThreadDetailRow, string>");
    expect(detailDatabase).not.toContain("createCollection({");
    expect(ownerConversationDetail).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)");
    expect(ownerConversationDetail).toContain("function MainConversationDetail(");
    expect(ownerMainConversationHistory).toContain("const projection = projectThreadChatWindow( chatDatabase, chatWindow,");
    expect(chatModel).toContain("commitRange(");
    expect(ownerMainConversationHistory).toContain("!threadLoadBlocksPresentation(chatSnapshot.status)");
    expect(screen).not.toContain("activeConversationNavigationReady");
    expect(screen).not.toContain("AtomicConversationSurface");
    expect(screen).not.toContain("ReactiveConversationSurface");
    expect(screen).not.toContain("reusePendingConversationSurface");
    expect(detailDatabase).toContain("onEvictWindow: (connectionId, threadId) => source.removeThreadLoaded(connectionId, threadId)");
  });

  it("keeps streaming content subscriptions below the workspace boundary", () => {
    const windowHook = chatWindowHook.slice(chatWindowHook.indexOf("export function useThreadChatWindow("));

    expect(windowHook).toContain("node.layoutRevision.get()");
    expect(windowHook).toContain("node.revision.get()");
    expect(windowHook).toContain("node.peek()");
    expect(windowHook).not.toContain("node.get()");
    expect(ownerConversationDetail).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)");
    expect(ownerConversationDetail.indexOf("function MainConversationDetail")).toBeLessThan(
      ownerConversationDetail.indexOf("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)"),
    );
    expect(screen).not.toContain("useThreadChatWindowContent");
    expect(screen).not.toContain("useThreadChatWindowStructure");
  });

  it("does not hold the live projection queue open for the 250ms checkpoint", () => {
    const commit = detailSqlite.slice(
      detailSqlite.indexOf("commit(options = {})"),
      detailSqlite.indexOf("flush: flushPending"),
    );

    expect(commit).toContain("enqueueCheckpoint(changes, options.durable === true)");
    expect(detailSqlite).toContain("const checkpoint = waitForDurability");
    expect(detailSqlite).toContain("? new Promise<void>");
    expect(detailSqlite).toContain(": Promise.resolve();");
    expect(commit).toContain("if (options.durable === true) void flushPending()");
  });

  it("preserves optimistic pending rows across an in-flight window installation", () => {
    const installer = detailDatabase.slice(
      detailDatabase.indexOf("const installStoredWindow ="),
      detailDatabase.indexOf("const loadWindow = async"),
    );

    expect(installer).toContain("composeInitialRangeRows(");
    expect(installer).toContain("mergePendingTimelineOverlays(");
    expect(installer).toContain("const membership = rangeMembership(rows, loaded.historyEpoch)");
    expect(installer).not.toContain("mergeResidentThreadRows(");
    expect(installer.indexOf("composeInitialRangeRows(")).toBeLessThan(installer.indexOf("const membership = rangeMembership"));
    expect(installer.indexOf("mergePendingTimelineOverlays(")).toBeLessThan(installer.indexOf("source.replaceThreadLoaded"));
    expect(installer.indexOf("if (!committed) return")).toBeLessThan(installer.indexOf("source.replaceThreadLoaded"));
  });

  it("gives overlapping optimistic mutations independent rollback ownership", () => {
    const staging = detailDatabase.slice(
      detailDatabase.indexOf("stagePendingMutation(mutation)"),
      detailDatabase.indexOf("async commitPending(row"),
    );

    expect(staging).toContain("const owner = nextStagedPendingOwner++");
    expect(staging).toContain("stagedPendingOverlays.get(key)?.owner !== owner");
    expect(staging).toContain("complete()");
  });

  it("keeps hydration in the stable model resource", () => {
    expect(screen).not.toContain("const hydrationTaskKey");
    expect(screen).not.toContain("active-thread-hydration");
    expect(detailDatabase).toContain("setRemoteLoader(loader)");
    expect(detailDatabase).toContain("await loader.hydrateWindow(");
    expect(detailDatabase).toContain("void hydrateAndInstall().catch(");
    expect(readFileSync(new URL("../src/data/workspace-runtime.ts", import.meta.url), "utf8")).toContain("details.setRemoteLoader(createThreadSyncRemoteLoader(details, workspaceThreadSync))");
  });

  it("keeps authoritative refresh out of cached navigation readiness", () => {
    expect(screen).not.toContain("threadSnapshotReady: remoteThread !== null");
    expect(screen).not.toContain("activeConversationNavigationReady");
    expect(ownerMainConversationHistory).toContain("const historyRestoreReady = !threadLoadBlocksPresentation(chatSnapshot.status)");
    expect(screen).not.toContain("const hydrationTaskKey");
  });

  it("binds pagination state and cancellation to the active history epoch", () => {
    expect(ownerMainConversationHistory).toContain("historyResourceRaw?.historyEpoch === historyEpoch");
    expect(screen).not.toContain("thread-hydration:");
    expect(historyController).toContain("state.historyEpoch !== context.historyEpoch");
    expect(historyController).toContain("const cursor = context.readHistoryCursor()");
    expect(historyController).toContain("const nextCursor = context.readHistoryCursor()");
    expect(detailDatabase).toContain("historyEpoch !== expectedHistoryEpoch");
    expect(ownerMainConversationHistory).toContain("nextCursor: chatDatabase.historyCursor(connectionId, threadId)");
    expect(detailDatabase).toContain("historyCursor(connectionId, threadId)");
    expect(detailDatabase).toContain("meta.historyCursor !== input.historyCursor.value");
    expect(historyController).toContain("nextCursor === null");
  });

  it("proves cursor-page novelty against durable SQLite instead of the partial hot source", () => {
    const loader = detailDatabase.slice(
      detailDatabase.indexOf("const loadDurablePrependRows"),
      detailDatabase.indexOf("const ensureControls"),
    );
    const prepend = detailDatabase.slice(
      detailDatabase.indexOf("async prependTurns"),
      detailDatabase.indexOf("async replaceTurnItems"),
    );

    expect(loader).toContain("detailStorage.loadPrependFacts");
    expect(detailSqlite).toContain("loadTurnFamilies(query, connectionId, threadId, turnIds)");
    expect(prepend.indexOf("loadDurablePrependRows")).toBeLessThan(prepend.indexOf("projectPrependedTurnOrdinals"));
    expect(prepend).not.toContain("source.set(row.id, row)");
    expect(prepend).toContain("mergeHistoryFacts(facts, source.rowsForThread(connectionId, threadId))");
    expect(prepend).toContain("await commitThreadProjection({");
    expect(detailDatabase).toContain("activityKey(input.connectionId, input.threadId, turn.id)");
    expect(prepend.indexOf("await commitThreadProjection({")).toBeLessThan(prepend.indexOf("composeExpandedRangeRows("));
  });

  it("anchors authoritative pages in durable SQLite before projecting their epoch", () => {
    const loader = detailDatabase.slice(
      detailDatabase.indexOf("const loadDurableAuthoritativeRows"),
      detailDatabase.indexOf("const ensureControls"),
    );
    const publish = detailDatabase.slice(
      detailDatabase.indexOf("const publishThread"),
      detailDatabase.indexOf("const publishLiveSlice"),
    );

    expect(loader).toContain("detailStorage.loadAuthoritativeFacts");
    expect(detailSqlite).toContain("loadTurnFamilies(query, connectionId, threadId, incomingTurnIds)");
    expect(detailSqlite).toContain("baseOrdinal + incomingTurnIds.length - 1");
    expect(publish.indexOf("await loadDurableAuthoritativeRows")).toBeLessThan(publish.indexOf("projectAuthoritativeHistoryEpoch"));
  });

  it("keeps three pages resident and trims the far edge only after the gesture", () => {
    const timelineList = ownerTimelineViewport;

    expect(timelineList).toContain("onStartReached={props.loadOlderAtTimelineStart}");
    expect(timelineList).toContain("onEndReached={props.loadNewerAtTimelineEnd}");
    expect(timelineList).toContain("showsVerticalScrollIndicator={false}");
    expect(historyController).toContain("loadRange(context, direction)");
    expect(detailDatabase).toContain("turnLimit: THREAD_HISTORY_PAGE_SIZE");
    expect(detailDatabase).toContain("composeExpandedRangeRows(");
    expect(detailDatabase).toContain("trimExpandedRangeRows(");
    expect(detailDatabase).toContain('"chat.history.range_trimmed"');
    expect(detailDatabase).not.toContain("targetMaxOrdinal");
    expect(detailDatabase).not.toContain("requestedMaxOrdinal");
    expect(screen).not.toContain("requestResidentRangeMove");
    expect(screen).not.toContain("pendingResidentRangeMoveRef");
    expect(screen).not.toContain("olderPageEdgeArmedRef");
    expect(screen).not.toContain("shouldRearmOlderPage");
    expect(historyController).not.toContain("freeze");
    expect(screen).not.toContain("timelineInteractionStartedRef");
    expect(screen).not.toContain("scrollDirectionRef");
    expect(ownerTimelineViewportState).toContain('const paginationEdgeLockRef = useConversationRef<"older" | "newer" | null>( composerScope, () => null, );');
    expect(ownerTimelineViewportState).toContain('paginationEdgeLockRef.current = null;');
    expect(ownerTimelineViewportState).toContain('paginationEdgeLockRef.current === "newer"');
    expect(ownerTimelineViewportState).toContain('paginationEdgeLockRef.current === "older"');
    expect(ownerTimelineViewportState).toContain('"ignored_opposite_edge"');
    expect(ownerTimelineGestureBindings).toContain("schedulePaginationWindowTrim();");
    // Starting momentum cancels deferred trimming even when the handler also pauses decoration.
    const momentumBegin = ownerTimelineGestureBindings.match(/const onMomentumScrollBegin = useEvent<[\s\S]*?>\(\(\) => \{([^}]+)\}\)/u)?.[1];
    expect(momentumBegin).toContain("cancelScheduledPaginationTrim()");
    expect(momentumBegin).not.toContain("trimPaginationWindow()");
    expect(ownerTimelineGestureBindings).toContain("trimPaginationWindow();");
    expect(historyController).toContain("trimAfterGesture");
    expect(timelineListSource).toContain("maintainVisibleContentPosition={{ data: true, size: true }}");
    expect(timelineListSource).toContain("maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}");
    expect(screen).not.toContain("reconcileTimelineEndPosition");
  });

  it("projects delivery state as ordinary chronological timeline rows", () => {
    expect(ownerMainConversationPublication).toContain("searchState === null ? history.projection.timeline");
    expect(ownerTimelineProjection).toContain("if (modelTimeline !== null) return modelTimeline");
    expect(screen).not.toContain("mergeChronologicalTimeline");
    expect(screen).not.toContain("pendingDeliveries={");
    expect(screen).not.toContain("MAX_OPTIMISTIC_MESSAGES");
    expect(screen).not.toContain("useTimelineOverlayScrollGuard");
    expect(chatModel).not.toContain("optimistic-timeline");
  });

  it("keeps transport cursors behind the history viewport interface", () => {
    const viewportInterface = historyController.slice(
      historyController.indexOf("export type ThreadHistoryViewport"),
      historyController.indexOf("type ThreadHistoryControllerOptions"),
    );
    const conversationPane = compactSource(readFileSync(new URL("../src/features/conversation/conversationCapabilities.ts", import.meta.url), "utf8"));

    expect(viewportInterface).not.toContain("nextCursor");
    expect(viewportInterface).not.toContain("loadingOlder");
    expect(viewportInterface).not.toContain("historyEpoch");
    expect(conversationPane).toContain("historyViewport: ThreadHistoryViewport");
    expect(conversationPane).not.toContain("loadState?: ThreadLoadState");
  });

  it("keeps a mounted timeline visible while a pagination subset reloads", () => {
    expect(ownerConversationDetail).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)");
    expect(ownerConversationDestinationSurface).toContain("<Suspense fallback={ <ConversationNavigationFallback");
    expect(ownerConversationDestinationSurface).toContain("<ConversationDestination");
    expect(screen).not.toContain("pendingConversationRequest");
    expect(screen).not.toContain("advanceConversationPresentation(");
    expect(screen).not.toContain("navigationReady");
    expect(screen).not.toContain("timelineHeaderContent");
  });

  it("keeps diagnostic navigation capture out of the product tree shape", () => {
    expect(screen).not.toContain("ActiveNavigationReactProfiler");
    expect(screen).not.toContain("NavigationReactProfiler");
    expect(screen).not.toContain("<Profiler");
  });

  it("restores a semantic anchor declaratively without measuring the whole chat", () => {
    expect(ownerTimelineViewport).toContain("initialPosition={props.timelineInitialPosition}");
    expect(screen).not.toContain("contentHeight - timelineViewportHeightRef.current - pendingOffset");
    expect(screen).not.toContain("scrollToIndex({ index: anchorIndex");
    expect(timelineListSource).toContain("legendInitialPositionProps(initialPosition)");
    expect(initialPositionSource).toContain('position.kind === "tail"');
    expect(initialPositionSource).toContain("initialScrollIndex:");
    expect(timelineListSource).toContain("positionByKey(itemKey)");
    expect(uiStateDatabase).toContain("historyAnchorOffsetPx");
  });
});
