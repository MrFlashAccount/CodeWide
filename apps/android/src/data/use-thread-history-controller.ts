import { useLayoutEffect, useMemo, useRef } from "react";

import { useEvent } from "../react/useEvent";
import type { ThreadDetailRow } from "./thread-detail-database";
import {
  consumeDuplicateHistoryPages,
  freezeResidentRange,
  hasAnyLocalOlderTurn,
  hasFullLocalOlderPage,
  residentRangeForVisibleAnchor,
  revealResidentLiveTail,
  THREAD_RESIDENT_TURN_LIMIT,
  type ThreadHistoryState,
  type ResidentRangeDirection,
  type ResidentTurnRange,
} from "./thread-pagination";
import type { ThreadTurnPage } from "./use-remote-workspace";

export type ThreadHistoryViewport = {
  status: ThreadHistoryState["status"];
  error: string | null;
  /** The resident range follows the mutable live tail. */
  atLiveTail: boolean;
  /** Every turn header is resident, so whole-thread aggregates are exact. */
  completeTurnHeaders: boolean;
  /** Recenter the resident range around a stable visible turn. */
  move(turnId: string, direction: ResidentRangeDirection): Promise<void>;
  /** Fill an under-sized tail window after a real list layout event. */
  prefetch(): void;
  /** Pin the live-tail boundary before new turns arrive while reading history. */
  freeze(): void;
  /** Rejoin the mutable live tail and cancel stale range work. */
  revealLatest(): Promise<void>;
};

type OrdinalBounds = { min: number; max: number } | null;

type ThreadHistoryControllerOptions = {
  enabled: boolean;
  resourceId: string | null;
  connectionId: string;
  threadId: string | null;
  historyEpoch: number;
  state: ThreadHistoryState | null;
  presentationState: ThreadHistoryState;
  residentTurnRows: readonly ThreadDetailRow[];
  liveRows: readonly ThreadDetailRow[];
  residentOrdinalBounds: OrdinalBounds;
  /** Keyset boundary of the complete window currently presented to the list. */
  presentedResidentMaxOrdinal: number | null;
  persistedMinimumOrdinal: number | null;
  latestSealedOrdinal: number | null;
  residentQueryReady: boolean;
  putState(state: ThreadHistoryState): void;
  loadOlderTurns(connectionId: string, threadId: string, cursor: string, expectedHistoryEpoch: number): Promise<ThreadTurnPage>;
};

type ControllerContext = Omit<ThreadHistoryControllerOptions, "presentationState">;

/**
 * Owns the chat history resident range. Callers provide durable query
 * observations and transport adapters; the viewport never sees cursors,
 * loading locks, epochs, or keyset arithmetic.
 */
export function useThreadHistoryController(options: ThreadHistoryControllerOptions): ThreadHistoryViewport {
  const contextRef = useRef<ControllerContext>(options);
  const mutationRef = useRef(0);
  const prefetchKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    contextRef.current = options;
  });
  useLayoutEffect(() => {
    mutationRef.current += 1;
    prefetchKeyRef.current = null;
  }, [options.historyEpoch, options.resourceId]);

  const loadOlderRange = useEvent(async (nextRange: ResidentTurnRange | null): Promise<void> => {
    const context = contextRef.current;
    const state = context.state;
    if (!context.enabled
      || context.connectionId === ""
      || context.threadId === null
      || context.resourceId === null
      || state === null
      || state.status === "loading-history"
      || state.historyEpoch !== context.historyEpoch) return;

    const canShiftFromLocalCache = hasFullLocalOlderPage(
      context.residentOrdinalBounds?.min ?? null,
      context.persistedMinimumOrdinal,
    );
    const hasPartialLocalOlderRange = hasAnyLocalOlderTurn(
      context.residentOrdinalBounds?.min ?? null,
      context.persistedMinimumOrdinal,
    );
    if (canShiftFromLocalCache) {
      if (nextRange === null) return;
      mutationRef.current += 1;
      context.putState({
        ...state,
        residentTurnLimit: nextRange.turnLimit,
        residentMaxOrdinal: nextRange.maxOrdinal,
      });
      return;
    }
    if (state.nextCursor === null) {
      if (nextRange === null || !hasPartialLocalOlderRange) return;
      mutationRef.current += 1;
      context.putState({
        ...state,
        residentTurnLimit: nextRange.turnLimit,
        residentMaxOrdinal: nextRange.maxOrdinal,
      });
      return;
    }

    const mutation = ++mutationRef.current;
    context.putState({ ...state, status: "loading-history", error: null });
    let consumed: { page: ThreadTurnPage | null; nextCursor: string | null; cancelled: boolean } = {
      page: null,
      nextCursor: state.nextCursor,
      cancelled: false,
    };
    let loadError: unknown;
    let failed = false;
    try {
      consumed = await consumeDuplicateHistoryPages(
        state.nextCursor,
        async (cursor) => await context.loadOlderTurns(
          context.connectionId,
          context.threadId as string,
          cursor,
          state.historyEpoch,
        ),
        () => mutation === mutationRef.current,
      );
    } catch (cause) {
      failed = true;
      loadError = cause;
    }

    if (mutation !== mutationRef.current) return;
    const currentState = contextRef.current.state;
    if (currentState === null || currentState.historyEpoch !== state.historyEpoch) return;
    if (failed) {
      context.putState({
        ...currentState,
        status: "background-retrying",
        error: loadError instanceof Error ? loadError.message : "Could not load older messages",
      });
      return;
    }
    if (consumed.cancelled) {
      context.putState({
        ...currentState,
        nextCursor: consumed.nextCursor,
        status: "ready",
        error: null,
      });
      return;
    }
    if (consumed.page?.extendedHistory !== true) {
      const currentContext = contextRef.current;
      const canExposePartialRange = nextRange !== null
        && consumed.nextCursor === null
        && hasAnyLocalOlderTurn(
          currentContext.residentOrdinalBounds?.min ?? null,
          currentContext.persistedMinimumOrdinal,
        );
      context.putState(canExposePartialRange
        ? {
            ...currentState,
            nextCursor: null,
            status: "ready",
            residentTurnLimit: nextRange.turnLimit,
            residentMaxOrdinal: nextRange.maxOrdinal,
            error: null,
          }
        : {
            ...currentState,
            nextCursor: consumed.nextCursor,
            status: "ready",
            error: null,
          });
      return;
    }
    context.putState(nextRange === null
      ? {
          ...currentState,
          status: "ready",
          nextCursor: consumed.nextCursor,
          error: null,
        }
      : {
          historyEpoch: currentState.historyEpoch,
          status: "ready",
          nextCursor: consumed.nextCursor,
          residentTurnLimit: nextRange.turnLimit,
          residentMaxOrdinal: nextRange.maxOrdinal,
          error: null,
        });
  });

  const move = useEvent(async (turnId: string, direction: ResidentRangeDirection): Promise<void> => {
    const context = contextRef.current;
    const state = context.state;
    if (state === null || state.status === "loading-history" || state.historyEpoch !== context.historyEpoch) return;
    // A state write starts a new on-demand keyset query. Do not issue another
    // range move from callbacks belonging to the still-presented old window.
    if ((state.residentMaxOrdinal ?? null) !== context.presentedResidentMaxOrdinal) return;
    const anchorRow = [...context.residentTurnRows, ...context.liveRows].find((row) =>
      row.kind === "turn" && row.remoteTurnId === turnId && row.historyEpoch === state.historyEpoch,
    );
    if (anchorRow === undefined) return;
    const visibleLiveOrdinals = context.liveRows.flatMap((row) => row.kind === "turn"
      && row.historyEpoch === context.historyEpoch
      ? [row.ordinal]
      : []);
    const latestResidentOrdinal = freezeResidentRange(context.latestSealedOrdinal, visibleLiveOrdinals).maxOrdinal;
    const hasOlderHistory = state.nextCursor !== null
      || (context.residentOrdinalBounds !== null
        && context.persistedMinimumOrdinal !== null
        && context.persistedMinimumOrdinal < context.residentOrdinalBounds.min);
    const nextRange = residentRangeForVisibleAnchor(
      state,
      anchorRow.ordinal,
      direction,
      latestResidentOrdinal,
      context.residentOrdinalBounds?.min ?? null,
      hasOlderHistory,
    );
    if (nextRange === null) return;
    if (direction === "older") {
      await loadOlderRange(nextRange);
      return;
    }
    mutationRef.current += 1;
    context.putState({
      ...state,
      residentTurnLimit: nextRange.turnLimit,
      residentMaxOrdinal: nextRange.maxOrdinal,
    });
  });

  const freeze = useEvent((): void => {
    const context = contextRef.current;
    const state = context.state;
    if (state === null
      || state.historyEpoch !== context.historyEpoch
      || state.residentMaxOrdinal != null) return;
    const visibleLiveOrdinals = context.liveRows.flatMap((row) => row.kind === "turn"
      && row.historyEpoch === context.historyEpoch
      ? [row.ordinal]
      : []);
    const frozen = freezeResidentRange(context.latestSealedOrdinal, visibleLiveOrdinals);
    if (frozen.maxOrdinal === null) return;
    mutationRef.current += 1;
    context.putState({
      ...state,
      residentTurnLimit: state.residentTurnLimit,
      residentMaxOrdinal: frozen.maxOrdinal,
    });
  });

  const revealLatest = useEvent(async (): Promise<void> => {
    const context = contextRef.current;
    const state = context.state;
    if (state === null
      || state.historyEpoch !== context.historyEpoch
      || state.residentMaxOrdinal == null) return;
    mutationRef.current += 1;
    context.putState(revealResidentLiveTail(state));
  });

  const prefetch = useEvent((): void => {
    const context = contextRef.current;
    const state = context.state;
    if (!context.residentQueryReady
      || state?.status !== "ready"
      || state.historyEpoch !== context.historyEpoch
      || state.residentMaxOrdinal != null
      || state.nextCursor === null
      || context.residentTurnRows.length >= THREAD_RESIDENT_TURN_LIMIT) return;
    const key = `${context.resourceId}:${context.historyEpoch}:${state.nextCursor}`;
    if (prefetchKeyRef.current === key) return;
    prefetchKeyRef.current = key;
    void loadOlderRange(null).finally(() => {
      if (prefetchKeyRef.current === key) prefetchKeyRef.current = null;
    });
  });

  return useMemo(() => ({
    status: options.presentationState.status,
    error: options.presentationState.error,
    atLiveTail: options.presentationState.residentMaxOrdinal == null,
    completeTurnHeaders: options.presentationState.nextCursor === null
      && options.presentationState.residentMaxOrdinal == null,
    move,
    prefetch,
    freeze,
    revealLatest,
  }), [freeze, move, options.presentationState.error, options.presentationState.nextCursor, options.presentationState.residentMaxOrdinal, options.presentationState.status, prefetch, revealLatest]);
}

const noopMove = async (): Promise<void> => undefined;
const noopFreeze = (): void => undefined;

export const COMPLETE_STATIC_THREAD_HISTORY: ThreadHistoryViewport = {
  status: "ready",
  error: null,
  atLiveTail: true,
  completeTurnHeaders: true,
  move: noopMove,
  prefetch: noopFreeze,
  freeze: noopFreeze,
  revealLatest: noopMove,
};
