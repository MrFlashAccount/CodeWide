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

describe("thread history pagination contract", () => {
  it("fills SQLite in the background before recentering a semantic resident range", () => {
    const loadOlder = historyController.slice(
      historyController.indexOf("const loadOlderRange = useEvent"),
      historyController.indexOf("const move = useEvent"),
    );

    expect(historyController).toContain("residentRangeForVisibleAnchor(");
    expect(loadOlder).toContain("hasFullLocalOlderPage(");
    expect(loadOlder).toContain("residentTurnLimit: nextRange.turnLimit");
    expect(loadOlder).toContain("residentMaxOrdinal: nextRange.maxOrdinal");
    expect(historyController).toContain("prefetchKeyRef");
    expect(loadOlder).toContain("mutation !== mutationRef.current");
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
    expect(chatModel).toContain('previous.requestKey === requestKey ? "background-updating" : "loading-history"');
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

  it("preserves optimistic pending rows across an in-flight range installation", () => {
    const loader = detailDatabase.slice(
      detailDatabase.indexOf("const loadWindow = async"),
      detailDatabase.indexOf("const database: ThreadDetailDatabase"),
    );

    expect(loader).toContain("mergePendingTimelineOverlays(");
    expect(loader).toContain("const liveRowIds = rows.flatMap");
    expect(loader.indexOf("mergePendingTimelineOverlays(")).toBeLessThan(loader.indexOf("source.replaceThreadLoaded"));
    expect(loader.indexOf("if (!committed) return")).toBeLessThan(loader.indexOf("source.replaceThreadLoaded"));
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

  it("does not restart hydration when live activity only changes summary recency", () => {
    const hydrationKey = screen.slice(
      screen.indexOf("const hydrationTaskKey"),
      screen.indexOf("const staleLifecycleTurnId"),
    );

    expect(hydrationKey).toContain("historyResourceId");
    expect(hydrationKey).not.toContain("recencyAt");
    expect(hydrationKey).not.toContain("updatedAt");
  });

  it("keeps authoritative refresh out of cached navigation readiness", () => {
    expect(screen).not.toContain("threadSnapshotReady: remoteThread !== null");
    expect(screen).not.toContain("activeConversationNavigationReady");
    expect(screen).toContain('cachedSnapshotAvailable ? "background-updating" : "initial-loading"');
    expect(screen).toContain("const historyRestoreReady = !threadLoadBlocksPresentation(chatSnapshot.status)");
    expect(screen).toContain("const hydrationTaskKey = !connectionAvailable || !historyRestoreReady");
  });

  it("binds pagination state and cancellation to the active history epoch", () => {
    expect(screen).toContain("historyResourceRaw?.historyEpoch === historyEpoch");
    expect(historyController).toContain("[options.historyEpoch, options.resourceId]");
    expect(screen).toContain("thread-hydration:${historyResourceId}:${threadOpenGeneration}:${historyEpoch}");
    expect(historyController).toContain("state.historyEpoch !== context.historyEpoch");
    expect(historyController).toContain("cursor,");
    expect(historyController).toContain("state.historyEpoch,");
    expect(detailDatabase).toContain("historyEpoch !== expectedHistoryEpoch");
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
    expect(prepend.indexOf("loadDurablePrependRows")).toBeLessThan(prepend.indexOf("previousMinimum"));
    expect(prepend).toContain("source.set(row.id, row)");
    expect(prepend).toContain("activityKey(connectionId, threadId, turn.id)");
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

  it("recenters by stable visible turn rather than physical list edges", () => {
    const timelineList = screen.slice(
      screen.indexOf("<ThreadTimelineList"),
      screen.indexOf("</ThreadTimelineList>"),
    );

    expect(timelineList).not.toContain("onStartReached=");
    expect(timelineList).not.toContain("onEndReached=");
    expect(timelineList).toContain("showsVerticalScrollIndicator={false}");
    expect(historyController).toContain("residentRangeForVisibleAnchor(");
    expect(historyController).toContain("state.residentMaxOrdinal ?? null) !== context.presentedResidentMaxOrdinal");
    expect(screen).toContain("requestResidentRangeMove(turnId, direction, historyViewport.move)");
    expect(screen).toContain("pending.move");
    expect(screen).not.toContain("olderPageEdgeArmedRef");
    expect(screen).not.toContain("shouldRearmOlderPage");
    expect(historyController).toContain("context.putState(revealResidentLiveTail(state))");
    expect(screen).toContain('scrollDirectionRef.current = nativeEvent.contentOffset.y < previousOffsetY ? "older" : "newer"');
  });

  it("keeps transport cursors behind the history viewport interface", () => {
    const viewportInterface = historyController.slice(
      historyController.indexOf("export type ThreadHistoryViewport"),
      historyController.indexOf("type OrdinalBounds"),
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
