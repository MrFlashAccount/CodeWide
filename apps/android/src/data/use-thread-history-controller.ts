import { useMemo } from "react";
import { useConversationCleanup, useConversationRef } from "../ui/use-conversation-scope";

import { useEvent } from "../react/useEvent";
import { useLatest } from "../react/useLatest";
import { threadHistoryContainsBeginning, type ThreadHistoryState } from "./thread-pagination";
import { recordThreadHistoryTelemetry, telemetryErrorKind } from "./thread-history-telemetry";
import { ThreadHistoryLoadCoordinator, type ThreadHistoryLoadDirection, type ThreadHistoryLoadSettlement } from "./thread-history-load-coordinator";
import { ThreadHistoryViewportFill } from "./thread-history-viewport-fill";

export type ThreadHistoryViewport = {
  readStatus(): ThreadHistoryState["status"];
  completeTurnHeaders: boolean;
  containsBeginning: boolean;
  containsLatest: boolean;
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
  loadLatest(): Promise<void>;
  reportViewport(viewportHeight: number, contentHeight: number): Promise<void>;
  trimAfterGesture(direction: "older" | "newer"): Promise<void>;
};

type ThreadHistoryControllerOptions = {
  enabled: boolean;
  connectionId: string;
  threadId: string | null;
  historyEpoch: number;
  cursorState: Pick<ThreadHistoryState, "historyEpoch" | "nextCursor"> | null;
  readState(): ThreadHistoryState | null;
  readHistoryCursor(): string | null | undefined;
  readRangeRevision(): number;
  isLatestRange: boolean;
  isEarliestRange: boolean;
  putState(state: ThreadHistoryState): void;
  pullRange(direction: "older" | "newer" | "latest"): Promise<boolean>;
  trimRange(direction: "older" | "newer"): Promise<boolean>;
};

async function loadRange(
  context: ThreadHistoryControllerOptions,
  direction: ThreadHistoryLoadDirection,
): Promise<boolean> {
  const threadId = context.threadId;
  const state = context.readState();
  if (!context.enabled || context.connectionId === "" || threadId === null || state === null) return false;
  if (state.historyEpoch !== context.historyEpoch) return false;
  const cursor = context.readHistoryCursor();

  const startedAt = performance.now();
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_started", {
    values: { historyEpoch: state.historyEpoch },
    tags: {
      direction,
      status: state.status,
      cursorState: cursor === undefined ? "unknown" : cursor === null ? "exhausted" : "available",
    },
  });
  const localStartedAt = performance.now();
  const previousRevision = context.readRangeRevision();
  const loadedLocally = await context.pullRange(direction);
  const progressed = loadedLocally && context.readRangeRevision() !== previousRevision;
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.local_range_pull", {
    values: { durationMs: performance.now() - localStartedAt, historyEpoch: state.historyEpoch },
    tags: { direction, pulled: loadedLocally ? "true" : "false" },
  });

  const nextCursor = context.readHistoryCursor();
  const current = context.readState();
  if (current !== null && current.historyEpoch === state.historyEpoch) {
    context.putState({ ...current, nextCursor });
  }
  if (loadedLocally || direction !== "older" || nextCursor === null) {
    recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_finished", {
      values: { durationMs: performance.now() - startedAt, historyEpoch: state.historyEpoch, pageCount: 0 },
      tags: {
        direction,
        outcome: loadedLocally ? "cache-aside" : nextCursor === null ? "exhausted" : "boundary",
      },
    });
    return progressed;
  }

  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_finished", {
    values: {
      durationMs: performance.now() - startedAt,
      historyEpoch: state.historyEpoch,
      pageCount: 0,
    },
    tags: {
      direction,
      outcome: "boundary",
      nextCursor: nextCursor === null ? "exhausted" : "available",
    },
  });
  return progressed;
}

/** LegendList owns position; the controller coalesces pages and continues a
 * bounded viewport-fill intent when measured rows remain too short. */
export function useThreadHistoryController(options: ThreadHistoryControllerOptions): ThreadHistoryViewport {
  const contextRef = useLatest(options);
  const loadRuntimeRef = useConversationRef<{
    operations: Partial<Record<ThreadHistoryLoadDirection, Promise<boolean>>>;
    coordinator: ThreadHistoryLoadCoordinator;
  }>(
    `${options.connectionId}\u0000${options.threadId}\u0000${options.historyEpoch}`,
    () => ({ operations: {}, coordinator: new ThreadHistoryLoadCoordinator() }),
  );

  const load = useEvent(async (direction: ThreadHistoryLoadDirection): Promise<boolean> => {
    const runtime = loadRuntimeRef.current;
    const existing = runtime.operations[direction];
    if (existing !== undefined) return await existing;
    const context = contextRef.current;
    if (runtime.coordinator.begin(direction)) {
      const current = context.readState();
      if (current !== null && current.historyEpoch === context.historyEpoch) {
        context.putState({ ...current, status: "loading-history", error: null });
      }
    }
    let outcome: { status: "succeeded" } | { status: "failed"; cause: unknown } = { status: "succeeded" };
    const operation = loadRange(context, direction).catch((cause: unknown) => {
      outcome = { status: "failed", cause };
      const threadId = context.threadId;
      if (threadId !== null) {
        recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_failed", {
          values: { historyEpoch: context.historyEpoch },
          tags: { direction, errorKind: telemetryErrorKind(cause) },
        });
      }
      throw cause;
    }).finally(() => {
      if (runtime.operations[direction] === operation) delete runtime.operations[direction];
      const settlement = outcome.status === "failed"
        ? runtime.coordinator.fail(direction, outcome.cause)
        : runtime.coordinator.succeed(direction);
      publishLoadSettlement(context, settlement);
    });
    runtime.operations[direction] = operation;
    return await operation;
  });

  const viewportFillRef = useConversationRef(
    `${options.connectionId}\u0000${options.threadId}\u0000${options.historyEpoch}`,
    () => {
      const { connectionId, threadId, historyEpoch } = options;
      return new ThreadHistoryViewportFill({
        loadPage: load,
        afterLayout: async () => await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        isCurrent: () => contextRef.current.enabled && contextRef.current.connectionId === connectionId
          && contextRef.current.threadId === threadId && contextRef.current.historyEpoch === historyEpoch,
      });
    },
  );
  useConversationCleanup(`${options.connectionId}\u0000${options.threadId}\u0000${options.historyEpoch}`,
    () => viewportFillRef.current.cancel());
  const loadOlder = useEvent(async (): Promise<void> => await viewportFillRef.current.load("older"));
  const loadNewer = useEvent(async (): Promise<void> => await viewportFillRef.current.load("newer"));
  const loadLatest = useEvent(async (): Promise<void> => {
    viewportFillRef.current.cancel();
    await load("latest");
  });
  const reportViewport = useEvent(async (viewportHeight: number, contentHeight: number): Promise<void> => {
    await viewportFillRef.current.reportViewport(viewportHeight, contentHeight);
  });
  const trimAfterGesture = useEvent(async (direction: "older" | "newer"): Promise<void> => {
    const context = contextRef.current;
    const threadId = context.threadId;
    if (!context.enabled || context.connectionId === "" || threadId === null) return;
    await context.trimRange(direction);
  });

  return useMemo(() => ({
    readStatus: () => contextRef.current.readState()?.status ?? "initial-loading",
    completeTurnHeaders: options.isLatestRange && options.cursorState?.nextCursor === null,
    containsBeginning: threadHistoryContainsBeginning(options.isEarliestRange, options.cursorState?.nextCursor),
    containsLatest: options.isLatestRange,
    loadOlder,
    loadNewer,
    loadLatest,
    reportViewport,
    trimAfterGesture,
  }), [contextRef, loadLatest, loadNewer, loadOlder, options.cursorState?.nextCursor, options.isLatestRange, options.isEarliestRange, reportViewport, trimAfterGesture]);
}

function publishLoadSettlement(
  context: ThreadHistoryControllerOptions,
  settlement: ThreadHistoryLoadSettlement,
): void {
  if (settlement.status === "pending") return;
  const current = context.readState();
  if (current === null || current.historyEpoch !== context.historyEpoch) return;
  context.putState(settlement.status === "failed"
    ? {
        ...current,
        status: "background-retrying",
        error: settlement.cause instanceof Error ? settlement.cause.message : "Could not load messages",
      }
    : {
        ...current,
        nextCursor: context.readHistoryCursor(),
        status: "ready",
        error: null,
      });
}

const noopLoad = async (): Promise<void> => undefined;

export const COMPLETE_STATIC_THREAD_HISTORY: ThreadHistoryViewport = {
  readStatus: () => "ready",
  completeTurnHeaders: true,
  containsBeginning: true,
  containsLatest: true,
  loadOlder: noopLoad,
  loadNewer: noopLoad,
  loadLatest: noopLoad,
  reportViewport: noopLoad,
  trimAfterGesture: async () => undefined,
};
