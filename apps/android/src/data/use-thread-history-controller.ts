import { useConversationCleanup, useConversationRef } from "../ui/use-conversation-scope";

import { useEvent } from "../react/useEvent";
import { useLatest } from "../react/useLatest";
import { threadHistoryContainsBeginning, type ThreadHistoryState } from "./thread-pagination";
import { recordThreadHistoryTelemetry, telemetryErrorKind } from "./thread-history-telemetry";
import {
  ThreadHistoryLoadCoordinator,
  type ThreadHistoryLoadDirection,
  type ThreadHistoryLoadSettlement,
} from "./thread-history-load-coordinator";
import { ThreadHistoryViewportFill } from "./thread-history-viewport-fill";

export type ThreadHistoryViewport = {
  completeTurnHeaders: boolean;
  containsBeginning: boolean;
  containsLatest: boolean;
  loadLatest: () => Promise<void>;
  loadNewer: () => Promise<void>;
  loadOlder: () => Promise<void>;
  readStatus: () => ThreadHistoryState["status"];
  reportViewport: (viewportHeight: number, contentHeight: number) => Promise<void>;
  trimAfterGesture: (direction: "older" | "newer") => Promise<void>;
};

type ThreadHistoryControllerOptions = {
  connectionId: string;
  cursorState: Pick<ThreadHistoryState, "historyEpoch" | "nextCursor"> | null;
  enabled: boolean;
  historyEpoch: number;
  isEarliestRange: boolean;
  isLatestRange: boolean;
  pullRange: (direction: "older" | "newer" | "latest") => Promise<boolean>;
  putState: (state: ThreadHistoryState) => void;
  readHistoryCursor: () => string | null | undefined;
  readRangeRevision: () => number;
  readState: () => ThreadHistoryState | null;
  threadId: string | null;
  trimRange: (direction: "older" | "newer") => Promise<boolean>;
};

async function loadRange(
  context: ThreadHistoryControllerOptions,
  direction: ThreadHistoryLoadDirection,
): Promise<boolean> {
  const threadId = context.threadId;
  const state = context.readState();
  if (!context.enabled || context.connectionId === "" || threadId === null || state === null) {
    return false;
  }
  if (state.historyEpoch !== context.historyEpoch) {
    return false;
  }
  const cursor = context.readHistoryCursor();

  const startedAt = performance.now();
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_started", {
    tags: {
      cursorState: cursor === undefined ? "unknown" : cursor === null ? "exhausted" : "available",
      direction,
      status: state.status,
    },
    values: { historyEpoch: state.historyEpoch },
  });
  const localStartedAt = performance.now();
  const previousRevision = context.readRangeRevision();
  const loadedLocally = await context.pullRange(direction);
  const progressed = loadedLocally && context.readRangeRevision() !== previousRevision;
  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.local_range_pull", {
    tags: { direction, pulled: loadedLocally ? "true" : "false" },
    values: { durationMs: performance.now() - localStartedAt, historyEpoch: state.historyEpoch },
  });

  const nextCursor = context.readHistoryCursor();
  const current = context.readState();
  if (current !== null && current.historyEpoch === state.historyEpoch) {
    context.putState({ ...current, nextCursor });
  }
  if (loadedLocally || direction !== "older" || nextCursor === null) {
    recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_finished", {
      tags: {
        direction,
        outcome: loadedLocally ? "cache-aside" : nextCursor === null ? "exhausted" : "boundary",
      },
      values: {
        durationMs: performance.now() - startedAt,
        historyEpoch: state.historyEpoch,
        pageCount: 0,
      },
    });
    return progressed;
  }

  recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_finished", {
    tags: {
      direction,
      nextCursor: "available",
      outcome: "boundary",
    },
    values: {
      durationMs: performance.now() - startedAt,
      historyEpoch: state.historyEpoch,
      pageCount: 0,
    },
  });
  return progressed;
}

/** LegendList owns position; the controller coalesces pages and continues a
 * bounded viewport-fill intent when measured rows remain too short. */
export function useThreadHistoryController(
  options: ThreadHistoryControllerOptions,
): ThreadHistoryViewport {
  const contextRef = useLatest(options);
  const loadRuntimeRef = useConversationRef<{
    coordinator: ThreadHistoryLoadCoordinator;
    operations: Partial<Record<ThreadHistoryLoadDirection, Promise<boolean>>>;
  }>(
    `${options.connectionId}\u0000${String(options.threadId)}\u0000${String(options.historyEpoch)}`,
    () => ({
      coordinator: new ThreadHistoryLoadCoordinator(),
      operations: {},
    }),
  );

  const load = useEvent(async (direction: ThreadHistoryLoadDirection): Promise<boolean> => {
    const runtime = loadRuntimeRef.current;
    const existing = runtime.operations[direction];
    if (existing !== undefined) {
      return existing;
    }
    const context = contextRef.current;
    if (runtime.coordinator.begin(direction)) {
      const current = context.readState();
      if (current !== null && current.historyEpoch === context.historyEpoch) {
        context.putState({ ...current, error: null, status: "loading-history" });
      }
    }
    let outcome: { status: "succeeded" } | { cause: unknown; status: "failed" } = {
      status: "succeeded",
    };
    const operation = loadRange(context, direction)
      .catch((error: unknown) => {
        outcome = { cause: error, status: "failed" };
        const threadId = context.threadId;
        if (threadId !== null) {
          recordThreadHistoryTelemetry(context.connectionId, threadId, "chat.history.load_failed", {
            tags: { direction, errorKind: telemetryErrorKind(error) },
            values: { historyEpoch: context.historyEpoch },
          });
        }
        throw error;
      })
      .finally(() => {
        if (runtime.operations[direction] === operation) {
          delete runtime.operations[direction];
        }
        const settlement =
          outcome.status === "failed"
            ? runtime.coordinator.fail(direction, outcome.cause)
            : runtime.coordinator.succeed(direction);
        publishLoadSettlement(context, settlement);
      });
    runtime.operations[direction] = operation;
    return operation;
  });

  const viewportFillRef = useConversationRef(
    `${options.connectionId}\u0000${String(options.threadId)}\u0000${String(options.historyEpoch)}`,
    () => {
      const { connectionId, historyEpoch, threadId } = options;
      return new ThreadHistoryViewportFill({
        afterLayout: async () => {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        },
        isCurrent: () =>
          contextRef.current.enabled &&
          contextRef.current.connectionId === connectionId &&
          contextRef.current.threadId === threadId &&
          contextRef.current.historyEpoch === historyEpoch,
        loadPage: load,
      });
    },
  );
  useConversationCleanup(
    `${options.connectionId}\u0000${String(options.threadId)}\u0000${String(options.historyEpoch)}`,
    () => {
      viewportFillRef.current.cancel();
    },
  );
  const loadOlder = useEvent(async (): Promise<void> => {
    await viewportFillRef.current.load("older");
  });
  const loadNewer = useEvent(async (): Promise<void> => {
    await viewportFillRef.current.load("newer");
  });
  const loadLatest = useEvent(async (): Promise<void> => {
    viewportFillRef.current.cancel();
    await load("latest");
  });
  const reportViewport = useEvent(
    async (viewportHeight: number, contentHeight: number): Promise<void> => {
      await viewportFillRef.current.reportViewport(viewportHeight, contentHeight);
    },
  );
  const trimAfterGesture = useEvent(async (direction: "older" | "newer"): Promise<void> => {
    const context = contextRef.current;
    const threadId = context.threadId;
    if (!context.enabled || context.connectionId === "" || threadId === null) {
      return;
    }
    await context.trimRange(direction);
  });

  return {
    completeTurnHeaders: options.isLatestRange && options.cursorState?.nextCursor === null,
    containsBeginning: threadHistoryContainsBeginning(
      options.isEarliestRange,
      options.cursorState?.nextCursor,
    ),
    containsLatest: options.isLatestRange,
    loadLatest,
    loadNewer,
    loadOlder,
    readStatus: () => contextRef.current.readState()?.status ?? "initial-loading",
    reportViewport,
    trimAfterGesture,
  };
}

function publishLoadSettlement(
  context: ThreadHistoryControllerOptions,
  settlement: ThreadHistoryLoadSettlement,
): void {
  if (settlement.status === "pending") {
    return;
  }
  const current = context.readState();
  if (current === null || current.historyEpoch !== context.historyEpoch) {
    return;
  }
  context.putState(
    settlement.status === "failed"
      ? {
          ...current,
          error:
            settlement.cause instanceof Error
              ? settlement.cause.message
              : "Could not load messages",
          status: "background-retrying",
        }
      : {
          ...current,
          error: null,
          nextCursor: context.readHistoryCursor(),
          status: "ready",
        },
  );
}

const noopLoad = async (): Promise<void> => {
  await Promise.resolve();
};

export const COMPLETE_STATIC_THREAD_HISTORY: ThreadHistoryViewport = {
  completeTurnHeaders: true,
  containsBeginning: true,
  containsLatest: true,
  loadLatest: noopLoad,
  loadNewer: noopLoad,
  loadOlder: noopLoad,
  readStatus: () => "ready",
  reportViewport: noopLoad,
  trimAfterGesture: noopLoad,
};
