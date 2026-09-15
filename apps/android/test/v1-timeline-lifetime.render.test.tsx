import { act, renderHook } from "@testing-library/react-native";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../src/data/use-thread-history-controller";
import {
  sessionConversationHistoryAnchors,
  useHistoryAnchorActions,
  useHistoryAnchorState,
  useTimelineCleanup,
} from "../src/features/conversation/timeline/historyAnchor";
import { useTimelineSearchState } from "../src/features/conversation/timeline/timelineSearch";
import {
  usePaginationTrim,
  useTimelineViewportState,
} from "../src/features/conversation/timeline/timelineViewport";
import { useUnreadReceiptState } from "../src/features/conversation/timeline/unreadReceipt";
import { createFullscreenScrollOwnership } from "../src/ui/fullscreen-scroll-ownership";

const saveOffset = jest.fn(async () => undefined);
const dismissScope = jest.fn();
const trimAfterGesture = jest.fn(async () => undefined);
const overlayOwnership = createFullscreenScrollOwnership(() => undefined);
const historyViewport = { ...COMPLETE_STATIC_THREAD_HISTORY, trimAfterGesture };

function useTimelineSession(scope: string) {
  const anchor = useHistoryAnchorState(scope, null, null, "server", scope, saveOffset);
  const viewport = useTimelineViewportState(scope);
  const search = useTimelineSearchState(scope, null);
  const unread = useUnreadReceiptState(scope);
  const actions = useHistoryAnchorActions({
    ...anchor,
    ...viewport,
    composerScope: scope,
    draftConnectionId: "server",
    draftThreadId: scope,
    saveScrollOffset: saveOffset,
    timelineInitialPosition: { kind: "tail" },
    timeline: [],
    currentTurnId: null,
    latestUnreadReceiptKey: null,
    acknowledgeUnreadReceipt: () => undefined,
    searchWindow: null,
    timelineModelReady: true,
    historyViewport,
    conversationOwner: { isCurrent: () => true, hasReplacement: () => false },
    fullscreenScrollOwnership: overlayOwnership,
  });
  const trim = usePaginationTrim({
    paginationTrimTimerRef: viewport.paginationTrimTimerRef,
    paginationEdgeLockRef: viewport.paginationEdgeLockRef,
    fullscreenScrollOwnership: overlayOwnership,
    historyViewport,
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
  return { anchor, viewport, actions, trim };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sessionConversationHistoryAnchors.clear();
});
afterEach(() => {
  jest.useRealTimers();
  sessionConversationHistoryAnchors.clear();
});

it("keeps the bootstrap anchor fixed while the resident window changes", () => {
  sessionConversationHistoryAnchors.set("first", { turnId: "anchor-a", viewportOffsetPx: 23 });
  const hook = renderHook((scope: string) => useTimelineSession(scope), { initialProps: "first" });
  expect(hook.result.current.anchor.initialHistoryRestore).toEqual({
    turnId: "anchor-a", viewportOffsetPx: 23,
  });
  sessionConversationHistoryAnchors.set("first", { turnId: "anchor-b", viewportOffsetPx: 77 });
  hook.rerender("first");
  expect(hook.result.current.anchor.initialHistoryRestore.turnId).toBe("anchor-a");
  sessionConversationHistoryAnchors.set("second", { turnId: "anchor-c", viewportOffsetPx: 31 });
  hook.rerender("second");
  expect(hook.result.current.anchor.initialHistoryRestore).toEqual({
    turnId: "anchor-c", viewportOffsetPx: 31,
  });
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

it("settles a slow drag once and suppresses trim while another window covers the timeline", () => {
  const hook = renderHook(() => useTimelineSession("first"));
  act(() => {
    hook.result.current.viewport.paginationEdgeLockRef.current = "older";
    hook.result.current.trim.schedulePaginationWindowTrim();
    jest.runOnlyPendingTimers();
  });
  expect(trimAfterGesture).toHaveBeenCalledWith("older");
  expect(hook.result.current.viewport.paginationEdgeLockRef.current).toBeNull();
  act(() => {
    overlayOwnership.willOpen("overlay");
    hook.result.current.viewport.paginationEdgeLockRef.current = "newer";
    hook.result.current.trim.trimPaginationWindow();
  });
  expect(trimAfterGesture).toHaveBeenCalledTimes(1);
  overlayOwnership.didClose("overlay");
});
