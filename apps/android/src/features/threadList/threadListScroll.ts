import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useEffect, useRef, useState } from "react";

import { useEvent } from "../../react/useEvent";

type ThreadListScrollSettlement = (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

type FrozenThreadListRows<Row> = {
  readonly rows: readonly Row[];
  readonly scopeKey: string;
};

type ThreadListScrollController<Row> = {
  readonly onMomentumScrollBegin: () => void;
  readonly onMomentumScrollEnd: ThreadListScrollSettlement;
  /** Keeps a gesture's order frozen while it still scrolls. */
  readonly onScroll: () => void;
  readonly onScrollBeginDrag: () => void;
  readonly onScrollEndDrag: ThreadListScrollSettlement;
  readonly rows: readonly Row[];
};

const MOMENTUM_START_GRACE_MS = 100;
/**
 * A gesture whose end event never arrives (a wrapping gesture took the touch)
 * releases its frozen order after this long without a scroll event.
 */
const IDLE_RELEASE_MS = 1500;

/** Keeps the visible chat anchored while live activity reorders rows above it. */
export const THREAD_LIST_VISIBLE_CONTENT_POSITION = { data: true, size: false } as const;

/** Persists one settled offset instead of adding application work to the scroll hot path. */
function useThreadListScrollSettlement(
  onOffsetChange: (offset: number) => void,
): ThreadListScrollSettlement {
  return useEvent((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    onOffsetChange(Math.max(0, event.nativeEvent.contentOffset.y));
  });
}

/**
 * Defers live reordering during a gesture while admitting newly loaded tail
 * rows. Only the order is frozen: every row shows its latest content, so an
 * unread mark or preview never waits for the gesture to settle.
 */
export function useThreadListScrollController<Row>(
  rows: readonly Row[],
  scopeKey: string,
  {
    keyFor,
    onOffsetChange,
  }: { keyFor: (row: Row) => string; onOffsetChange: (offset: number) => void },
): ThreadListScrollController<Row> {
  const [frozenRows, setFrozenRows] = useState<FrozenThreadListRows<Row> | null>(null);
  const releaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleScrollOffset = useThreadListScrollSettlement(onOffsetChange);

  const cancelPendingRelease = useEvent(() => {
    if (releaseTimeoutRef.current !== null) {
      clearTimeout(releaseTimeoutRef.current);
      releaseTimeoutRef.current = null;
    }
  });
  const cancelIdleRelease = useEvent(() => {
    if (idleTimeoutRef.current !== null) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  });
  const releaseRows = useEvent(() => {
    cancelPendingRelease();
    cancelIdleRelease();
    setFrozenRows(null);
  });
  const armIdleRelease = useEvent(() => {
    cancelIdleRelease();
    idleTimeoutRef.current = setTimeout(releaseRows, IDLE_RELEASE_MS);
  });
  const freezeRows = useEvent(() => {
    cancelPendingRelease();
    armIdleRelease();
    setFrozenRows((current) => (current?.scopeKey === scopeKey ? current : { rows, scopeKey }));
  });
  const onScroll = useEvent(() => {
    if (idleTimeoutRef.current !== null) {
      armIdleRelease();
    }
  });
  const onScrollEndDrag = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    settleScrollOffset(event);
    cancelPendingRelease();
    releaseTimeoutRef.current = setTimeout(releaseRows, MOMENTUM_START_GRACE_MS);
  });
  const onMomentumScrollEnd = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    settleScrollOffset(event);
    releaseRows();
  });

  useEffect(
    () => () => {
      cancelPendingRelease();
      cancelIdleRelease();
    },
    [cancelPendingRelease, cancelIdleRelease],
  );

  return {
    onMomentumScrollBegin: freezeRows,
    onMomentumScrollEnd,
    onScroll,
    onScrollBeginDrag: freezeRows,
    onScrollEndDrag,
    rows:
      frozenRows?.scopeKey === scopeKey
        ? appendLoadedTail(withLatestContent(frozenRows.rows, rows, keyFor), rows, keyFor)
        : rows,
  };
}

/** The frozen order with each row's latest content; the frozen array when none changed. */
function withLatestContent<Row>(
  frozen: readonly Row[],
  latest: readonly Row[],
  keyFor: (row: Row) => string,
): readonly Row[] {
  const byKey = new Map(latest.map((row) => [keyFor(row), row]));
  const current = frozen.map((row) => byKey.get(keyFor(row)) ?? row);
  return current.some((row, index) => row !== frozen[index]) ? current : frozen;
}

function appendLoadedTail<Row>(
  frozen: readonly Row[],
  latest: readonly Row[],
  keyFor: (row: Row) => string,
): readonly Row[] {
  const last = frozen.at(-1);
  if (last === undefined) {
    return latest;
  }
  const boundary = latest.findIndex((row) => keyFor(row) === keyFor(last));
  if (boundary < 0 || boundary === latest.length - 1) {
    return frozen;
  }
  const retained = new Set(frozen.map(keyFor));
  const appended = latest.slice(boundary + 1).filter((row) => !retained.has(keyFor(row)));
  return appended.length === 0 ? frozen : [...frozen, ...appended];
}
