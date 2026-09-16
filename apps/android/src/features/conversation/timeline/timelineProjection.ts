/** V1 timelineProjection owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ProjectedThreadChatDelivery } from "../../../data/thread-chat-projection";
import { protocolTimestampMs } from "../../../data/thread-chat-timeline";
import { normalizePendingDeliveryState } from "../../../data/thread-delivery-state";
import {
  TimelineDateSequence,
  type TimelineTurnDateLabels,
} from "../../../presentation/conversation/timelineDates";
import { optimisticTimelineKey, remoteTurnTimelineKey } from "../../../rendering/timeline-identity";
import type { TimelineItem } from "./timelineTypes";

export const timelineRowCache = new WeakMap<
  Thread["turns"][number],
  Extract<TimelineItem, { kind: "turn" }>
>();

export const optimisticTimelineRowCache = new WeakMap<
  ProjectedThreadChatDelivery,
  Extract<TimelineItem, { kind: "optimistic" }>
>();

export function projectOptimisticTimelineItem(
  delivery: ProjectedThreadChatDelivery,
  composerScope: string,
): Extract<TimelineItem, { kind: "optimistic" }> {
  const cached = optimisticTimelineRowCache.get(delivery);
  if (cached?.scope === composerScope) {
    return cached;
  }
  const item: Extract<TimelineItem, { kind: "optimistic" }> = {
    attachments: delivery.attachments,
    id: delivery.commandId,
    kind: "optimistic",
    scope: composerScope,
    text: delivery.text,
    ...(delivery.workspaceRequestId === undefined
      ? {}
      : { workspaceRequestId: delivery.workspaceRequestId }),
    createdAt: delivery.createdAt,
    lastError: delivery.lastError,
    status: normalizePendingDeliveryState(delivery.state),
  };
  optimisticTimelineRowCache.set(delivery, item);
  return item;
}

export function projectTimelineTurns(
  turns: readonly Thread["turns"][number][],
  composerScope: string,
  connectionId: string,
  threadId: string,
): Extract<TimelineItem, { kind: "turn" }>[] {
  return turns.map((rawTurn) => {
    const cached = timelineRowCache.get(rawTurn);
    if (cached !== undefined) {
      return cached;
    }
    const item: Extract<TimelineItem, { kind: "turn" }> = {
      connectionId,
      id: rawTurn.id,
      key: `${composerScope}\u0000${rawTurn.id}`,
      kind: "turn",
      scope: composerScope,
      threadId,
      turn: rawTurn,
    };
    timelineRowCache.set(rawTurn, item);
    return item;
  });
}

export function timelineItemKey(item: TimelineItem): string {
  if (item.kind === "turn") {
    return remoteTurnTimelineKey(item.scope, item.id, item.turn.items);
  }
  if (item.kind === "optimistic") {
    return optimisticTimelineKey(item.scope, item.id);
  }
  return `turn-meta-${item.key}`;
}

export function projectTimelineDateLabels(
  items: readonly TimelineItem[],
  includesBeginning: boolean,
): ReadonlyMap<TimelineItem, TimelineTurnDateLabels> {
  const labels = new Map<TimelineItem, TimelineTurnDateLabels>();
  const dates = new TimelineDateSequence(includesBeginning);
  for (const item of items) {
    if (item.kind === "meta") {
      continue;
    }
    const timestampMs = timelineItemTimestampMs(item);
    const before =
      item.kind === "optimistic" || item.turn.items.some((entry) => entry.type === "userMessage")
        ? dates.next(timestampMs)
        : null;
    const completedAt = item.kind === "turn" ? item.turn.completedAt : null;
    const agent =
      item.kind === "turn"
        ? dates.next(completedAt === null ? timestampMs : protocolTimestampMs(completedAt))
        : null;
    if (before !== null || agent !== null) {
      labels.set(item, { agent, before });
    }
  }
  return labels;
}

export function timelineItemTimestampMs(item: TimelineItem): number | null {
  if (item.kind === "optimistic") {
    return Number.isFinite(item.createdAt) ? item.createdAt : null;
  }
  if (item.kind !== "turn") {
    return null;
  }
  return protocolTimestampMs(item.turn.startedAt);
}

export const timelineSearchTextCache = new WeakMap<TimelineItem, string>();

import type { ProjectedThreadChatTimelineEntry } from "../../../data/thread-chat-projection";
import { measureThreadNavigationWork } from "../../../data/thread-navigation-metrics";
import { mergeProjectedThreadPartitions } from "../../../data/thread-partitions";

export function projectConversationTimeline({
  composerScope,
  draftConnectionId,
  draftThreadId,
  remoteLiveTurns,
  remoteSealedTurns,
  remoteThread,
  serverId,
  timelineEntries,
}: {
  composerScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  remoteLiveTurns: readonly Thread["turns"][number][] | undefined;
  remoteSealedTurns: readonly Thread["turns"][number][] | undefined;
  remoteThread: Thread | null | undefined;
  serverId: string;
  timelineEntries: readonly ProjectedThreadChatTimelineEntry[] | undefined;
}) {
  const timelineRemoteThreadId = remoteThread?.id;

  const sealedTimeline =
    remoteSealedTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_sealed_timeline",
          () =>
            projectTimelineTurns(
              remoteSealedTurns,
              composerScope,
              serverId,
              timelineRemoteThreadId,
            ),
          { values: { turnCount: remoteSealedTurns.length } },
        );

  const liveTimeline =
    remoteLiveTurns === undefined || timelineRemoteThreadId === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_live_timeline",
          () =>
            projectTimelineTurns(remoteLiveTurns, composerScope, serverId, timelineRemoteThreadId),
          { values: { turnCount: remoteLiveTurns.length } },
        );

  const fullTimeline =
    remoteThread === null || remoteThread === undefined
      ? []
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_full_timeline",
          () => projectTimelineTurns(remoteThread.turns, composerScope, serverId, remoteThread.id),
          { values: { turnCount: remoteThread.turns.length } },
        );

  const modelTimeline =
    timelineEntries === undefined || timelineRemoteThreadId === undefined
      ? null
      : measureThreadNavigationWork(
          draftConnectionId ?? "",
          draftThreadId,
          "project_model_timeline",
          () =>
            timelineEntries.map((entry) => {
              if (entry.kind !== "turn") {
                return projectOptimisticTimelineItem(entry.delivery, composerScope);
              }
              const projected = projectTimelineTurns(
                [entry.turn],
                composerScope,
                serverId,
                timelineRemoteThreadId,
              )[0];
              if (projected === undefined) {
                throw new Error("A timeline turn projection produced no row");
              }
              return projected;
            }),
          { values: { itemCount: timelineEntries.length } },
        );

  const timeline: TimelineItem[] = measureThreadNavigationWork(
    draftConnectionId ?? "",
    draftThreadId,
    "assemble_timeline",
    () => {
      if (modelTimeline !== null) {
        return modelTimeline;
      }
      const partitioned = remoteSealedTurns !== undefined && remoteLiveTurns !== undefined;
      return remoteThread === null || remoteThread === undefined
        ? []
        : partitioned
          ? mergeProjectedThreadPartitions(remoteThread.turns, sealedTimeline, liveTimeline)
          : fullTimeline;
    },
    {
      values: {
        fullItemCount: fullTimeline.length,
        liveItemCount: liveTimeline.length,
        sealedItemCount: sealedTimeline.length,
      },
    },
  );
  return { timeline };
}
