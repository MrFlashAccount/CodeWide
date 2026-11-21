import { act, renderHook } from "@testing-library/react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import {
  THREAD_LIST_VISIBLE_CONTENT_POSITION,
  useThreadListScrollController,
} from "../src/features/threadList/threadListScroll";

type Row = { readonly id: string };

function scrollEvent(offsetY: number): NativeSyntheticEvent<NativeScrollEvent> {
  // WHY: The controller consumes only contentOffset; constructing React Native's host-owned synthetic event is impossible in the Node render runtime.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    nativeEvent: { contentOffset: { x: 0, y: offsetY } },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("keeps one row snapshot through drag and momentum, then publishes the latest order", () => {
  const initialRows: readonly Row[] = [{ id: "first" }, { id: "second" }];
  const reorderedRows: readonly Row[] = [{ id: "second" }, { id: "first" }];
  const onOffsetChange = jest.fn();
  const hook = renderHook(
    ({ rows }) =>
      useThreadListScrollController(rows, "active", { keyFor: (row) => row.id, onOffsetChange }),
    { initialProps: { rows: initialRows } },
  );

  act(() => hook.result.current.onScrollBeginDrag());
  hook.rerender({ rows: reorderedRows });
  // The gesture keeps its order; each row is the latest one of its key.
  const frozenOrder = (): readonly string[] => hook.result.current.rows.map((row) => row.id);
  expect(frozenOrder()).toEqual(["first", "second"]);
  expect(hook.result.current.rows[0]).toBe(reorderedRows[1]);

  act(() => hook.result.current.onScrollEndDrag(scrollEvent(80)));
  act(() => hook.result.current.onMomentumScrollBegin());
  act(() => jest.advanceTimersByTime(1_000));
  expect(frozenOrder()).toEqual(["first", "second"]);

  act(() => hook.result.current.onMomentumScrollEnd(scrollEvent(24)));
  expect(hook.result.current.rows).toBe(reorderedRows);
  expect(onOffsetChange).toHaveBeenNthCalledWith(1, 80);
  expect(onOffsetChange).toHaveBeenNthCalledWith(2, 24);
});

it("releases the snapshot when a drag finishes without momentum", () => {
  const initialRows: readonly Row[] = [{ id: "first" }];
  const nextRows: readonly Row[] = [{ id: "second" }];
  const hook = renderHook(
    ({ rows }) =>
      useThreadListScrollController(rows, "active", {
        keyFor: (row) => row.id,
        onOffsetChange: () => undefined,
      }),
    { initialProps: { rows: initialRows } },
  );

  act(() => hook.result.current.onScrollBeginDrag());
  hook.rerender({ rows: nextRows });
  act(() => hook.result.current.onScrollEndDrag(scrollEvent(12)));
  act(() => jest.advanceTimersByTime(99));
  expect(hook.result.current.rows).toBe(initialRows);

  act(() => jest.advanceTimersByTime(1));
  expect(hook.result.current.rows).toBe(nextRows);
});

it("never carries a frozen snapshot into another list scope", () => {
  const initialRows: readonly Row[] = [{ id: "first" }];
  const otherScopeRows: readonly Row[] = [{ id: "other" }];
  const hook = renderHook(
    ({ rows, scopeKey }) =>
      useThreadListScrollController(rows, scopeKey, {
        keyFor: (row) => row.id,
        onOffsetChange: () => undefined,
      }),
    { initialProps: { rows: initialRows, scopeKey: "active" } },
  );

  act(() => hook.result.current.onScrollBeginDrag());
  hook.rerender({ rows: otherScopeRows, scopeKey: "archive" });

  expect(hook.result.current.rows).toBe(otherScopeRows);
  expect(THREAD_LIST_VISIBLE_CONTENT_POSITION).toEqual({ data: true, size: false });
});

it("admits older pages during momentum while keeping existing rows in their gesture order", () => {
  const initialRows: readonly Row[] = [{ id: "first" }, { id: "second" }];
  const nextRows: readonly Row[] = [{ id: "second" }, { id: "first" }, { id: "older" }];
  const hook = renderHook(
    ({ rows }) =>
      useThreadListScrollController(rows, "active", {
        keyFor: (row) => row.id,
        onOffsetChange: () => undefined,
      }),
    { initialProps: { rows: initialRows } },
  );
  act(() => hook.result.current.onMomentumScrollBegin());
  hook.rerender({ rows: nextRows });
  expect(hook.result.current.rows.map((row) => row.id)).toEqual(["first", "second", "older"]);
  act(() => hook.result.current.onMomentumScrollEnd(scrollEvent(120)));
  expect(hook.result.current.rows).toBe(nextRows);
});

type ContentRow = { readonly id: string; readonly unread: number };

it("shows each row's latest content while the gesture keeps its order", () => {
  const initialRows: readonly ContentRow[] = [
    { id: "first", unread: 1 },
    { id: "second", unread: 0 },
  ];
  const nextRows: readonly ContentRow[] = [
    { id: "second", unread: 1 },
    { id: "first", unread: 0 },
  ];
  const hook = renderHook(
    ({ rows }) =>
      useThreadListScrollController(rows, "active", {
        keyFor: (row) => row.id,
        onOffsetChange: () => undefined,
      }),
    { initialProps: { rows: initialRows } },
  );
  act(() => hook.result.current.onScrollBeginDrag());
  hook.rerender({ rows: nextRows });
  expect(hook.result.current.rows).toEqual([
    { id: "first", unread: 0 },
    { id: "second", unread: 1 },
  ]);
});

it("releases a gesture whose end event never arrives once it stops scrolling", () => {
  const initialRows: readonly Row[] = [{ id: "first" }, { id: "second" }];
  const nextRows: readonly Row[] = [{ id: "second" }, { id: "first" }];
  const hook = renderHook(
    ({ rows }) =>
      useThreadListScrollController(rows, "active", {
        keyFor: (row) => row.id,
        onOffsetChange: () => undefined,
      }),
    { initialProps: { rows: initialRows } },
  );
  act(() => hook.result.current.onScrollBeginDrag());
  hook.rerender({ rows: nextRows });
  // Scrolling keeps the order frozen past the idle window.
  act(() => jest.advanceTimersByTime(1_000));
  act(() => hook.result.current.onScroll());
  act(() => jest.advanceTimersByTime(1_000));
  expect(hook.result.current.rows.map((row) => row.id)).toEqual(["first", "second"]);
  // A wrapping gesture took the touch: no end event, no further scrolling.
  act(() => jest.advanceTimersByTime(500));
  expect(hook.result.current.rows).toBe(nextRows);
});
