import { act, renderHook } from "@testing-library/react-native";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../src/data/use-thread-history-controller";
import {
  useHistoryAnchorActions,
  useHistoryAnchorState,
  useTimelineCleanup,
} from "../src/features/conversation/timeline/historyAnchor";
import { useTimelineSearchState } from "../src/features/conversation/timeline/timelineSearch";
import {
  usePaginationTrim,
  useTimelineViewportActions,
  useTimelineViewportState,
} from "../src/features/conversation/timeline/timelineViewport";
import { useUnreadReceiptState } from "../src/features/conversation/timeline/unreadReceipt";
import { createFullscreenScrollOwnership } from "../src/ui/fullscreen-scroll-ownership";

const saveOffset = jest.fn(async () => undefined);
const dismissScope = jest.fn();
const loadNewer = jest.fn(async () => undefined);
const loadOlder = jest.fn(async () => undefined);
const trimAfterGesture = jest.fn(async () => undefined);
const overlayOwnership = createFullscreenScrollOwnership(() => undefined);
const historyViewport = {
  ...COMPLETE_STATIC_THREAD_HISTORY,
  loadNewer,
  loadOlder,
  trimAfterGesture,
};

function useTimelineSession(scope: string) {
  const anchor = useHistoryAnchorState(scope, "server", scope, saveOffset);
  const viewport = useTimelineViewportState(scope);
  const search = useTimelineSearchState(scope, null);
  const unread = useUnreadReceiptState(scope);
  const actions = useHistoryAnchorActions({
    ...anchor,
    ...viewport,
    draftConnectionId: "server",
    draftThreadId: scope,
    saveScrollOffset: saveOffset,
    timeline: [],
    latestUnreadReceiptKey: null,
    acknowledgeUnreadReceipt: () => undefined,
  });
  const trim = usePaginationTrim({
    paginationTrimTimerRef: viewport.paginationTrimTimerRef,
    paginationEdgeLockRef: viewport.paginationEdgeLockRef,
    fullscreenScrollOwnership: overlayOwnership,
    historyViewport,
  });
  const pagingActions = useTimelineViewportActions({
    displayedTimeline: [],
    draftConnectionId: null,
    draftThreadId: null,
    firstVisibleHistoryAnchorRef: anchor.firstVisibleHistoryAnchorRef,
    fullscreenScrollOwnership: overlayOwnership,
    historyViewport,
    lastTimelineOffsetYRef: viewport.lastTimelineOffsetYRef,
    paginationEdgeLockRef: viewport.paginationEdgeLockRef,
    scrollOffsetRef: viewport.scrollOffsetRef,
    threadSearchActive: false,
    timeline: [],
    timelineContentHeightRef: viewport.timelineContentHeightRef,
    timelineViewportHeightRef: viewport.timelineViewportHeightRef,
  });
  useTimelineCleanup({
    composerScope: scope,
    scrollSaveTimerRef: anchor.scrollSaveTimerRef,
    mountedConversationScopeRef: anchor.mountedConversationScopeRef,
    scrollOffsetRef: viewport.scrollOffsetRef,
    paginationTrimTimerRef: viewport.paginationTrimTimerRef,
    unreadVisibilityFrameRef: unread.unreadVisibilityFrameRef,
    latestUnreadAgentRef: unread.latestUnreadAgentRef,
    timelineIndexRetryTimerRef: search.timelineIndexRetryTimerRef,
    fullscreenOverlay: { dismissScope },
  });
  return { anchor, viewport, actions, pagingActions, trim };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

it("flushes the outgoing offset to its own thread and cancels its deferred trim", () => {
  const hook = renderHook((scope: string) => useTimelineSession(scope), { initialProps: "first" });
  act(() => {
    hook.result.current.actions.persistTimelineOffset(190);
    hook.result.current.viewport.paginationEdgeLockRef.current = "older";
    hook.result.current.trim.schedulePaginationWindowTrim();
  });
  hook.rerender("second");
  expect(saveOffset).toHaveBeenCalledWith("server", "first", 190, null, null);
  expect(dismissScope).toHaveBeenCalledWith("first");
  act(() => jest.runOnlyPendingTimers());
  expect(trimAfterGesture).not.toHaveBeenCalled();
  expect(saveOffset).toHaveBeenCalledTimes(1);
  expect(hook.result.current.viewport.scrollOffsetRef.current).toBe(0);
});

it("settles a slow drag once, retaining its edge until the next gesture", () => {
  const hook = renderHook(() => useTimelineSession("first"));
  act(() => {
    hook.result.current.viewport.paginationEdgeLockRef.current = "older";
    hook.result.current.trim.schedulePaginationWindowTrim();
    jest.runOnlyPendingTimers();
  });
  expect(trimAfterGesture).toHaveBeenCalledWith("older");
  expect(hook.result.current.viewport.paginationEdgeLockRef.current).toBe("older");
  act(() => {
    overlayOwnership.willOpen("overlay");
    hook.result.current.viewport.paginationEdgeLockRef.current = "newer";
    hook.result.current.trim.trimPaginationWindow();
  });
  expect(trimAfterGesture).toHaveBeenCalledTimes(1);
  overlayOwnership.didClose("overlay");
});

it("ignores the transient opposite edge while a trimmed window settles", () => {
  const hook = renderHook(() => useTimelineSession("sliding-window"));
  act(() => {
    hook.result.current.viewport.paginationEdgeLockRef.current = "newer";
    hook.result.current.trim.trimPaginationWindow();
    hook.result.current.pagingActions.loadOlderAtTimelineStart();
  });

  expect(trimAfterGesture).toHaveBeenCalledWith("newer");
  expect(loadOlder).not.toHaveBeenCalled();
  expect(hook.result.current.viewport.paginationEdgeLockRef.current).toBe("newer");
});

it("publishes the LegendList initial load without overwriting a user scroll", () => {
  const hook = renderHook(() => useTimelineSession("initial-load"));
  act(() => {
    hook.result.current.anchor.awayFromLatestRef.current = true;
    hook.result.current.anchor.setAwayFromLatest(true);
  });

  act(() => hook.result.current.actions.commitInitialTimelineLoad());

  expect(hook.result.current.viewport.timelineDidLoad).toBe(true);
  expect(hook.result.current.anchor.awayFromLatest).toBe(true);
  expect(hook.result.current.anchor.awayFromLatestRef.current).toBe(true);
});
