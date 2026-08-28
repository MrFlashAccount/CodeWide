import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { QueuedPrompt } from "./use-remote-workspace";
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
export type { ProjectedThreadChatDelivery, ProjectedThreadChatTimelineEntry } from "./thread-chat-timeline";

export type ProjectedThreadChatWindow = {
  remoteThread: Thread | null;
  remoteSealedTurns: Thread["turns"];
  remoteLiveTurns: Thread["turns"];
  timeline: ProjectedThreadChatTimelineEntry[];
  queuedPrompts: QueuedPrompt[];
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
  if (cached?.scope === scope) return cached.value;
  const value: ProjectedThreadChatDelivery = {
    connectionId,
    commandId: entry.commandId,
    method: entry.method,
    threadId,
    targetCommandId: null,
    text: entry.text,
    attachments: entry.attachments,
    ...(entry.workspaceRequestId === undefined ? {} : { workspaceRequestId: entry.workspaceRequestId }),
    state: entry.state,
    attempts: entry.attempts,
    lastError: entry.lastError,
    createdAt: entry.createdAt,
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
  const measure = <Value,>(
    name: string,
    operation: () => Value,
    values: Record<string, number>,
  ): Value => recordNavigationMeasurements
    ? measureThreadNavigationWork(connectionId, threadId, name, operation, { values })
    : operation();
  const pendingTimeline = materializePendingTimeline(view.liveRows);
  const pendingDeliveries: ProjectedThreadChatDelivery[] = pendingTimeline
    .filter(({ presentation }) => presentation === "delivery")
    .map((entry) => projectPendingDelivery(entry, connectionId, threadId));
  const queuedPrompts: QueuedPrompt[] = pendingTimeline
    .filter(({ presentation, state }) => presentation === "queue" && state !== "delivered")
    .map(({ commandId, text, attachments, createdAt, state, lastError }) => ({
      commandId,
      text,
      attachments,
      createdAt,
      state: state === "uncertain" || state === "failed" ? state : "queued",
      lastError,
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
      remoteThread: null,
      remoteSealedTurns: [],
      remoteLiveTurns: [],
      timeline: projectResidentThreadTimeline([], pendingDeliveries, { includesEarliest: true, includesLatest: true }),
      queuedPrompts,
    };
  }
  const mergedTurns = measure(
    "merge_turn_partitions",
    () => mergeThreadPartitions(sealedTurns, liveSnapshot.thread.turns),
    { sealedTurnCount: sealedTurns.length, liveTurnCount: liveSnapshot.thread.turns.length },
  );
  const projectedThread = applyThreadSummaryMetadata({ ...liveSnapshot.thread, turns: mergedTurns }, summary);
  const residentLiveTurnIds = new Set(liveSnapshot.thread.turns.map(({ id }) => id));
  const liveTurnIds = new Set(projectedThread.turns.flatMap((turn) => (
    residentLiveTurnIds.has(turn.id) && turn.status === "inProgress" ? [turn.id] : []
  )));
  const partitions = measure(
    "split_visible_turn_partitions",
    () => ({
      sealed: projectedThread.turns.filter(({ id }) => !liveTurnIds.has(id)),
      live: projectedThread.turns.filter(({ id }) => liveTurnIds.has(id)),
    }),
    { mergedTurnCount: projectedThread.turns.length },
  );
  const residentOrdinals = view.turnRows.flatMap((row) => row.kind === "turn" && row.sealed ? [row.ordinal] : []);
  const residentMinimum = residentOrdinals.length === 0 ? null : Math.min(...residentOrdinals);
  const residentMaximum = residentOrdinals.length === 0 ? null : Math.max(...residentOrdinals);
  const timeline = projectResidentThreadTimeline(projectedThread.turns, pendingDeliveries, {
    includesEarliest: view.snapshot.earliestSealedOrdinal === null
      || (residentMinimum !== null && residentMinimum <= view.snapshot.earliestSealedOrdinal),
    includesLatest: view.snapshot.latestSealedOrdinal === null
      || (residentMaximum !== null && residentMaximum >= view.snapshot.latestSealedOrdinal),
  });
  return {
    remoteThread: projectedThread,
    remoteSealedTurns: partitions.sealed,
    remoteLiveTurns: partitions.live,
    timeline,
    queuedPrompts,
  };
}
