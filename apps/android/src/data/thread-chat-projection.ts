import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import type { ThreadCurrentOutcome } from "./thread-current-outcome";

import type { QueuedPrompt } from "./thread-delivery-state";
import { measureThreadNavigationWork } from "./thread-navigation-metrics";
import { mergeThreadPartitions } from "./thread-partitions";
import {
  materializePendingTimeline,
  materializeThreadDetails,
  materializeThreadTurns,
  type ThreadDetailDatabase,
} from "./thread-detail-database";
import type { ThreadChatWindowView } from "./use-thread-chat-window";
import type { PendingTimelineEntry } from "./thread-detail-projection";
import type { StoredThreadSummary } from "./thread-summary-types";
import { applyThreadSummaryMetadata } from "./thread-metadata-projection";
import {
  projectResidentThreadTimeline,
  type ProjectedThreadChatDelivery,
  type ProjectedThreadChatTimelineEntry,
} from "./thread-chat-timeline";

export { applyThreadSummaryMetadata } from "./thread-metadata-projection";
export type {
  ProjectedThreadChatDelivery,
  ProjectedThreadChatTimelineEntry,
} from "./thread-chat-timeline";

export type ProjectedThreadChatWindow = {
  currentOutcome: ThreadCurrentOutcome | null;
  currentUsage: TurnUsageProjection | null;
  queuedPrompts: QueuedPrompt[];
  remoteLiveTurns: Thread["turns"];
  remoteSealedTurns: Thread["turns"];
  remoteThread: Thread | null;
  timeline: ProjectedThreadChatTimelineEntry[];
};

type CachedPendingDelivery = {
  scope: string;
  value: ProjectedThreadChatDelivery;
};

const pendingDeliveryCache = new WeakMap<PendingTimelineEntry, CachedPendingDelivery>();

function projectPendingDelivery(
  entry: PendingTimelineEntry,
  connectionId: string,
  threadId: string | null,
): ProjectedThreadChatDelivery {
  const scope = `${connectionId}\u0000${threadId ?? ""}`;
  const cached = pendingDeliveryCache.get(entry);
  if (cached?.scope === scope) {
    return cached.value;
  }
  const value: ProjectedThreadChatDelivery = {
    attachments: entry.attachments,
    commandId: entry.commandId,
    connectionId,
    method: entry.method,
    targetCommandId: null,
    text: entry.text,
    threadId,
    ...(entry.workspaceRequestId === undefined
      ? {}
      : { workspaceRequestId: entry.workspaceRequestId }),
    attempts: entry.attempts,
    createdAt: entry.createdAt,
    lastError: entry.lastError,
    state: entry.state,
    updatedAt: entry.updatedAt,
  };
  pendingDeliveryCache.set(entry, { scope, value });
  return value;
}

/** Converts the model-owned resident chat set into the presentation partitions.
 * Callers choose whether this render contributes to navigation diagnostics. */
export function projectThreadChatWindow(
  database: ThreadDetailDatabase,
  view: ThreadChatWindowView,
  connectionId: string,
  threadId: string | null,
  recordNavigationMeasurements: boolean,
  summary: StoredThreadSummary | null = null,
): ProjectedThreadChatWindow {
  const measure = <Value>(
    name: string,
    operation: () => Value,
    values: Record<string, number>,
  ): Value =>
    recordNavigationMeasurements
      ? measureThreadNavigationWork(connectionId, threadId, name, operation, { values })
      : operation();
  const pendingTimeline = materializePendingTimeline(view.liveRows);
  const pendingDeliveries: ProjectedThreadChatDelivery[] = pendingTimeline
    .filter(({ presentation }) => presentation === "delivery")
    .map((entry) => projectPendingDelivery(entry, connectionId, threadId));
  const queuedPrompts: QueuedPrompt[] = pendingTimeline
    .filter(({ presentation, state }) => presentation === "queue" && state !== "delivered")
    .map(({ attachments, commandId, createdAt, lastError, state, text }) => ({
      attachments,
      commandId,
      createdAt,
      lastError,
      state: state === "uncertain" || state === "failed" ? state : "queued",
      text,
    }));
  const sealedTurns = measure(
    "db_materialize_sealed_turns",
    () => materializeThreadTurns([...view.turnRows, ...view.detailRows]),
    { rowCount: view.turnRows.length + view.detailRows.length },
  );
  const liveSnapshot = measure(
    "db_materialize_live_detail",
    () => materializeThreadDetails(view.liveRows, database.sessionId)[0] ?? null,
    { rowCount: view.liveRows.length },
  );
  if (liveSnapshot?.connectionId !== connectionId || liveSnapshot.thread.id !== threadId) {
    return {
      currentOutcome: null,
      currentUsage: null,
      queuedPrompts,
      remoteLiveTurns: [],
      remoteSealedTurns: [],
      remoteThread: null,
      timeline: projectResidentThreadTimeline([], pendingDeliveries, {
        includesEarliest: true,
        includesLatest: true,
      }),
    };
  }
  const mergedTurns = measure(
    "merge_turn_partitions",
    () => mergeThreadPartitions(sealedTurns, liveSnapshot.thread.turns),
    { liveTurnCount: liveSnapshot.thread.turns.length, sealedTurnCount: sealedTurns.length },
  );
  const projectedThread = applyThreadSummaryMetadata(
    { ...liveSnapshot.thread, turns: mergedTurns },
    summary,
  );
  const residentLiveTurnIds = new Set(liveSnapshot.thread.turns.map(({ id }) => id));
  const liveTurnIds = new Set(
    projectedThread.turns.flatMap((turn) =>
      residentLiveTurnIds.has(turn.id) && turn.status === "inProgress" ? [turn.id] : [],
    ),
  );
  const partitions = measure(
    "split_visible_turn_partitions",
    () => ({
      live: projectedThread.turns.filter(({ id }) => liveTurnIds.has(id)),
      sealed: projectedThread.turns.filter(({ id }) => !liveTurnIds.has(id)),
    }),
    { mergedTurnCount: projectedThread.turns.length },
  );
  const residentOrdinals = view.turnRows.flatMap((row) =>
    row.kind === "turn" && row.sealed ? [row.ordinal] : [],
  );
  const residentMinimum = residentOrdinals.length === 0 ? null : Math.min(...residentOrdinals);
  const residentMaximum = residentOrdinals.length === 0 ? null : Math.max(...residentOrdinals);
  const timeline = projectResidentThreadTimeline(projectedThread.turns, pendingDeliveries, {
    includesEarliest:
      view.snapshot.earliestSealedOrdinal === null ||
      (residentMinimum !== null && residentMinimum <= view.snapshot.earliestSealedOrdinal),
    includesLatest:
      view.snapshot.latestSealedOrdinal === null ||
      (residentMaximum !== null && residentMaximum >= view.snapshot.latestSealedOrdinal),
  });
  return {
    currentOutcome: view.liveRows.find((row) => row.kind === "thread")?.currentOutcome ?? null,
    currentUsage: view.liveRows.find((row) => row.kind === "thread")?.currentUsage?.usage ?? null,
    queuedPrompts,
    remoteLiveTurns: partitions.live,
    remoteSealedTurns: partitions.sealed,
    remoteThread: projectedThread,
    timeline,
  };
}
