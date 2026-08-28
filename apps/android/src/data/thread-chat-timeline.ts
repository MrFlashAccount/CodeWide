import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { NativeCommandDelivery } from "../native/native-transport";
import { projectCodexVisibleTurn } from "./codex-contextual-user-message";
import type { PendingDeliveryState } from "./thread-delivery-state";
import type { ComposerAttachment } from "./use-remote-workspace";

export type ProjectedThreadChatDelivery = Omit<NativeCommandDelivery, "state"> & {
  attachments: ComposerAttachment[];
  state: PendingDeliveryState;
};

/** One ordered chat row. Delivery state decorates a user row until the server
 * replaces the same client-id row with its authoritative turn. */
export type ProjectedThreadChatTimelineEntry =
  | { kind: "turn"; turn: Thread["turns"][number] }
  | { kind: "delivery"; delivery: ProjectedThreadChatDelivery };

const turnTimelineEntryCache = new WeakMap<Thread["turns"][number], Extract<ProjectedThreadChatTimelineEntry, { kind: "turn" }>>();
const deliveryTimelineEntryCache = new WeakMap<ProjectedThreadChatDelivery, Extract<ProjectedThreadChatTimelineEntry, { kind: "delivery" }>>();

function turnTimelineEntry(turn: Thread["turns"][number]): Extract<ProjectedThreadChatTimelineEntry, { kind: "turn" }> {
  const cached = turnTimelineEntryCache.get(turn);
  if (cached !== undefined) return cached;
  const entry = { kind: "turn" as const, turn };
  turnTimelineEntryCache.set(turn, entry);
  return entry;
}

function deliveryTimelineEntry(delivery: ProjectedThreadChatDelivery): Extract<ProjectedThreadChatTimelineEntry, { kind: "delivery" }> {
  const cached = deliveryTimelineEntryCache.get(delivery);
  if (cached !== undefined) return cached;
  const entry = { kind: "delivery" as const, delivery };
  deliveryTimelineEntryCache.set(delivery, entry);
  return entry;
}

export function protocolTimestampMs(timestamp: number | null): number | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

/**
 * Produces the single chronological row stream consumed by LegendList.
 *
 * Pending rows are range members, not a global overlay: an old failed command
 * is visible only while the resident history window covers its creation time.
 * A matching authoritative client id wins without adding/removing a second
 * presentation row.
 */
export function projectResidentThreadTimeline(
  turns: readonly Thread["turns"][number][],
  deliveries: readonly ProjectedThreadChatDelivery[],
  range: { includesEarliest: boolean; includesLatest: boolean },
): ProjectedThreadChatTimelineEntry[] {
  const visibleTurns = turns.flatMap((turn) => {
    const projected = projectCodexVisibleTurn(turn);
    return projected !== turn && projected.items.length === 0 && turn.status !== "inProgress"
      ? []
      : [projected];
  });
  const authoritativeClientIds = new Set(visibleTurns.flatMap((turn) => turn.items.flatMap((item) => (
    item.type === "userMessage" && typeof item.clientId === "string" && item.clientId.length > 0
      ? [item.clientId]
      : []
  ))));
  const turnTimestamps = visibleTurns.flatMap((turn) => {
    const value = protocolTimestampMs(turn.startedAt);
    return value === null ? [] : [value];
  });
  const oldestTurnAt = turnTimestamps.length === 0 ? null : Math.min(...turnTimestamps);
  const newestTurnAt = turnTimestamps.length === 0 ? null : Math.max(...turnTimestamps);
  const visibleDeliveries = deliveries.filter((delivery) => {
    if (authoritativeClientIds.has(delivery.commandId)) return false;
    if (oldestTurnAt === null || newestTurnAt === null) return range.includesLatest;
    return (range.includesEarliest || delivery.createdAt >= oldestTurnAt)
      && (range.includesLatest || delivery.createdAt <= newestTurnAt);
  });
  const ordered = [
    ...visibleTurns.map((turn, index) => ({
      entry: turnTimelineEntry(turn) as ProjectedThreadChatTimelineEntry,
      timestampMs: protocolTimestampMs(turn.startedAt),
      sourceOrder: index,
      tieBreaker: turn.id,
    })),
    ...visibleDeliveries.map((delivery, index) => ({
      entry: deliveryTimelineEntry(delivery) as ProjectedThreadChatTimelineEntry,
      timestampMs: delivery.createdAt,
      sourceOrder: visibleTurns.length + index,
      tieBreaker: delivery.commandId,
    })),
  ];
  ordered.sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs === null && right.timestampMs !== null) return -1;
    if (left.timestampMs !== null && right.timestampMs === null) return 1;
    return left.sourceOrder - right.sourceOrder || left.tieBreaker.localeCompare(right.tieBreaker);
  });
  return ordered.map(({ entry }) => entry);
}
