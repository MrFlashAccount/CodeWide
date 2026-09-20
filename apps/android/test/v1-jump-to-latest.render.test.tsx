import { createRef } from "react";
import { View, type View as NativeView } from "react-native";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../src/data/use-thread-history-controller";
import { TimelineViewport } from "../src/features/conversation/timeline/TimelineViewport";
import type { TimelineViewportProps } from "../src/features/conversation/timeline/TimelineViewportContract";
import { useHistoryAnchorActions } from "../src/features/conversation/timeline/historyAnchor";
import {
  useTimelineJumpActions,
  useTimelineJumpState,
} from "../src/features/conversation/timeline/timelineJump";
import { createFullscreenScrollOwnership } from "../src/ui/fullscreen-scroll-ownership";
import { legendListScrollToEnd, legendListScrollToIndex } from "./mocks/LegendKeyboardList";

const unreadRow = {
  completedAt: null,
  durationMs: null,
  key: "unread",
  kind: "meta",
  status: "completed",
} as const;

function measuredView(y: () => number, height: number): NativeView {
  const view = {
    measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
      callback(0, y(), 100, height);
    },
  };
  // WHY: React Native host views cannot be constructed in Jest. The jump owner consumes only
  // measureInWindow, which this focused host substitute implements completely.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return view as NativeView;
}

function timelineViewportProps(
  completeTimelineJump: (requestId: number) => void,
): TimelineViewportProps {
  return {
    awayFromLatest: true,
    awayFromLatestRef: { current: true },
    bottomChromeHeight: 0,
    cancelScheduledPaginationTrim: () => undefined,
    commitInitialTimelineLoad: () => undefined,
    completeTimelineJump,
    composerScope: "server\u0000thread",
    conversationInsets: { bottom: 0, left: 0, right: 0, top: 0 },
    displayedTimeline: [],
    draftConnectionId: null,
    draftThreadId: null,
    emptyContent: <View />,
    firstVisibleHistoryAnchorRef: { current: null },
    footerContent: null,
    fullscreenCovered: false,
    fullscreenScrollOwnership: createFullscreenScrollOwnership(() => undefined),
    historyViewport: COMPLETE_STATIC_THREAD_HISTORY,
    inlineQueueExpanded: false,
    lastTimelineOffsetYRef: { current: null },
    latestUnreadAgentRef: { current: null },
    latestUnreadAgentTurnId: null,
    liveStatusVisible: false,
    loadNewerAtTimelineEnd: () => undefined,
    loadOlderAtTimelineStart: () => undefined,
    onTimelineFirstVisibleItemChanged: () => undefined,
    paginationEdgeLockRef: { current: null },
    persistTimelineAtEnd: () => undefined,
    persistTimelineOffset: () => undefined,
    renderTimelineItem: () => <View />,
    reportHistoryViewport: () => undefined,
    schedulePaginationWindowTrim: () => undefined,
    scheduleUnreadAgentVisibilityCheck: () => undefined,
    scrollGestureStartedAtRef: { current: null },
    scrollOffsetRef: { current: 0 },
    setAwayFromLatest: () => undefined,
    setTimelineGestureActive: () => undefined,
    threadSearch: "",
    threadSearchActive: false,
    threadSearchMatch: 0,
    threadSearchVisible: false,
    timelineCompact: true,
    timelineContentHeightRef: { current: 0 },
    timelineJumpRequest: null,
    timelinePositioned: true,
    timelineRef: createRef(),
    timelineViewportHeightRef: { current: 0 },
    timelineViewportRef: { current: null },
    trimPaginationWindow: () => undefined,
    windowLayout: {
      desktop: false,
      fontScale: 1,
      height: 800,
      measurementRevision: "initial",
      scale: 1,
      width: 400,
    },
  };
}

function timelineScrollEvent(offsetY: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: offsetY },
      contentSize: { height: 1_000, width: 400 },
      layoutMeasurement: { height: 200, width: 400 },
    },
  };
}

beforeEach(() => {
  legendListScrollToEnd.mockClear();
  legendListScrollToIndex.mockClear();
});

it("does not overwrite a user scroll when the delayed initial load completes", () => {
  const awayFromLatestRef = { current: true };
  const setAwayFromLatest = jest.fn();
  const setTimelineDidLoad = jest.fn();
  const { result } = renderHook(() =>
    useHistoryAnchorActions({
      acknowledgeUnreadReceipt: () => undefined,
      awayFromLatestRef,
      draftConnectionId: null,
      draftThreadId: null,
      latestUnreadReceiptKey: null,
      saveScrollOffset: undefined,
      scrollOffsetRef: { current: 400 },
      scrollSaveTimerRef: { current: null },
      setAwayFromLatest,
      setTimelineDidLoad,
      timeline: [],
      timelineContentHeightRef: { current: 1_000 },
      timelineViewportHeightRef: { current: 600 },
    }),
  );

  act(() => {
    result.current.commitInitialTimelineLoad();
  });

  expect(awayFromLatestRef.current).toBe(true);
  expect(setAwayFromLatest).not.toHaveBeenCalled();
  expect(setTimelineDidLoad).toHaveBeenCalledWith(true);
});

it("delegates tail maintenance to LegendList without retaining bootstrap positioning", () => {
  const completeTimelineJump = jest.fn();
  const props = timelineViewportProps(completeTimelineJump);
  props.awayFromLatest = false;
  props.awayFromLatestRef.current = false;
  const view = render(<TimelineViewport {...props} />);

  const timeline = view.getByTestId("conversation-timeline");
  expect(timeline.props.initialScrollAtEnd).toBe(false);
  expect(timeline.props.maintainScrollAtEnd).toBe(true);
  expect(timeline.props.maintainVisibleContentPosition).toBe(true);
  expect(timeline.props.maintainScrollAtEndThreshold).toBe(0.02);
});

it("uses the same two-percent viewport boundary for the latest indicator", () => {
  const setAwayFromLatest = jest.fn();
  const props = timelineViewportProps(() => undefined);
  props.awayFromLatest = false;
  props.awayFromLatestRef.current = false;
  props.setAwayFromLatest = setAwayFromLatest;
  const view = render(<TimelineViewport {...props} />);
  const timeline = view.getByTestId("conversation-timeline");

  fireEvent(timeline, "scroll", timelineScrollEvent(797));
  expect(setAwayFromLatest).not.toHaveBeenCalled();

  fireEvent(timeline, "scroll", timelineScrollEvent(795));
  expect(setAwayFromLatest).toHaveBeenCalledWith(true);
});

it("does not gate LegendList callbacks behind custom bootstrap state", () => {
  const loadNewerAtTimelineEnd = jest.fn();
  const loadOlderAtTimelineStart = jest.fn();
  const reportHistoryViewport = jest.fn();
  const props = timelineViewportProps(() => undefined);
  props.awayFromLatest = false;
  props.awayFromLatestRef.current = false;
  props.loadNewerAtTimelineEnd = loadNewerAtTimelineEnd;
  props.loadOlderAtTimelineStart = loadOlderAtTimelineStart;
  props.reportHistoryViewport = reportHistoryViewport;
  props.timelinePositioned = false;
  const view = render(<TimelineViewport {...props} />);
  const bootstrapTimeline = view.getByTestId("conversation-timeline");

  expect(bootstrapTimeline.props.initialScrollAtEnd).toBe(true);
  expect(bootstrapTimeline.props.maintainScrollAtEnd).toBe(true);
  fireEvent(bootstrapTimeline, "startReached");
  fireEvent(bootstrapTimeline, "endReached");
  fireEvent(bootstrapTimeline, "layout", { nativeEvent: { layout: { height: 800 } } });
  fireEvent(bootstrapTimeline, "contentSizeChange", 400, 600);
  expect(loadOlderAtTimelineStart).toHaveBeenCalledTimes(1);
  expect(loadNewerAtTimelineEnd).toHaveBeenCalledTimes(1);
  expect(reportHistoryViewport).toHaveBeenCalledTimes(2);

  view.rerender(<TimelineViewport {...props} timelinePositioned />);
  const positionedTimeline = view.getByTestId("conversation-timeline");
  expect(positionedTimeline.props.initialScrollAtEnd).toBe(false);
  expect(positionedTimeline.props.maintainScrollAtEnd).toBe(true);
  fireEvent(positionedTimeline, "startReached");
  fireEvent(positionedTimeline, "endReached");
  fireEvent(positionedTimeline, "layout", { nativeEvent: { layout: { height: 800 } } });
  fireEvent(positionedTimeline, "contentSizeChange", 400, 600);
  expect(loadOlderAtTimelineStart).toHaveBeenCalledTimes(2);
  expect(loadNewerAtTimelineEnd).toHaveBeenCalledTimes(2);
  expect(reportHistoryViewport).toHaveBeenCalledTimes(4);
});

it("leaves positioning to LegendList and unlocks paging for a new user gesture", () => {
  const props = timelineViewportProps(() => undefined);
  props.paginationEdgeLockRef.current = "newer";
  const view = render(<TimelineViewport {...props} />);
  const timeline = view.getByTestId("conversation-timeline");

  fireEvent(timeline, "scrollBeginDrag", timelineScrollEvent(800));
  expect(props.paginationEdgeLockRef.current).toBeNull();
  fireEvent(timeline, "scroll", timelineScrollEvent(700));
  fireEvent(timeline, "scrollEndDrag", timelineScrollEvent(700));

  expect(view.getByTestId("conversation-timeline").props.initialScrollAtEnd).toBe(false);
  expect(view.getByTestId("conversation-timeline").props.maintainScrollAtEnd).toBe(true);
});

it("executes a ready latest-jump request through the LegendList ref", async () => {
  const completeTimelineJump = jest.fn();
  const persistTimelineAtEnd = jest.fn();
  const props = timelineViewportProps(completeTimelineJump);
  props.persistTimelineAtEnd = persistTimelineAtEnd;
  const view = render(<TimelineViewport {...props} />);
  expect(legendListScrollToEnd).not.toHaveBeenCalled();

  view.rerender(
    <TimelineViewport {...props} timelineJumpRequest={{ requestId: 1, unreadItemKey: null }} />,
  );

  await waitFor(() => {
    expect(legendListScrollToEnd).toHaveBeenCalledTimes(1);
    expect(legendListScrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect(completeTimelineJump).toHaveBeenCalledTimes(1);
    expect(completeTimelineJump).toHaveBeenCalledWith(1);
    expect(persistTimelineAtEnd).toHaveBeenCalledTimes(1);
  });
});

it("settles a long unread row before the next activation moves to the tail", async () => {
  const completeTimelineJump = jest.fn();
  const props = timelineViewportProps(completeTimelineJump);
  props.displayedTimeline = [unreadRow];
  props.timelineViewportRef.current = measuredView(() => 0, 360);
  props.latestUnreadAgentRef.current = measuredView(
    () => (legendListScrollToIndex.mock.calls.length >= 2 ? 120 : 500),
    120,
  );
  const view = render(
    <TimelineViewport
      {...props}
      timelineJumpRequest={{ requestId: 1, unreadItemKey: "turn-meta-unread" }}
    />,
  );

  await waitFor(() => {
    expect(legendListScrollToIndex).toHaveBeenCalledTimes(2);
    expect(completeTimelineJump).toHaveBeenCalledWith(1);
  });
  expect(legendListScrollToEnd).not.toHaveBeenCalled();

  view.rerender(
    <TimelineViewport
      {...props}
      timelineJumpRequest={{ requestId: 2, unreadItemKey: "turn-meta-unread" }}
    />,
  );

  await waitFor(() => {
    expect(legendListScrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect(completeTimelineJump).toHaveBeenCalledWith(2);
  });
});

it("continues to the tail when the unread response is already above the viewport", async () => {
  const completeTimelineJump = jest.fn();
  const props = timelineViewportProps(completeTimelineJump);
  props.displayedTimeline = [unreadRow];
  props.timelineViewportRef.current = measuredView(() => 0, 360);
  props.latestUnreadAgentRef.current = measuredView(() => -200, 120);

  render(
    <TimelineViewport
      {...props}
      timelineJumpRequest={{ requestId: 3, unreadItemKey: "turn-meta-unread" }}
    />,
  );

  await waitFor(() => {
    expect(legendListScrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect(completeTimelineJump).toHaveBeenCalledWith(3);
  });
  expect(legendListScrollToIndex).not.toHaveBeenCalled();
});

it("loads the authoritative latest range once before publishing a jump request", async () => {
  const loadLatest = jest.fn(async () => undefined);
  const historyViewport = { ...COMPLETE_STATIC_THREAD_HISTORY, loadLatest };
  const hook = renderHook(() => {
    const state = useTimelineJumpState("server\u0000thread");
    return useTimelineJumpActions({
      ...state,
      conversationOwner: { hasReplacement: () => false, isCurrent: () => true },
      fullscreenScrollOwnership: createFullscreenScrollOwnership(() => undefined),
      historyViewport,
      latestUnreadAgentTurnId: null,
      searchWindow: null,
      timeline: [],
      timelineModelReady: true,
    });
  });

  await act(async () => {
    hook.result.current.jumpTimelineToLatest();
    hook.result.current.jumpTimelineToLatest();
    await Promise.resolve();
  });

  expect(loadLatest).toHaveBeenCalledTimes(1);
  expect(hook.result.current.timelineJumpRequest).toEqual({
    requestId: 1,
    unreadItemKey: null,
  });
});
