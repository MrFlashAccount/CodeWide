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
  readonly onScrollBeginDrag: () => void;
  readonly onScrollEndDrag: ThreadListScrollSettlement;
  readonly rows: readonly Row[];
};

const MOMENTUM_START_GRACE_MS = 100;

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

/** Defers structural row updates until the active drag or momentum scroll has settled. */
export function useThreadListScrollController<Row>(
  rows: readonly Row[],
  scopeKey: string,
  onOffsetChange: (offset: number) => void,
): ThreadListScrollController<Row> {
  const [frozenRows, setFrozenRows] = useState<FrozenThreadListRows<Row> | null>(null);
  const releaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleScrollOffset = useThreadListScrollSettlement(onOffsetChange);

  const cancelPendingRelease = useEvent(() => {
    if (releaseTimeoutRef.current !== null) {
      clearTimeout(releaseTimeoutRef.current);
      releaseTimeoutRef.current = null;
    }
  });
  const freezeRows = useEvent(() => {
    cancelPendingRelease();
    setFrozenRows((current) => (current?.scopeKey === scopeKey ? current : { rows, scopeKey }));
  });
  const releaseRows = useEvent(() => {
    cancelPendingRelease();
    setFrozenRows(null);
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

  useEffect(() => cancelPendingRelease, [cancelPendingRelease]);

  return {
    onMomentumScrollBegin: freezeRows,
    onMomentumScrollEnd,
    onScrollBeginDrag: freezeRows,
    onScrollEndDrag,
    rows: frozenRows?.scopeKey === scopeKey ? frozenRows.rows : rows,
  };
}
