import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedTurnMetadata } from "@codewide/sync-client";

import type { NativeCommandDelivery } from "../native/native-transport";
import { projectCodexVisibleTurn } from "./codex-contextual-user-message";
import { compactTurnArtifactReferences } from "./turn-artifacts";
import type { PendingDeliveryState } from "./thread-delivery-state";
import type { StoredDraftAttachment } from "./thread-ui-state-types";

export type ProjectedThreadChatDelivery = Omit<NativeCommandDelivery, "state"> & {
  attachments: StoredDraftAttachment[];
  state: PendingDeliveryState;
};

/** One ordered chat row. Delivery state decorates a user row until the server
 * replaces the same client-id row with its authoritative turn. */
export type ProjectedThreadChatTimelineEntry =
  | { kind: "turn"; turn: Thread["turns"][number] }
  | { delivery: ProjectedThreadChatDelivery; kind: "delivery" };

const turnTimelineEntryCache = new WeakMap<
  Thread["turns"][number],
  Extract<ProjectedThreadChatTimelineEntry, { kind: "turn" }>
>();
const deliveryTimelineEntryCache = new WeakMap<
  ProjectedThreadChatDelivery,
  Extract<ProjectedThreadChatTimelineEntry, { kind: "delivery" }>
>();

function hasPresentableTurnItem(item: Thread["turns"][number]["items"][number]): boolean {
  switch (item.type) {
    case "agentMessage":
    case "plan":
      return item.text.trim() !== "";
    case "reasoning":
      return (
        item.summary.some((text) => text.trim() !== "") ||
        item.content.some((text) => text.trim() !== "")
      );
    case "hookPrompt":
      return item.fragments.length > 0;
    case "collabAgentToolCall":
    case "commandExecution":
    case "contextCompaction":
    case "dynamicToolCall":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "fileChange":
    case "imageGeneration":
    case "imageView":
    case "mcpToolCall":
    case "sleep":
    case "subAgentActivity":
    case "userMessage":
    case "webSearch":
      return true;
    default:
      return true;
  }
}

function hasPresentableTurnContent(turn: Thread["turns"][number]): boolean {
  if (turn.items.some(hasPresentableTurnItem)) {
    return true;
  }
  const metadata = projectedTurnMetadata(turn);
  return (metadata?.activity?.count ?? 0) > 0 || compactTurnArtifactReferences(turn).length > 0;
}

function turnTimelineEntry(
  turn: Thread["turns"][number],
): Extract<ProjectedThreadChatTimelineEntry, { kind: "turn" }> {
  const cached = turnTimelineEntryCache.get(turn);
  if (cached !== undefined) {
    return cached;
  }
  const entry = { kind: "turn" as const, turn };
  turnTimelineEntryCache.set(turn, entry);
  return entry;
}

function deliveryTimelineEntry(
  delivery: ProjectedThreadChatDelivery,
): Extract<ProjectedThreadChatTimelineEntry, { kind: "delivery" }> {
  const cached = deliveryTimelineEntryCache.get(delivery);
  if (cached !== undefined) {
    return cached;
  }
  const entry = { delivery, kind: "delivery" as const };
  deliveryTimelineEntryCache.set(delivery, entry);
  return entry;
}

export function protocolTimestampMs(timestamp: number | null): number | null {
  if (timestamp === null || !Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

/**
 * Produces the single chronological row stream consumed by LegendList.
 *
 * Unsettled local sends remain visible alongside the mutable server head.
 * Old failed commands are visible only in their resident history range.
 * A matching authoritative client id wins without adding/removing a second
 * presentation row.
 */
export function projectResidentThreadTimeline(
  turns: readonly Thread["turns"][number][],
  deliveries: readonly ProjectedThreadChatDelivery[],
  range: { includesEarliest: boolean; includesLatest: boolean },
): ProjectedThreadChatTimelineEntry[] {
  const authoritativeClientIds = new Set<string>();
  for (const turn of turns) {
    for (const item of projectCodexVisibleTurn(turn).items) {
      if (
        item.type === "userMessage" &&
        typeof item.clientId === "string" &&
        item.clientId.length > 0
      ) {
        authoritativeClientIds.add(item.clientId);
      }
    }
  }
  const pendingStart = deliveries.some(
    (delivery) =>
      delivery.method === "turn/start" &&
      delivery.state !== "failed" &&
      !authoritativeClientIds.has(delivery.commandId),
  );
  const visibleTurns = turns.flatMap((turn) => {
    const projected = projectCodexVisibleTurn(turn);
    // turn/started, metadata-only recovery and empty reasoning/agent items can
    // precede userMessage. They are lifecycle evidence, not an answer above a
    // still-sending prompt. Preserve unloaded history when no local start owns
    // that waiting state, and never suppress actual server content or tools.
    if (
      projected.status === "inProgress" &&
      !hasPresentableTurnContent(projected) &&
      (projected.itemsView !== "notLoaded" || pendingStart)
    ) {
      return [];
    }
    return projected !== turn && projected.items.length === 0 && turn.status !== "inProgress"
      ? []
      : [projected];
  });
  const turnTimestamps = visibleTurns.flatMap((turn) => {
    const value = protocolTimestampMs(turn.startedAt);
    return value === null ? [] : [value];
  });
  const oldestTurnAt = turnTimestamps.length === 0 ? null : Math.min(...turnTimestamps);
  const newestTurnAt = turnTimestamps.length === 0 ? null : Math.max(...turnTimestamps);
  const visibleDeliveries = deliveries.filter((delivery) => {
    if (authoritativeClientIds.has(delivery.commandId)) {
      return false;
    }
    // Local enqueue happens before a server turn exists. Neither an incomplete
    // history window nor another machine's clock may hide that immediate
    // feedback. Keep it until canonical client-id handoff or terminal failure.
    if (delivery.state !== "failed") {
      return true;
    }
    if (oldestTurnAt === null || newestTurnAt === null) {
      return range.includesLatest;
    }
    return (
      (range.includesEarliest || delivery.createdAt >= oldestTurnAt) &&
      (range.includesLatest || delivery.createdAt <= newestTurnAt)
    );
  });
  const ordered: Array<{
    entry: ProjectedThreadChatTimelineEntry;
    sourceOrder: number;
    tieBreaker: string;
    timestampMs: number | null;
  }> = [
    ...visibleTurns.map((turn, index) => ({
      entry: turnTimelineEntry(turn),
      sourceOrder: index,
      tieBreaker: turn.id,
      timestampMs: protocolTimestampMs(turn.startedAt),
    })),
    ...visibleDeliveries.map((delivery, index) => ({
      entry: deliveryTimelineEntry(delivery),
      sourceOrder: visibleTurns.length + index,
      tieBreaker: delivery.commandId,
      timestampMs: delivery.createdAt,
    })),
  ];
  ordered.sort((left, right) => {
    if (
      left.timestampMs !== null &&
      right.timestampMs !== null &&
      left.timestampMs !== right.timestampMs
    ) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs === null && right.timestampMs !== null) {
      return -1;
    }
    if (left.timestampMs !== null && right.timestampMs === null) {
      return 1;
    }
    const sourceOrder = left.sourceOrder - right.sourceOrder;
    return sourceOrder !== 0 ? sourceOrder : left.tieBreaker.localeCompare(right.tieBreaker);
  });
  return ordered.map(({ entry }) => entry);
}
