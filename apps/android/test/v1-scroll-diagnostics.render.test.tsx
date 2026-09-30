import { act, fireEvent, render, renderHook } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { createRef } from "react";
import { Text } from "react-native";
import { resetOperationalMetricsForTests } from "../src/data/operational-metrics";
import { resetTelemetryForTests, setTelemetryEnabled } from "../src/data/telemetry";
import { TimelineScrollDiagnostics } from "../src/data/timelineScrollDiagnostics";
import { TimelineScrollJournal } from "../src/data/timelineScrollJournal";
import { useSnapshotDiagnosticAction } from "../src/features/diagnostics/snapshotDiagnosticAction";
import * as performanceMetrics from "../src/native/performance-metrics";
import {
  ThreadTimelineList,
  type ThreadTimelineListRef,
} from "../src/rendering/ThreadTimelineList";
import {
  legendListScrollToEnd,
  legendListScrollToIndex,
  legendListScrollToOffset,
} from "./mocks/LegendKeyboardList";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => undefined) }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetTelemetryForTests();
  resetOperationalMetricsForTests();
  setTelemetryEnabled(false);
});

afterEach(() => {
  resetTelemetryForTests();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const listProps = {
  data: [{ id: "message-1", text: "PRIVATE MESSAGE MUST NOT APPEAR IN REPORT" }],
  itemSizeEstimate: 480,
  keyExtractor: (item: { id: string }) => item.id,
  renderItem: ({ item }: { item: { text: string } }) => <Text>{item.text}</Text>,
  renderRevision: "conversation-1",
  testID: "timeline",
};

function scrollEvent(offsetY: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: offsetY },
      contentSize: { width: 400, height: 5000 },
      layoutMeasurement: { width: 400, height: 600 },
    },
  };
}

it("forwards original command options once and records each semantic source without leaking content", async () => {
  const journal = new TimelineScrollJournal();
  const diagnostics = new TimelineScrollDiagnostics("server", "thread", journal);
  const ref = createRef<ThreadTimelineListRef>();
  const view = render(<ThreadTimelineList {...listProps} diagnostics={diagnostics} ref={ref} />);
  await act(async () => {
    await ref.current?.scrollToEnd({ animated: false }, "jump-end");
    await ref.current?.scrollToIndex(
      { index: 0, viewOffset: 60, viewPosition: 0 },
      "response-start",
    );
    await ref.current?.scrollToOffset({ offset: 250 }, "search-restore");
  });
  expect(legendListScrollToEnd).toHaveBeenCalledTimes(1);
  expect(legendListScrollToEnd).toHaveBeenCalledWith({ animated: false });
  expect(legendListScrollToIndex).toHaveBeenCalledTimes(1);
  expect(legendListScrollToIndex).toHaveBeenCalledWith({
    index: 0,
    viewOffset: 60,
    viewPosition: 0,
  });
  expect(legendListScrollToOffset).toHaveBeenCalledTimes(1);
  expect(legendListScrollToOffset).toHaveBeenCalledWith({ offset: 250 });
  const commands = journal
    .snapshot()
    .samples.filter((event) => event.name === "chat.scroll.command");
  expect(commands.map((event) => event.tags)).toEqual([
    { phase: "issued", source: "jump-end", target: "end" },
    { phase: "resolved", source: "jump-end", target: "end" },
    { phase: "issued", source: "response-start", target: "index" },
    { phase: "resolved", source: "response-start", target: "index" },
    { phase: "issued", source: "search-restore", target: "offset" },
    { phase: "resolved", source: "search-restore", target: "offset" },
  ]);
  expect(commands[0]?.values).toMatchObject({
    listAvailable: 1,
    offsetY: 100,
    contentHeightPx: 480,
    viewportHeightPx: 600,
  });
  expect(JSON.stringify(journal.snapshot())).not.toContain(listProps.data[0]?.text);
  view.unmount();
});

it("links native tags and records library dispatches without issuing a scroll or retaining arbitrary payload", () => {
  const journal = new TimelineScrollJournal();
  const diagnostics = new TimelineScrollDiagnostics("server", "thread", journal);
  const view = render(<ThreadTimelineList {...listProps} diagnostics={diagnostics} />);
  const target = view.getByTestId("timeline");
  fireEvent(target, "scroll", { ...scrollEvent(400), target: 42 });
  fireEvent(target, "scrollDiagnostic", {
    animated: false,
    contentHeightPx: 5000,
    initial: true,
    initialPending: true,
    logicalOffsetPx: 400,
    maintainingEnd: false,
    nativeCorrectionPending: false,
    offsetPx: 4400,
    phase: "dispatch",
    rowCount: 26,
    viewportHeightPx: 600,
    text: "PRIVATE",
    data: listProps.data,
  });
  fireEvent(target, "scrollDiagnostic", { phase: "PRIVATE" });
  expect(journal.snapshot().samples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "chat.scroll.native-view", values: { viewTag: 42 } }),
      expect.objectContaining({
        name: "chat.scroll.library-command",
        tags: { phase: "dispatch", source: "legend-list" },
        values: expect.objectContaining({ initial: 1, offsetPx: 4400 }),
      }),
    ]),
  );
  expect(
    journal.snapshot().samples.filter((event) => event.name === "chat.scroll.library-command"),
  ).toHaveLength(1);
  expect(JSON.stringify(journal.snapshot())).not.toContain("PRIVATE");
  expect(legendListScrollToEnd).not.toHaveBeenCalled();
  expect(legendListScrollToIndex).not.toHaveBeenCalled();
  expect(legendListScrollToOffset).not.toHaveBeenCalled();
  view.unmount();
});

it("records MVCP commit calculations separately and rejects invalid or private fields", () => {
  const journal = new TimelineScrollJournal();
  const diagnostics = new TimelineScrollDiagnostics("server", "thread", journal);
  const view = render(<ThreadTimelineList {...listProps} diagnostics={diagnostics} />);
  const target = view.getByTestId("timeline");
  const adjustment = {
    phase: "adjustment",
    clampCompensationPx: 300,
    contentHeightPx: 4400,
    lastNativeOffsetPx: 4100,
    logicalOffsetPx: 3500,
    pendingDataAppliedPx: null,
    requestedDeltaPx: -600,
    rowCount: 97,
    sentinelDeltaPx: -300,
    viewportHeightPx: 600,
    text: "PRIVATE",
    data: listProps.data,
  };
  fireEvent(target, "scrollDiagnostic", adjustment);
  for (const invalid of [
    { requestedDeltaPx: Number.NaN },
    { rowCount: 1.5 },
    { lastNativeOffsetPx: "PRIVATE" },
    { pendingDataAppliedPx: Number.POSITIVE_INFINITY },
    { phase: "PRIVATE" },
  ]) {
    fireEvent(target, "scrollDiagnostic", { ...adjustment, ...invalid });
  }
  fireEvent(target, "scrollDiagnostic", {
    ...adjustment,
    lastNativeOffsetPx: null,
    pendingDataAppliedPx: 0,
  });
  const adjustments = journal
    .snapshot()
    .samples.filter((event) => event.name === "chat.scroll.library-adjustment");
  expect(adjustments).toEqual([
    expect.objectContaining({
      name: "chat.scroll.library-adjustment",
      tags: { phase: "react-commit", source: "legend-list" },
      values: expect.objectContaining({
        clampCompensationPx: 300,
        lastNativeKnown: 1,
        lastNativeOffsetPx: 4100,
        logicalOffsetPx: 3500,
        nativeCorrectionPending: 0,
        requestedDeltaPx: -600,
        rowCount: 97,
        sentinelDeltaPx: -300,
      }),
    }),
    expect.objectContaining({
      values: expect.objectContaining({
        lastNativeKnown: 0,
        nativeCorrectionPending: 1,
        pendingDataAppliedPx: 0,
      }),
    }),
  ]);
  expect(JSON.stringify(journal.snapshot())).not.toContain("PRIVATE");
  expect(legendListScrollToEnd).not.toHaveBeenCalled();
  expect(legendListScrollToIndex).not.toHaveBeenCalled();
  expect(legendListScrollToOffset).not.toHaveBeenCalled();
  view.unmount();
});

it("validates LegendList performance timings and omits arbitrary dependency payload", () => {
  const journal = new TimelineScrollJournal();
  const diagnostics = new TimelineScrollDiagnostics("server", "thread", journal);
  const view = render(<ThreadTimelineList {...listProps} diagnostics={diagnostics} />);
  const target = view.getByTestId("timeline");
  const calculation = {
    dataChanged: false,
    doMVCP: true,
    durationMs: 8,
    forceFullItemPositions: false,
    phase: "calculate",
    positionDurationMs: 3,
    positionStartIndex: 10,
    rowCount: 50,
    visibleEndIndex: 18,
    visibleStartIndex: 12,
    data: listProps.data,
    text: "PRIVATE",
  };
  fireEvent(target, "scrollDiagnostic", calculation);
  fireEvent(target, "scrollDiagnostic", { ...calculation, durationMs: -1 });
  fireEvent(target, "scrollDiagnostic", {
    changedCount: 2,
    durationMs: 5,
    measurementCount: 3,
    needsRecalculate: true,
    phase: "size-batch",
    rowCount: 50,
    text: "PRIVATE",
  });
  fireEvent(target, "scrollDiagnostic", {
    changedCount: 2,
    durationMs: 5,
    measurementCount: 1.5,
    needsRecalculate: true,
    phase: "size-batch",
    rowCount: 50,
  });

  const events = journal
    .snapshot()
    .samples.filter((event) => event.name === "chat.scroll.library-performance");
  expect(events).toHaveLength(2);
  expect(events.map((event) => event.tags.phase)).toEqual(["calculate", "size-batch"]);
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
  view.unmount();
});

it("records failed commands while preserving the original rejection, without logging error content", async () => {
  const journal = new TimelineScrollJournal();
  const diagnostics = new TimelineScrollDiagnostics("server", "thread", journal);
  const ref = createRef<ThreadTimelineListRef>();
  const view = render(<ThreadTimelineList {...listProps} diagnostics={diagnostics} ref={ref} />);
  const failure = new Error("PRIVATE LIBRARY ERROR");
  legendListScrollToEnd.mockRejectedValueOnce(failure);
  await expect(ref.current?.scrollToEnd({ animated: false }, "jump-end")).rejects.toBe(failure);
  expect(journal.snapshot().samples.at(-1)).toMatchObject({
    name: "chat.scroll.command",
    tags: { phase: "rejected", source: "jump-end" },
  });
  expect(JSON.stringify(journal.snapshot())).not.toContain(failure.message);
  view.unmount();
});

it("observes one-frame native rebounds and forwards gestures without issuing corrective scrolls", async () => {
  const journal = new TimelineScrollJournal();
  const diagnostics = new TimelineScrollDiagnostics("server", "thread", journal);
  const ref = createRef<ThreadTimelineListRef>();
  const onScroll = jest.fn();
  const onScrollBeginDrag = jest.fn();
  const onScrollEndDrag = jest.fn();
  const onMomentumScrollBegin = jest.fn();
  const onMomentumScrollEnd = jest.fn();
  const onLayout = jest.fn();
  const onContentSizeChange = jest.fn();
  const callbacks = {
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onLayout,
    onContentSizeChange,
  };
  const view = render(
    <ThreadTimelineList {...listProps} {...callbacks} diagnostics={diagnostics} ref={ref} />,
  );
  await act(async () => {
    await ref.current?.scrollToEnd({ animated: false }, "jump-end");
  });
  const list = view.getByTestId("timeline");
  fireEvent.scroll(list, scrollEvent(4400));
  act(() => jest.advanceTimersByTime(16));
  fireEvent.scroll(list, scrollEvent(0));
  expect(journal.snapshot().lastRebound.at(-1)).toMatchObject({
    name: "chat.scroll.rebound",
    values: { elapsedMs: 16, fromOffsetY: 4400, offsetY: 0 },
  });
  fireEvent(list, "scrollBeginDrag", scrollEvent(0));
  fireEvent(list, "scrollEndDrag", scrollEvent(200));
  fireEvent(list, "momentumScrollBegin", scrollEvent(200));
  fireEvent(list, "momentumScrollEnd", scrollEvent(350));
  fireEvent(list, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } } });
  fireEvent(list, "contentSizeChange", 400, 5000);
  expect(onScroll).toHaveBeenCalledTimes(2);
  for (const callback of [
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onLayout,
    onContentSizeChange,
  ])
    expect(callback).toHaveBeenCalledTimes(1);
  expect(legendListScrollToEnd).toHaveBeenCalledTimes(1);
  expect(legendListScrollToIndex).not.toHaveBeenCalled();
  expect(legendListScrollToOffset).not.toHaveBeenCalled();
  expect(
    journal
      .snapshot()
      .samples.filter((event) => event.name === "chat.scroll.layout")
      .map((event) => event.tags.source),
  ).toEqual(["viewport", "content"]);
  view.unmount();
});

it("keeps a pending command attributed to its original conversation when the list is replaced", async () => {
  let resolveCommand = () => undefined;
  legendListScrollToEnd.mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        resolveCommand = () => resolve(undefined);
      }),
  );
  const journal = new TimelineScrollJournal();
  const first = new TimelineScrollDiagnostics("server", "first-thread", journal);
  const second = new TimelineScrollDiagnostics("server", "second-thread", journal);
  const ref = createRef<ThreadTimelineListRef>();
  const view = render(
    <ThreadTimelineList {...listProps} diagnostics={first} ref={ref} key="first" />,
  );
  const pending = ref.current?.scrollToEnd({ animated: false }, "jump-end");
  view.rerender(<ThreadTimelineList {...listProps} diagnostics={second} ref={ref} key="second" />);
  await act(async () => {
    resolveCommand();
    await pending;
  });
  const commands = journal
    .snapshot()
    .samples.filter((event) => event.name === "chat.scroll.command");
  expect(commands).toHaveLength(2);
  expect(commands.every((event) => event.threadId === "first-thread")).toBe(true);
  expect(commands[1]?.values.listAvailable).toBe(0);
  view.unmount();
});

it("exports the retained timeline and metrics through Copy scroll report after leaving the chat with HUD off", async () => {
  const nativeReport = { evicted: 0, incidents: [], version: 1 } as const;
  const readNativeScroll = jest
    .spyOn(performanceMetrics, "getTimelineScrollReport")
    .mockResolvedValue(nativeReport);
  const diagnostics = new TimelineScrollDiagnostics("copy-server", "copy-thread");
  const ref = createRef<ThreadTimelineListRef>();
  const view = render(<ThreadTimelineList {...listProps} diagnostics={diagnostics} ref={ref} />);
  await act(async () => {
    await ref.current?.scrollToEnd({ animated: false }, "jump-end");
  });
  fireEvent.scroll(view.getByTestId("timeline"), scrollEvent(4400));
  act(() => jest.advanceTimersByTime(16));
  fireEvent.scroll(view.getByTestId("timeline"), scrollEvent(0));
  view.unmount();
  const setError = jest.fn();
  const hook = renderHook(() =>
    useSnapshotDiagnosticAction(performanceMetrics.usePerformanceMetrics(), setError),
  );
  await act(async () => {
    await hook.result.current.copySnapshot();
  });
  const serialized = jest.mocked(Clipboard.setStringAsync).mock.calls[0]?.[0];
  expect(typeof serialized).toBe("string");
  const report: unknown = JSON.parse(serialized ?? "null");
  expect(report).toMatchObject({
    nativeTimelineScroll: nativeReport,
    streaming: { counters: { timeline_scroll_commands: 1, timeline_scroll_rebounds: 1 } },
    timelineScroll: {
      lastRebound: expect.arrayContaining([
        expect.objectContaining({ name: "chat.scroll.rebound", threadId: "copy-thread" }),
      ]),
      samples: expect.arrayContaining([
        expect.objectContaining({ name: "chat.scroll.lifecycle", tags: { phase: "unmounted" } }),
      ]),
    },
  });
  expect(serialized).not.toContain(listProps.data[0]?.text);
  expect(readNativeScroll).toHaveBeenCalledTimes(1);
  expect(setError).toHaveBeenCalledWith(null);
  expect(hook.result.current.snapshotCopied).toBe(true);
  hook.unmount();
});
