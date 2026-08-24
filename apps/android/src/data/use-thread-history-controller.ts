import { useMemo, useRef } from "react";

import { useEvent } from "../react/useEvent";
import { useLatest } from "../react/useLatest";
import type { ThreadHistoryState } from "./thread-pagination";
import { recordThreadHistoryTelemetry, telemetryErrorKind } from "./thread-history-telemetry";
import type { ThreadTurnPage } from "./use-remote-workspace";

export type ThreadHistoryViewport = {
  readStatus(): ThreadHistoryState["status"];
  completeTurnHeaders: boolean;
  containsLatest: boolean;
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
  loadLatest(): Promise<void>;
  trimAfterGesture(direction: "older" | "newer"): Promise<void>;
};

type ThreadHistoryControllerOptions = {
  enabled: boolean;
  connectionId: string;
  threadId: string | null;
  historyEpoch: number;
  cursorState: Pick<ThreadHistoryState, "historyEpoch" | "nextCursor"> | null;
  readState(): ThreadHistoryState | null;
  isLatestRange: boolean;
  putState(state: ThreadHistoryState): void;
  pullRange(direction: "older" | "newer" | "latest"): Promise<boolean>;
  trimRange(direction: "older" | "newer"): Promise<boolean>;
  loadOlderTurns(connectionId: string, threadId: string, cursor: string | null, expectedHistoryEpoch: number): Promise<ThreadTurnPage>;
};

async function loadRange(
  context: ThreadHistoryControllerOptions,
  direction: "older" | "newer" | "latest",
): Promise<void> {
  const threadId = context.threadId;
  const state = context.readState();
  if (!context.enabled || context.connectionId === "" || threadId === null || state === null) return;
  if (state.historyEpoch !== context.historyEpoch) return;

  const startedAt = performance.now();
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_started", {
    values: { historyEpoch: state.historyEpoch },
    tags: {
      direction,
      status: state.status,
      cursorState: state.nextCursor === undefined ? "unknown" : state.nextCursor === null ? "exhausted" : "available",
    },
  });

  const localStartedAt = performance.now();
  const loadedLocally = await context.pullRange(direction);
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.local_range_pull", {
    values: { durationMs: performance.now() - localStartedAt, historyEpoch: state.historyEpoch },
    tags: { direction, pulled: loadedLocally ? "true" : "false" },
  });

  if (loadedLocally || direction !== "older" || state.nextCursor === null) {
    recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_finished", {
      values: { durationMs: performance.now() - startedAt, historyEpoch: state.historyEpoch, pageCount: 0 },
      tags: {
        direction,
        outcome: loadedLocally ? "sqlite" : state.nextCursor === null ? "exhausted" : "boundary",
      },
    });
    return;
  }

  context.putState({ ...state, status: "loading-history", error: null });
  const page = await context.loadOlderTurns(
    context.connectionId,
    threadId,
    state.nextCursor ?? null,
    state.historyEpoch,
  );
  if (!page.acceptedHistory) throw new Error("Backend history page was not persisted");
  const current = context.readState();
  if (current !== null && current.historyEpoch === state.historyEpoch) {
    context.putState({ ...current, nextCursor: page.nextCursor, status: "ready", error: null });
  }
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_finished", {
    values: {
      durationMs: performance.now() - startedAt,
      historyEpoch: state.historyEpoch,
      pageCount: 1,
      turnCount: page.turns.length,
    },
    tags: {
      direction,
      outcome: page.extendedHistory ? "backend" : "overlap",
      nextCursor: page.nextCursor === null ? "exhausted" : "available",
    },
  });
}

/** Thin edge adapter: LegendList owns position; this hook only coalesces one
 * twelve-turn SQLite-first load at a time. */
export function useThreadHistoryController(options: ThreadHistoryControllerOptions): ThreadHistoryViewport {
  const contextRef = useLatest(options);
  const inFlightRef = useRef<Partial<Record<"older" | "newer" | "latest", Promise<void>>>>({});

  const load = useEvent(async (direction: "older" | "newer" | "latest"): Promise<void> => {
    const existing = inFlightRef.current[direction];
    if (existing !== undefined) return await existing;
    const context = contextRef.current;
    const operation = loadRange(context, direction).catch((cause: unknown) => {
      const threadId = context.threadId;
      if (threadId !== null) {
        recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_failed", {
          values: { historyEpoch: context.historyEpoch },
          tags: { direction, errorKind: telemetryErrorKind(cause) },
        });
      }
      const current = context.readState();
      if (current !== null && current.historyEpoch === context.historyEpoch) {
        context.putState({
          ...current,
          status: "background-retrying",
          error: cause instanceof Error ? cause.message : "Could not load messages",
        });
      }
      throw cause;
    }).finally(() => {
      if (inFlightRef.current[direction] === operation) delete inFlightRef.current[direction];
    });
    inFlightRef.current[direction] = operation;
    return await operation;
  });

  const loadOlder = useEvent(async (): Promise<void> => await load("older"));
  const loadNewer = useEvent(async (): Promise<void> => await load("newer"));
  const loadLatest = useEvent(async (): Promise<void> => await load("latest"));
  const trimAfterGesture = useEvent(async (direction: "older" | "newer"): Promise<void> => {
    const context = contextRef.current;
    const threadId = context.threadId;
    if (!context.enabled || context.connectionId === "" || threadId === null) return;
    await context.trimRange(direction);
  });

  return useMemo(() => ({
    readStatus: () => contextRef.current.readState()?.status ?? "initial-loading",
    completeTurnHeaders: options.isLatestRange && options.cursorState?.nextCursor === null,
    containsLatest: options.isLatestRange,
    loadOlder,
    loadNewer,
    loadLatest,
    trimAfterGesture,
  }), [contextRef, loadLatest, loadNewer, loadOlder, options.cursorState?.nextCursor, options.isLatestRange, trimAfterGesture]);
}

const noopLoad = async (): Promise<void> => undefined;

export const COMPLETE_STATIC_THREAD_HISTORY: ThreadHistoryViewport = {
  readStatus: () => "ready",
  completeTurnHeaders: true,
  containsLatest: true,
  loadOlder: noopLoad,
  loadNewer: noopLoad,
  loadLatest: noopLoad,
  trimAfterGesture: async () => undefined,
};
