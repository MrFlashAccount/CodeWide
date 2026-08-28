import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const timelineListSource = readFileSync(new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url), "utf8");
const initialPositionSource = readFileSync(new URL("../src/rendering/timeline-initial-position.ts", import.meta.url), "utf8");
const uiStateDatabase = readFileSync(new URL("../src/data/thread-ui-state-database.native.ts", import.meta.url), "utf8");
const detailDatabase = readFileSync(new URL("../src/data/thread-detail-database.native.ts", import.meta.url), "utf8");
const detailSqlite = readFileSync(new URL("../src/data/thread-detail-sqlite.native.ts", import.meta.url), "utf8");
const chatModel = readFileSync(new URL("../src/data/thread-chat-model.ts", import.meta.url), "utf8");
const chatWindowHook = readFileSync(new URL("../src/data/use-thread-chat-window.ts", import.meta.url), "utf8");
const historyController = readFileSync(new URL("../src/data/use-thread-history-controller.ts", import.meta.url), "utf8");
const remoteWorkspace = readFileSync(new URL("../src/data/use-remote-workspace.ts", import.meta.url), "utf8");

describe("thread history pagination contract", () => {
  it("pulls one SQLite range only when the list crosses an edge", () => {
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
    expect(historyController).toContain("inFlightRef.current[direction]");
    expect(detailDatabase).toContain('const pullKey = `${scope}\\u0000${direction}`');
    expect(detailDatabase).toContain("await remoteLoader.loadOlder(");
    expect(detailDatabase).toContain("return await pullStoredRange()");
  });

  it("leaves scroll position to MVCP while paging and follows only the authoritative tail", () => {
    expect(historyController).not.toContain("maintainAtEnd");
    expect(screen).not.toContain("maintainAtEnd=");
    expect(historyController).toContain("containsLatest: options.isLatestRange");
    expect(screen).toContain("followTail={historyViewport.containsLatest && !awayFromLatest && !threadSearchActive}");
    expect(screen).toContain("const away = !historyViewport.containsLatest || distance > LATEST_TIMELINE_THRESHOLD_PX;");
    expect(timelineListSource).toContain("maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}");
    expect(timelineListSource).toContain("dataChange: true");
    expect(timelineListSource).toContain("itemLayout: true");
    expect(timelineListSource).toContain("maintainVisibleContentPosition={{ data: true, size: true }}");
  });

  it("does not advance a backend cursor before its page is durable", () => {
    expect(remoteWorkspace).toContain("const persisted = await threadDetails.prependTurns(");
    expect(remoteWorkspace).toContain('if (!persisted.accepted) throw new Error("Backend history page was not persisted")');
    expect(remoteWorkspace).not.toContain("threadDetails?.prependTurns(");
    expect(detailDatabase.indexOf("await remoteLoader.loadOlder(")).toBeLessThan(
      detailDatabase.lastIndexOf("return await pullStoredRange()"),
    );
    expect(historyController).not.toContain("acceptedHistory");
  });

  it("keeps SQLite residency bounded and derives one atomic ready surface", () => {
    expect(detailSqlite).toContain('ORDER BY "ordinal" DESC, "__key" DESC LIMIT ?');
    expect(detailSqlite).toContain("await database.transaction(async (executor) => {");
    expect(detailDatabase).toContain("createThreadChatModel({");
    expect(detailDatabase).not.toContain("createSqliteSyncRuntime<ThreadDetailRow, string>");
    expect(detailDatabase).not.toContain("createCollection({");
    expect(screen).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest)");
    expect(screen).toContain("function MainConversationDetail(");
    expect(screen).toContain("const projection = projectThreadChatWindow(chatDatabase, chatWindow");
    expect(chatModel).toContain("commitRange(");
    expect(screen).toContain("!threadLoadBlocksPresentation(chatSnapshot.status)");
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
    expect(screen).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest)");
    expect(screen.indexOf("function MainConversationDetail")).toBeLessThan(
      screen.indexOf("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest)"),
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
    expect(remoteWorkspace).toContain("details.setRemoteLoader({");
  });

  it("keeps authoritative refresh out of cached navigation readiness", () => {
    expect(screen).not.toContain("threadSnapshotReady: remoteThread !== null");
    expect(screen).not.toContain("activeConversationNavigationReady");
    expect(screen).toContain("const historyRestoreReady = !threadLoadBlocksPresentation(chatSnapshot.status)");
    expect(screen).not.toContain("const hydrationTaskKey");
  });

  it("binds pagination state and cancellation to the active history epoch", () => {
    expect(screen).toContain("historyResourceRaw?.historyEpoch === historyEpoch");
    expect(screen).not.toContain("thread-hydration:");
    expect(historyController).toContain("state.historyEpoch !== context.historyEpoch");
    expect(historyController).toContain("const cursor = context.readHistoryCursor()");
    expect(historyController).toContain("const nextCursor = context.readHistoryCursor()");
    expect(detailDatabase).toContain("historyEpoch !== expectedHistoryEpoch");
    expect(screen).toContain("nextCursor: chatDatabase.historyCursor(connectionId, threadId)");
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
    expect(detailSqlite).toContain('ORDER BY "ordinal" ${direction === "asc" ? "ASC" : "DESC"}');
    expect(prepend.indexOf("loadDurablePrependRows")).toBeLessThan(prepend.indexOf("projectPrependedTurnOrdinals"));
    expect(prepend).toContain("source.set(row.id, row)");
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
    expect(detailSqlite).toContain('AND "kind" = \'thread\' LIMIT 1');
    expect(detailSqlite).toContain("loadTurnFamilies(query, connectionId, threadId, incomingTurnIds)");
    expect(detailSqlite).toContain('ORDER BY "ordinal" DESC');
    expect(detailSqlite).toContain("baseOrdinal + incomingTurnIds.length - 1");
    expect(publish.indexOf("await loadDurableAuthoritativeRows")).toBeLessThan(publish.indexOf("projectAuthoritativeHistoryEpoch"));
  });

  it("keeps three pages resident and trims the far edge only after the gesture", () => {
    const timelineList = screen.slice(
      screen.indexOf("<ThreadTimelineList"),
      screen.indexOf("</ThreadTimelineList>"),
    );

    expect(timelineList).toContain("onStartReached={loadOlderAtTimelineStart}");
    expect(timelineList).toContain("onEndReached={loadNewerAtTimelineEnd}");
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
    expect(screen).toContain('const paginationEdgeLockRef = useRef<"older" | "newer" | null>(null)');
    expect(screen).toContain('paginationEdgeLockRef.current = null;');
    expect(screen).toContain('paginationEdgeLockRef.current === "newer"');
    expect(screen).toContain('paginationEdgeLockRef.current === "older"');
    expect(screen).toContain('"ignored_opposite_edge"');
    expect(screen).toContain("schedulePaginationWindowTrim();");
    expect(screen).toContain("onMomentumScrollBegin={cancelScheduledPaginationTrim}");
    expect(screen).toContain("trimPaginationWindow();");
    expect(historyController).toContain("trimAfterGesture");
    expect(timelineListSource).toContain("maintainVisibleContentPosition={{ data: true, size: true }}");
    expect(timelineListSource).toContain("maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}");
    expect(screen).not.toContain("reconcileTimelineEndPosition");
  });

  it("projects delivery state as ordinary chronological timeline rows", () => {
    expect(screen).toContain("timelineEntries={projection.timeline}");
    expect(screen).toContain("if (modelTimeline !== null) return modelTimeline");
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
    const conversationPane = screen.slice(
      screen.indexOf("function ConversationPane"),
      screen.indexOf("function ConversationPane") + 8_000,
    );

    expect(viewportInterface).not.toContain("nextCursor");
    expect(viewportInterface).not.toContain("loadingOlder");
    expect(viewportInterface).not.toContain("historyEpoch");
    expect(conversationPane).toContain("historyViewport?: ThreadHistoryViewport");
    expect(conversationPane).not.toContain("loadState?: ThreadLoadState");
  });

  it("keeps a mounted timeline visible while a pagination subset reloads", () => {
    expect(screen).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest)");
    expect(screen).toContain("<Suspense fallback={<ConversationNavigationFallback");
    expect(screen).toContain("<ConversationDestination");
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
    expect(screen).toContain("initialPosition={timelineInitialPosition}");
    expect(screen).not.toContain("contentHeight - timelineViewportHeightRef.current - pendingOffset");
    expect(screen).not.toContain("scrollToIndex({ index: anchorIndex");
    expect(timelineListSource).toContain("legendInitialPositionProps(initialPosition)");
    expect(initialPositionSource).toContain('position.kind === "tail"');
    expect(initialPositionSource).toContain("initialScrollIndex:");
    expect(timelineListSource).toContain("positionByKey(itemKey)");
    expect(uiStateDatabase).toContain("historyAnchorOffsetPx");
  });
});
