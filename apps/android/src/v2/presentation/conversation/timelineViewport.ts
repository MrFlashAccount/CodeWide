import { useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { ThreadTimelineListRef } from "./threadTimelineList";
import type { TimelineDisplayTurn } from "./timelineTypes";

export type TimelineEdge = "newer" | "older";

interface TimelineViewportInput {
  canLoadNewer: boolean;
  canLoadOlder: boolean;
  onJumpToLatest?(): Promise<string | null> | string | null;
  onLoadNewer?(): Promise<void>;
  onLoadOlder?(): Promise<void>;
  onReachedLatest?(): void;
  onSettleWindow?(direction: TimelineEdge): void;
  listRef: React.RefObject<ThreadTimelineListRef | null>;
  turns: TimelineDisplayTurn[];
  unreadCount: number;
}

export interface TimelineViewportModel {
  awayFromLatest: boolean;
  beginGesture(): void;
  contentSizeChanged(): void;
  endGesture(): void;
  handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  jumpToLatest(): Promise<void>;
  loadError: TimelineEdge | null;
  loadNewer(): void;
  loadOlder(): void;
  loadingEdge: TimelineEdge | null;
  unseenCount: number;
}

const LATEST_THRESHOLD_PX = 48;

export function useTimelineViewport(input: TimelineViewportInput): TimelineViewportModel {
  const {
    canLoadNewer,
    canLoadOlder,
    onJumpToLatest,
    onLoadNewer,
    onLoadOlder,
    onReachedLatest,
    onSettleWindow,
    listRef,
    turns,
    unreadCount,
  } = input;
  const activeLoadRef = useRef<TimelineEdge | null>(null);
  const loadedEdgeRef = useRef<TimelineEdge | null>(null);
  const gestureActiveRef = useRef(false);
  const [loadingEdge, setLoadingEdge] = useState<TimelineEdge | null>(null);
  const [loadError, setLoadError] = useState<TimelineEdge | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [lastSeenTailId, setLastSeenTailId] = useState(() => tailTurnId(turns));
  const unseenCount = Math.max(unreadCount, turnsAfter(turns, lastSeenTailId));

  const settleLoadedEdge = useEvent(() => {
    const edge = loadedEdgeRef.current;
    if (edge === null || gestureActiveRef.current) return;
    loadedEdgeRef.current = null;
    onSettleWindow?.(edge);
  });
  const loadEdge = useEvent(async (edge: TimelineEdge): Promise<boolean> => {
    if (activeLoadRef.current !== null) return false;
    const load = edge === "older" ? onLoadOlder : onLoadNewer;
    const canLoad = edge === "older" ? canLoadOlder : canLoadNewer;
    if (!canLoad || load === undefined) return false;
    activeLoadRef.current = edge;
    setLoadError(null);
    setLoadingEdge(edge);
    const result = await settleOperation(load);
    if (result.ok) loadedEdgeRef.current = edge;
    else setLoadError(edge);
    activeLoadRef.current = null;
    setLoadingEdge(null);
    return result.ok;
  });
  const loadOlder = useEvent(() => {
    loadEdge("older").catch(() => undefined);
  });
  const loadNewer = useEvent(() => {
    loadEdge("newer").catch(() => undefined);
  });
  const beginGesture = useEvent(() => {
    gestureActiveRef.current = true;
  });
  const endGesture = useEvent(() => {
    gestureActiveRef.current = false;
    settleLoadedEdge();
  });
  const contentSizeChanged = useEvent(() => {
    settleLoadedEdge();
  });
  const handleScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromLatest = Math.max(
      0,
      contentSize.height - layoutMeasurement.height - contentOffset.y,
    );
    const nextAway = canLoadNewer || distanceFromLatest > LATEST_THRESHOLD_PX;
    if (nextAway === awayFromLatest) return;
    setAwayFromLatest(nextAway);
    setLastSeenTailId(tailTurnId(turns));
  });
  const jumpToLatest = useEvent(async () => {
    let authoritativeTailId: string | null | undefined;
    if (canLoadNewer && onJumpToLatest !== undefined) {
      if (activeLoadRef.current !== null) return;
      activeLoadRef.current = "newer";
      setLoadError(null);
      setLoadingEdge("newer");
      const result = await settleOperation(onJumpToLatest);
      activeLoadRef.current = null;
      setLoadingEdge(null);
      if (!result.ok) {
        setLoadError("newer");
        return;
      }
      authoritativeTailId = result.value;
    } else if (canLoadNewer) {
      if (!(await loadEdge("newer"))) return;
    }
    await listRef.current?.scrollToEnd({ animated: true });
    setAwayFromLatest(false);
    setLastSeenTailId(authoritativeTailId === undefined ? tailTurnId(turns) : authoritativeTailId);
    onReachedLatest?.();
  });

  return {
    awayFromLatest,
    beginGesture,
    contentSizeChanged,
    endGesture,
    handleScroll,
    jumpToLatest,
    loadError,
    loadNewer,
    loadOlder,
    loadingEdge,
    unseenCount,
  };
}

type SettledOperation<T> = { ok: true; value: T } | { ok: false };

function settleOperation<T>(operation: () => Promise<T> | T): Promise<SettledOperation<T>> {
  const operationPromise = new Promise<T>((resolve) => {
    resolve(operation());
  });
  return operationPromise.then(
    (value): SettledOperation<T> => ({ ok: true, value }),
    (): SettledOperation<T> => ({ ok: false }),
  );
}

/** @testOnly Exposes anchor-distance calculation to its deterministic viewport regression. */
export function turnsAfter(turns: TimelineDisplayTurn[], turnId: string | null): number {
  if (turnId === null) return 0;
  const index = turns.findIndex((turn) => turn.id === turnId);
  return index === -1 ? 0 : Math.max(0, turns.length - index - 1);
}

function tailTurnId(turns: TimelineDisplayTurn[]): string | null {
  return turns.at(-1)?.id ?? null;
}
