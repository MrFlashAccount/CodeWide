import { createRef } from "react";
import { Pressable, View, type View as NativeView } from "react-native";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { COMPLETE_STATIC_THREAD_HISTORY } from "../src/data/use-thread-history-controller";
import { TimelineViewport } from "../src/features/conversation/timeline/TimelineViewport";
import { JumpToLatest } from "../src/features/conversation/timeline/JumpToLatest";
import { TimelineJumpVisibility } from "../src/features/conversation/timeline/timelineJumpVisibility";
import type { TimelineViewportProps } from "../src/features/conversation/timeline/TimelineViewportContract";
import { timelineItemKey } from "../src/features/conversation/timeline/timelineProjection";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { useHistoryAnchorActions } from "../src/features/conversation/timeline/historyAnchor";
import {
  useTimelineJumpActions,
  useTimelineJumpState,
} from "../src/features/conversation/timeline/timelineJump";
import { createFullscreenScrollOwnership } from "../src/ui/fullscreen-scroll-ownership";
import { conversationTopContentInset } from "../src/ui/conversation-chrome-layout";
import {
  legendListScrollToEnd,
  legendListScrollToIndex,
  setLegendListAnchorReadyDuringLayout,
  setLegendListWithinEndThreshold,
} from "./mocks/LegendKeyboardList";

const unreadRow = {
  completedAt: null,
  durationMs: null,
  key: "unread",
  kind: "meta",
  status: "completed",
} as const;

function responseTurn(status: "completed" | "inProgress"): Extract<TimelineItem, { kind: "turn" }> {
  const turn: unknown = {
    connectionId: "server",
    id: "response-turn",
    key: "server/thread/response-turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: status === "completed" ? 2 : null,
      durationMs: status === "completed" ? 1 : null,
      id: "response-turn",
      items: [
        {
          clientId: null,
          content: [{ text: "Question", text_elements: [], type: "text" }],
          id: "user-response",
          type: "userMessage",
        },
        {
          id: "agent-response",
          memoryCitation: null,
          phase: status === "completed" ? "final_answer" : "commentary",
          text: "A long response starts here",
          type: "agentMessage",
        },
      ],
      startedAt: 1,
      status,
    },
  };
  // WHY: The generated protocol union has no narrow test factory, while this fixture supplies
  // every turn field consumed by the row projection and response-positioning owner.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return turn as Extract<TimelineItem, { kind: "turn" }>;
}

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
    jumpVisibility: new TimelineJumpVisibility(),
    lastTimelineOffsetYRef: { current: null },
    latestUnreadAgentRef: { current: null },
    latestUnreadAgentTurnId: null,
    liveStatusVisible: false,
    loadNewerAtTimelineEnd: () => undefined,
    loadOlderAtTimelineStart: () => undefined,
    newChat: false,
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
  setLegendListWithinEndThreshold(true);
  setLegendListAnchorReadyDuringLayout(false);
});

afterEach(() => setLegendListAnchorReadyDuringLayout(false));

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
      initialReadCommittedRef: { current: false },
      latestUnreadReceiptKey: null,
      markThreadReadOnOpen: undefined,
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

it("opens an unread response at its first agent row", async () => {
  const props = timelineViewportProps(() => undefined);
  props.displayedTimeline = [responseTurn("completed")];
  props.latestUnreadAgentTurnId = "response-turn";
  props.timelinePositioned = false;
  const view = render(<TimelineViewport {...props} />);
  const timeline = view.getByTestId("conversation-timeline");

  expect(timeline.props.initialScrollAtEnd).toBe(false);
  expect(timeline.props.initialScrollIndex).toBe(1);
  expect(timeline.props.anchoredEndSpace.anchorIndex).toBe(1);
  expect(timeline.props.anchoredEndSpace.anchorOffset).toBe(conversationTopContentInset(false));

  await act(async () => {
    timeline.props.anchoredEndSpace.onReady({
      anchorIndex: 1,
      anchorKey: timelineItemKey(responseTurn("completed")),
      size: 0,
    });
    await Promise.resolve();
  });

  expect(legendListScrollToIndex).toHaveBeenCalledWith({
    animated: false,
    index: 1,
    viewOffset: conversationTopContentInset(false),
    viewPosition: 0,
  });
});

it("moves a completed streamed response to its start only while tail-following", async () => {
  const props = timelineViewportProps(() => undefined);
  props.awayFromLatest = false;
  props.awayFromLatestRef.current = false;
  props.displayedTimeline = [responseTurn("inProgress")];
  const view = render(<TimelineViewport {...props} />);

  expect(view.getByTestId("conversation-timeline").props.anchoredEndSpace).toBeUndefined();

  view.rerender(
    <TimelineViewport
      {...props}
      displayedTimeline={[responseTurn("completed")]}
      latestUnreadAgentTurnId="response-turn"
    />,
  );

  await waitFor(() => {
    expect(view.getByTestId("conversation-timeline").props.anchoredEndSpace.anchorIndex).toBe(1);
  });
});

it("does not pull a completed response back after the user left the tail", () => {
  const props = timelineViewportProps(() => undefined);
  props.awayFromLatest = true;
  props.awayFromLatestRef.current = true;
  props.displayedTimeline = [responseTurn("inProgress")];
  const view = render(<TimelineViewport {...props} />);

  view.rerender(
    <TimelineViewport
      {...props}
      displayedTimeline={[responseTurn("completed")]}
      latestUnreadAgentTurnId="response-turn"
    />,
  );

  expect(view.getByTestId("conversation-timeline").props.anchoredEndSpace).toBeUndefined();
});

it("accepts completion readiness from the child's layout before parent event handlers commit", () => {
  const props = timelineViewportProps(() => undefined);
  props.awayFromLatest = false;
  props.awayFromLatestRef.current = false;
  props.displayedTimeline = [responseTurn("inProgress")];
  const view = render(<TimelineViewport {...props} />);
  setLegendListAnchorReadyDuringLayout(true);

  view.rerender(<TimelineViewport {...props} displayedTimeline={[responseTurn("completed")]} />);

  expect(legendListScrollToIndex).toHaveBeenCalledTimes(1);
  expect(legendListScrollToIndex).toHaveBeenCalledWith({
    animated: false,
    index: 1,
    viewOffset: conversationTopContentInset(false),
    viewPosition: 0,
  });
  expect(view.getByTestId("conversation-timeline").props.initialScrollIndex).toBeUndefined();
});

it("retains the response runway after bootstrap positioning is retired", () => {
  const props = timelineViewportProps(() => undefined);
  props.displayedTimeline = [responseTurn("completed")];
  props.latestUnreadAgentTurnId = "response-turn";
  props.timelinePositioned = false;
  const view = render(<TimelineViewport {...props} />);
  const initial = view.getByTestId("conversation-timeline");
  const ready = {
    anchorIndex: 1,
    anchorKey: timelineItemKey(responseTurn("completed")),
    size: 600,
  };
  expect(initial.props.initialScrollIndex).toBe(1);
  act(() => initial.props.anchoredEndSpace.onReady(ready));

  view.rerender(<TimelineViewport {...props} timelinePositioned />);

  const positioned = view.getByTestId("conversation-timeline");
  expect(positioned.props.initialScrollIndex).toBeUndefined();
  expect(positioned.props.anchoredEndSpace).toMatchObject({
    anchorIndex: 1,
    anchorOffset: conversationTopContentInset(false),
  });
  act(() => positioned.props.anchoredEndSpace.onReady(ready));
  expect(legendListScrollToIndex).toHaveBeenCalledTimes(1);
});

it("does not reapply the response anchor after another size measurement", () => {
  const props = timelineViewportProps(() => undefined);
  props.displayedTimeline = [responseTurn("completed")];
  props.latestUnreadAgentTurnId = "response-turn";
  const view = render(<TimelineViewport {...props} />);
  const anchor = view.getByTestId("conversation-timeline").props.anchoredEndSpace;
  const ready = {
    anchorIndex: 1,
    anchorKey: timelineItemKey(responseTurn("completed")),
    size: 600,
  };
  act(() => {
    anchor.onReady(ready);
    anchor.onReady({ ...ready, size: 350 });
    anchor.onReady({ ...ready, size: 0 });
  });
  expect(legendListScrollToIndex).toHaveBeenCalledTimes(1);
});

it("revokes a pending response jump when a manual gesture starts", () => {
  const props = timelineViewportProps(() => undefined);
  props.displayedTimeline = [responseTurn("completed")];
  props.latestUnreadAgentTurnId = "response-turn";
  const view = render(<TimelineViewport {...props} />);
  const timeline = view.getByTestId("conversation-timeline");
  const onReady = timeline.props.anchoredEndSpace.onReady;
  fireEvent(timeline, "scrollBeginDrag", timelineScrollEvent(0));
  act(() =>
    onReady({ anchorIndex: 1, anchorKey: timelineItemKey(responseTurn("completed")), size: 0 }),
  );
  expect(legendListScrollToIndex).not.toHaveBeenCalled();
  expect(view.getByTestId("conversation-timeline").props.anchoredEndSpace).toBeUndefined();
});

it("keeps new-chat content stationary while the keyboard opens", () => {
  const props = timelineViewportProps(() => undefined);
  props.newChat = true;
  const view = render(<TimelineViewport {...props} />);

  expect(view.getByTestId("conversation-timeline").props.keyboardLiftBehavior).toBe("never");

  view.rerender(<TimelineViewport {...props} newChat={false} />);
  expect(view.getByTestId("conversation-timeline").props.keyboardLiftBehavior).toBe("always");
});

it("preserves the two-percent viewport boundary for tail-follow state", () => {
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

describe("jump control visibility from viewport events", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("uses 12 dp and 200 ms even while the viewport remains inside the tail-follow threshold", () => {
    const props = timelineViewportProps(() => undefined);
    props.awayFromLatest = false;
    props.awayFromLatestRef.current = false;
    props.setAwayFromLatest = jest.fn();
    const view = render(
      <>
        <TimelineViewport {...props} />
        <JumpToLatest
          bottomChromeHeight={0}
          jumpTimelineToLatest={jest.fn()}
          jumpVisibility={props.jumpVisibility}
          newItemCount={0}
        />
      </>,
    );
    const timeline = view.getByTestId("conversation-timeline");
    const atDistance = (distance: number) => ({
      nativeEvent: {
        contentOffset: { x: 0, y: 1_000 - distance },
        contentSize: { width: 400, height: 2_000 },
        layoutMeasurement: { width: 400, height: 1_000 },
      },
    });
    fireEvent.scroll(timeline, atDistance(13));
    act(() => jest.advanceTimersByTime(199));
    expect(view.queryByTestId("jump-to-latest")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByTestId("jump-to-latest")).toBeTruthy();
    expect(props.setAwayFromLatest).not.toHaveBeenCalled();
    fireEvent.scroll(timeline, atDistance(12));
    expect(view.queryByTestId("jump-to-latest")).toBeNull();
    expect(legendListScrollToEnd).not.toHaveBeenCalled();
    expect(legendListScrollToIndex).not.toHaveBeenCalled();
  });

  it("reconciles visibility when content or viewport size changes without another scroll", () => {
    const props = timelineViewportProps(() => undefined);
    const view = render(<TimelineViewport {...props} />);
    const list = props.timelineRef.current;
    if (list === null) {
      throw new Error("Expected a mounted timeline ref");
    }
    const distance = jest.spyOn(list, "getDistanceFromEnd").mockReturnValue(40);
    const timeline = view.getByTestId("conversation-timeline");
    fireEvent(timeline, "load", { elapsedTimeInMs: 1 });
    act(() => jest.advanceTimersByTime(200));
    expect(props.jumpVisibility.visible$.get()).toBe(true);
    distance.mockReturnValue(0);
    fireEvent(timeline, "contentSizeChange", 400, 600);
    expect(props.jumpVisibility.visible$.get()).toBe(false);
    distance.mockReturnValue(40);
    fireEvent(timeline, "layout", { nativeEvent: { layout: { height: 600 } } });
    act(() => jest.advanceTimersByTime(200));
    expect(props.jumpVisibility.visible$.get()).toBe(true);
  });
});

it("clears the latest indicator when the final history range arrives without a scroll", () => {
  const setAwayFromLatest = jest.fn();
  const persistTimelineAtEnd = jest.fn();
  const props = timelineViewportProps(() => undefined);
  props.setAwayFromLatest = setAwayFromLatest;
  props.persistTimelineAtEnd = persistTimelineAtEnd;
  props.historyViewport = { ...COMPLETE_STATIC_THREAD_HISTORY, containsLatest: false };
  const view = render(<TimelineViewport {...props} />);
  fireEvent(view.getByTestId("conversation-timeline"), "load", { elapsedTimeInMs: 1 });

  view.rerender(
    <TimelineViewport
      {...props}
      historyViewport={{ ...COMPLETE_STATIC_THREAD_HISTORY, containsLatest: true }}
    />,
  );

  expect(setAwayFromLatest).toHaveBeenLastCalledWith(false);
  expect(props.awayFromLatestRef.current).toBe(false);
  expect(persistTimelineAtEnd).toHaveBeenCalledTimes(1);
});

it("keeps the indicator while genuinely away and clears it after list resize reaches the end", () => {
  setLegendListWithinEndThreshold(false);
  const setAwayFromLatest = jest.fn();
  const props = timelineViewportProps(() => undefined);
  props.awayFromLatest = false;
  props.awayFromLatestRef.current = false;
  props.setAwayFromLatest = setAwayFromLatest;
  const view = render(<TimelineViewport {...props} />);
  const timeline = view.getByTestId("conversation-timeline");
  fireEvent(timeline, "scroll", timelineScrollEvent(700));
  fireEvent(timeline, "load", { elapsedTimeInMs: 1 });

  expect(props.awayFromLatestRef.current).toBe(true);
  expect(setAwayFromLatest).toHaveBeenCalledTimes(1);
  expect(setAwayFromLatest).toHaveBeenLastCalledWith(true);

  act(() => setLegendListWithinEndThreshold(true));

  expect(setAwayFromLatest).toHaveBeenCalledWith(false);
  expect(props.awayFromLatestRef.current).toBe(false);
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

it("loads the authoritative latest range once before asking LegendList to reveal a new turn", async () => {
  jest.useFakeTimers();
  let finishLoading: () => void = () => undefined;
  const latestRange = new Promise<void>((resolve) => {
    finishLoading = () => resolve();
  });
  const events: string[] = [];
  const loadLatest = jest.fn(async () => {
    events.push("load-requested");
    await latestRange;
    events.push("range-ready");
  });
  legendListScrollToEnd.mockImplementationOnce(async () => {
    events.push("scroll-to-end");
    return undefined;
  });
  const historyViewport = { ...COMPLETE_STATIC_THREAD_HISTORY, loadLatest };
  const props = timelineViewportProps(() => undefined);
  function JumpProbe() {
    const state = useTimelineJumpState("server\u0000thread");
    const jump = useTimelineJumpActions({
      ...state,
      conversationOwner: { hasReplacement: () => false, isCurrent: () => true },
      draftConnectionId: "server",
      draftThreadId: "thread",
      fullscreenScrollOwnership: createFullscreenScrollOwnership(() => undefined),
      historyViewport,
      latestUnreadAgentTurnId: null,
      searchWindow: null,
      timeline: [],
      timelineModelReady: true,
    });
    return (
      <View>
        <Pressable onPress={jump.jumpTimelineToLatest} testID="jump-latest" />
        <TimelineViewport
          {...props}
          completeTimelineJump={jump.completeTimelineJump}
          historyViewport={historyViewport}
          timelineJumpRequest={jump.timelineJumpRequest}
        />
      </View>
    );
  }
  try {
    const view = render(<JumpProbe />);
    fireEvent.press(view.getByTestId("jump-latest"));
    fireEvent.press(view.getByTestId("jump-latest"));
    // Allow multiple layout frames to run while the requested range is still loading.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(loadLatest).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["load-requested"]);
    expect(legendListScrollToEnd).not.toHaveBeenCalled();
    expect(legendListScrollToIndex).not.toHaveBeenCalled();

    await act(async () => {
      finishLoading();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(events).toEqual(["load-requested", "range-ready", "scroll-to-end"]);
    expect(legendListScrollToEnd).toHaveBeenCalledTimes(1);
    expect(legendListScrollToEnd).toHaveBeenCalledWith({ animated: false });
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it("keeps timeline keyboard behavior independent of the docked question editor", () => {
  const props = timelineViewportProps(() => undefined);
  const view = render(<TimelineViewport {...props} newChat={false} />);
  expect(view.getByTestId("conversation-timeline").props.maintainScrollAtEnd).toBe(true);
  expect(view.getByTestId("conversation-timeline").props.keyboardLiftBehavior).toBe("always");
  expect(view.getByTestId("conversation-timeline").props.maintainVisibleContentPosition).toBe(true);
});
