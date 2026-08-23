import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { NativeCommandDelivery } from "../native/native-transport";
import type { ComposerAttachment, QueuedPrompt } from "./use-remote-workspace";
import { measureThreadNavigationWork } from "./thread-navigation-metrics";
import { mergeThreadPartitions } from "./thread-partitions";
import {
  materializePendingTimeline,
  materializeThreadDetails,
  materializeThreadTurns,
  type ThreadDetailDatabase,
} from "./thread-detail-database";
import type { ThreadChatWindowView } from "./use-thread-chat-window";

export type ProjectedThreadChatWindow = {
  remoteThread: Thread | null;
  remoteSealedTurns: Thread["turns"];
  remoteLiveTurns: Thread["turns"];
  pendingDeliveries: Array<NativeCommandDelivery & { attachments: ComposerAttachment[] }>;
  queuedPrompts: QueuedPrompt[];
};

/** Converts one model-owned resident range into the presentation partitions.
 * Callers choose whether this render contributes to navigation diagnostics. */
export function projectThreadChatWindow(
  database: ThreadDetailDatabase,
  view: ThreadChatWindowView,
  connectionId: string,
  threadId: string | null,
  recordNavigationMeasurements: boolean,
): ProjectedThreadChatWindow {
  const measure = <Value,>(
    name: string,
    operation: () => Value,
    values: Record<string, number>,
  ): Value => recordNavigationMeasurements
    ? measureThreadNavigationWork(connectionId, threadId, name, operation, { values })
    : operation();
  const pendingTimeline = materializePendingTimeline(view.liveRows);
  const pendingDeliveries: ProjectedThreadChatWindow["pendingDeliveries"] = pendingTimeline
    .filter(({ presentation }) => presentation === "delivery")
    .map((entry) => ({
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
    }));
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
    return { remoteThread: null, remoteSealedTurns: [], remoteLiveTurns: [], pendingDeliveries, queuedPrompts };
  }
  const mergedTurns = measure(
    "merge_turn_partitions",
    () => mergeThreadPartitions(sealedTurns, liveSnapshot.thread.turns),
    { sealedTurnCount: sealedTurns.length, liveTurnCount: liveSnapshot.thread.turns.length },
  );
  const liveTurnIds = new Set(liveSnapshot.thread.turns.map(({ id }) => id));
  const partitions = measure(
    "split_visible_turn_partitions",
    () => ({
      sealed: mergedTurns.filter(({ id }) => !liveTurnIds.has(id)),
      live: mergedTurns.filter(({ id }) => liveTurnIds.has(id)),
    }),
    { mergedTurnCount: mergedTurns.length },
  );
  return {
    remoteThread: { ...liveSnapshot.thread, turns: mergedTurns },
    remoteSealedTurns: partitions.sealed,
    remoteLiveTurns: partitions.live,
    pendingDeliveries,
    queuedPrompts,
  };
}
