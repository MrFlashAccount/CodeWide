import type { Thread, Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  projectedOutputFootprint,
  projectedTurnMetadata,
  reconcileTurnItems,
  sumOutputFootprints,
  type ProjectedTurnMetadata,
  type RemoteFileAttachment,
} from "@codewide/sync-client";

import { cloneProtocolValue } from "./clone-protocol-value";
import { unknownRecord } from "./unknownRecord";
import { compactTurnArtifactReferences } from "./turn-artifacts";
import type { ThreadCurrentUsage } from "./thread-current-usage";
import type { ThreadCurrentOutcome } from "./thread-current-outcome";
import type { CommandReceipt } from "./command-receipt-evidence";

import { deduplicateThreadTurns } from "./thread-partitions";
import {
  deliveryProgressRank,
  normalizePendingDeliveryState,
  type PendingDeliveryState,
} from "./thread-delivery-state";

export type ThreadDetailRow = {
  activityItems: Turn["items"] | null;
  connectionId: string;
  /** Current tail outcome; history navigation must not replace the error banner. */
  currentOutcome?: ThreadCurrentOutcome | null;
  /** Current tail usage; historical page imports must preserve this checkpoint. */
  currentUsage?: ThreadCurrentUsage | null;
  historyCoverageMaxOrdinal?: number | null;
  /**
   * Inclusive ordinal interval proven to be a contiguous authoritative cache
   * range. Missing means that persisted rows predate the coverage contract and
   * must be refreshed before they can satisfy a render request.
   */
  historyCoverageMinOrdinal?: number | null;
  /**
   * Opaque continuation for the oldest durable turn in this epoch. Present on
   * the thread row only. Missing means the current live shell has not received
   * an authoritative history window; null means the server proved it complete.
   */
  historyCursor?: string | null;
  /** Identifies one contiguous cursor chain for this thread. */
  historyEpoch: number;
  /**
   * Monotonic proof that this thread has had authoritative turn history.
   * `false` is written only for a server-proven empty history. `true` survives
   * FIFO eviction, allowing a metadata-only row to be recognized as a cache
   * miss instead of an empty conversation.
   */
  historyHadTurns?: boolean;
  /** Opaque server source checkpoint, passed back when reading adjacent history. */
  historySourceWitness?: string;
  id: string;
  kind: "thread" | "turn" | "turnMeta" | "activity" | "pending";
  lastOpenedAt: number;
  ordinal: number;
  /**
   * Local delivery intent projected into the same collection as authoritative
   * turns. The row id is derived from commandId and is deliberately identical
   * to the future authoritative turn row whenever App Server echoes clientId.
   */
  pending?: PendingTimelineEntry | null;
  /** Durable replay cursor already represented by the authoritative thread snapshot. */
  projectionCursor?: number;
  remoteThreadId: string;
  remoteTurnId: string | null;
  sealed: boolean;
  sessionId: string | null;
  thread: Thread | null;
  turn: Turn | null;
  turnMetadata: ProjectedTurnMetadata | null;
};

/**
 * Gives a bounded authoritative page stable global ordinals. Server history
 * pages do not carry an ordinal, so their array indexes are page-local and
 * cannot be persisted directly once older or live rows already exist.
 *
 * An overlapping turn anchors the page to the existing sequence. If a client
 * missed more turns than the server overlap and there is no anchor, the
 * authoritative page is the newest known tail and is appended after the
 * greatest persisted ordinal.
 */
export function projectAuthoritativeTurnOrdinals(
  existingRows: readonly Pick<ThreadDetailRow, "kind" | "remoteTurnId" | "ordinal">[],
  incomingTurnIds: readonly string[],
): ReadonlyMap<string, number> {
  const existingByTurnId = new Map<string, number>();
  let maxOrdinal = -1;
  for (const row of existingRows) {
    if (row.kind !== "turn" || row.remoteTurnId === null) {
      continue;
    }
    existingByTurnId.set(row.remoteTurnId, row.ordinal);
    maxOrdinal = Math.max(maxOrdinal, row.ordinal);
  }

  let baseOrdinal: number | null = null;
  for (let index = 0; index < incomingTurnIds.length; index += 1) {
    const incomingTurnId = incomingTurnIds[index];
    if (incomingTurnId === undefined) {
      continue;
    }
    const existingOrdinal = existingByTurnId.get(incomingTurnId);
    if (existingOrdinal === undefined) {
      continue;
    }
    baseOrdinal = existingOrdinal - index;
    break;
  }
  baseOrdinal ??= maxOrdinal + 1;

  return new Map(incomingTurnIds.map((turnId, index) => [turnId, baseOrdinal + index]));
}

/** Starts a new contiguous cursor chain when the newest authoritative page has
 * no turn in common with the currently visible history island. */
export function projectAuthoritativeHistoryEpoch(
  existingRows: readonly Pick<
    ThreadDetailRow,
    "kind" | "remoteTurnId" | "historyEpoch" | "ordinal"
  >[],
  incomingTurnIds: readonly string[],
): number {
  const currentEpoch = existingRows.find((row) => row.kind === "thread")?.historyEpoch ?? 0;
  const currentTurns = currentHistoryTurns(existingRows, currentEpoch);
  if (currentTurns.length === 0 || incomingTurnIds.length === 0) {
    return currentEpoch;
  }
  const ordinalsByTurnId = new Map(currentTurns.map(({ id, ordinal }) => [id, ordinal]));
  const turnIdByOrdinal = new Map(currentTurns.map(({ id, ordinal }) => [ordinal, id]));
  const baseOrdinal = authoritativeHistoryBaseOrdinal(incomingTurnIds, ordinalsByTurnId);
  if (baseOrdinal === null) {
    return currentEpoch + 1;
  }
  const conflicts = authoritativeHistoryConflicts(incomingTurnIds, baseOrdinal, {
    ordinalsByTurnId,
    turnIdByOrdinal,
  });
  return conflicts ? currentEpoch + 1 : currentEpoch;
}

function currentHistoryTurns(
  existingRows: readonly Pick<
    ThreadDetailRow,
    "kind" | "remoteTurnId" | "historyEpoch" | "ordinal"
  >[],
  currentEpoch: number,
): { id: string; ordinal: number }[] {
  return existingRows.flatMap((row) =>
    row.kind === "turn" && row.historyEpoch === currentEpoch && row.remoteTurnId !== null
      ? [{ id: row.remoteTurnId, ordinal: row.ordinal }]
      : [],
  );
}

function authoritativeHistoryBaseOrdinal(
  incomingTurnIds: readonly string[],
  ordinalsByTurnId: ReadonlyMap<string, number>,
): number | null {
  const firstOverlapIndex = incomingTurnIds.findIndex((turnId) => ordinalsByTurnId.has(turnId));
  const overlapId = incomingTurnIds[firstOverlapIndex];
  const overlapOrdinal = overlapId === undefined ? undefined : ordinalsByTurnId.get(overlapId);
  return overlapOrdinal === undefined ? null : overlapOrdinal - firstOverlapIndex;
}

function authoritativeHistoryConflicts(
  incomingTurnIds: readonly string[],
  baseOrdinal: number,
  indexes: {
    ordinalsByTurnId: ReadonlyMap<string, number>;
    turnIdByOrdinal: ReadonlyMap<number, string>;
  },
): boolean {
  return incomingTurnIds.some((turnId, index) => {
    const projectedOrdinal = baseOrdinal + index;
    const existingOrdinal = indexes.ordinalsByTurnId.get(turnId);
    const existingTurnId = indexes.turnIdByOrdinal.get(projectedOrdinal);
    return (
      (existingOrdinal !== undefined && existingOrdinal !== projectedOrdinal) ||
      (existingTurnId !== undefined && existingTurnId !== turnId)
    );
  });
}

/** Assigns one older cursor page immediately before the current epoch's
 * minimum. Rows encountered in an obsolete epoch migrate into the current
 * chain instead of preserving their disconnected ordinal. */
export function projectPrependedTurnOrdinals(
  existingRows: readonly Pick<
    ThreadDetailRow,
    "kind" | "remoteTurnId" | "historyEpoch" | "ordinal"
  >[],
  historyEpoch: number,
  incomingTurnIds: readonly string[],
): ReadonlyMap<string, number> {
  const currentOrdinals = new Map(
    existingRows.flatMap((row) =>
      row.kind === "turn" && row.historyEpoch === historyEpoch && row.remoteTurnId !== null
        ? [[row.remoteTurnId, row.ordinal] as const]
        : [],
    ),
  );
  const additions = incomingTurnIds.filter((turnId) => !currentOrdinals.has(turnId));
  const currentValues = [...currentOrdinals.values()];
  let nextOrdinal =
    (currentValues.length === 0 ? 0 : Math.min(...currentValues)) - additions.length;
  return new Map(
    incomingTurnIds.map((turnId) => {
      const existing = currentOrdinals.get(turnId);
      return [turnId, existing ?? nextOrdinal++] as const;
    }),
  );
}

export type PendingTimelineEntry = {
  attachments: RemoteFileAttachment[];
  attempts: number;
  commandId: string;
  createdAt: number;
  lastError: string | null;
  method: "turn/start" | "turn/steer";
  order: number;
  presentation: "delivery" | "queue";
  text: string;
  updatedAt: number;
  workspaceRequestId?: string | null;
} & (
  | { confirmation?: undefined; state: PendingDeliveryState }
  | { confirmation: CommandReceipt; state: "appServerAccepted" }
);

export type PendingTimelineMutation = {
  beforeCommandId?: string | null;
  deletes: readonly string[];
  upserts: readonly ThreadDetailRow[];
};

export type PendingTimelineOverlay = {
  connectionId: string;
  key: string;
  row: ThreadDetailRow | null;
  threadId: string;
};

/** Applies optimistic pending rows and tombstones to an older SQLite snapshot.
 * A server turn with the same stable client id always wins the takeover. */
export function mergePendingTimelineOverlays(
  persistedRows: readonly ThreadDetailRow[],
  overlays: readonly PendingTimelineOverlay[],
  connectionId: string,
  threadId: string,
): ThreadDetailRow[] {
  const rows = new Map<string, ThreadDetailRow | null>(persistedRows.map((row) => [row.id, row]));
  for (const overlay of overlays) {
    if (overlay.connectionId !== connectionId || overlay.threadId !== threadId) {
      continue;
    }
    if (rows.get(overlay.key)?.kind === "turn") {
      continue;
    }
    rows.set(overlay.key, overlay.row);
  }
  return [...rows.values()].flatMap((row) => (row === null ? [] : [row]));
}

export function reusableTurnOrdinal(
  row: ThreadDetailRow | undefined,
  historyEpoch: number,
): number | null {
  return row?.kind === "turn" && row.historyEpoch === historyEpoch ? row.ordinal : null;
}

/**
 * Merges transport observations without allowing a late native receipt to
 * move an App Server-accepted command backwards. A failed or uncertain command
 * may still enter a new sending attempt. Only a canonical turn with the same
 * stable client id removes the pending row.
 */
// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
export function mergePendingTimelineEntry(
  previous: PendingTimelineEntry,
  incoming: PendingTimelineEntry,
): PendingTimelineEntry {
  if (previous.confirmation !== undefined) {
    return previous;
  }
  if (incoming.confirmation !== undefined) {
    return mergePendingAttachments(previous, incoming);
  }
  const previousState = normalizePendingDeliveryState(previous.state);
  const incomingState = normalizePendingDeliveryState(incoming.state);
  if (previousState === "appServerAccepted") {
    return { ...previous, state: previousState };
  }
  if (incomingState === "appServerAccepted") {
    return mergePendingAttachments(previous, { ...incoming, state: incomingState });
  }
  const retryStarted =
    (previousState === "failed" || previousState === "uncertain") &&
    (incomingState === "queued" ||
      incomingState === "sending" ||
      incomingState === "companionAccepted");
  const previousRank = deliveryProgressRank(previousState);
  const incomingRank = deliveryProgressRank(incomingState);
  if (!retryStarted && incomingRank < previousRank) {
    return { ...previous, state: previousState };
  }
  const normalized = { ...incoming, state: incomingState };
  if (!retryStarted && incomingRank === previousRank && incoming.updatedAt < previous.updatedAt) {
    return { ...previous, state: previousState };
  }
  return mergePendingAttachments(previous, normalized);
}

function mergePendingAttachments(
  previous: PendingTimelineEntry,
  incoming: PendingTimelineEntry,
): PendingTimelineEntry {
  return incoming.attachments.length === 0 && previous.attachments.length > 0
    ? { ...incoming, attachments: previous.attachments }
    : incoming;
}

export function planQueuedEditMutation(
  row: ThreadDetailRow | undefined,
  text: string,
  attachments: RemoteFileAttachment[],
  updatedAt = Date.now(),
): PendingTimelineMutation | null {
  if (row?.kind !== "pending" || row.pending?.presentation !== "queue") {
    return null;
  }
  return {
    deletes: [],
    upserts: [
      { ...row, pending: { ...row.pending, attachments, lastError: null, text, updatedAt } },
    ],
  };
}

export function planQueuedRemovalMutation(
  row: ThreadDetailRow | undefined,
): PendingTimelineMutation | null {
  if (row?.kind !== "pending" || row.pending?.presentation !== "queue") {
    return null;
  }
  return { deletes: [row.id], upserts: [] };
}

// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
export function planQueuedMoveMutation(
  candidates: readonly ThreadDetailRow[],
  commandId: string,
  direction: -1 | 1,
  updatedAt = Date.now(),
): PendingTimelineMutation | null {
  const rows = candidates
    .filter((row) => row.kind === "pending" && row.pending?.presentation === "queue")
    .sort((left, right) => {
      const leftPending = left.pending;
      const rightPending = right.pending;
      if (leftPending === null || leftPending === undefined) {
        return 1;
      }
      if (rightPending === null || rightPending === undefined) {
        return -1;
      }
      const order = leftPending.order - rightPending.order;
      return order !== 0 ? order : leftPending.createdAt - rightPending.createdAt;
    });
  const index = rows.findIndex((row) => row.pending?.commandId === commandId);
  const current = rows[index];
  const neighbor = rows[index + direction];
  if (
    current?.pending === null ||
    current?.pending === undefined ||
    neighbor?.pending === null ||
    neighbor?.pending === undefined
  ) {
    return null;
  }
  const reordered = rows.slice();
  reordered[index] = neighbor;
  reordered[index + direction] = current;
  return {
    beforeCommandId: reordered[index + direction + 1]?.pending?.commandId ?? null,
    deletes: [],
    upserts: [
      { ...current, pending: { ...current.pending, order: neighbor.pending.order, updatedAt } },
      { ...neighbor, pending: { ...neighbor.pending, order: current.pending.order, updatedAt } },
    ],
  };
}

export function pendingTimelineRowId(
  connectionId: string,
  threadId: string,
  commandId: string,
): string {
  return `${connectionId}\u0000${threadId}\u0000turnClient\u0000${commandId}`;
}

/**
 * Runtime recovery values can contain a metadata-only turn envelope even
 * though the generated protocol type requires `items`. Keep that compatibility
 * rule inside the Conversation projection: reuse resident content when it is
 * available, otherwise represent the shell explicitly as not loaded.
 */
export function normalizeConversationTurn(turn: Turn, resident: Turn | null = null): Turn {
  const turnRecord = unknownRecord(turn);
  if (turn.itemsView !== "notLoaded" && Array.isArray(turnRecord?.items)) {
    return turn;
  }
  const residentRecord = unknownRecord(resident);
  if (resident !== null && Array.isArray(residentRecord?.items)) {
    return { ...turn, items: resident.items, itemsView: resident.itemsView };
  }
  return { ...turn, items: [], itemsView: "notLoaded" };
}

export function authoritativeTimelineRowId(
  connectionId: string,
  threadId: string,
  turn: Turn,
): string {
  const items = Array.isArray(unknownRecord(turn)?.items) ? turn.items : [];
  const user = items.find(
    (item): item is Extract<Turn["items"][number], { type: "userMessage" }> =>
      item.type === "userMessage",
  );
  return typeof user?.clientId === "string" && user.clientId.length > 0
    ? pendingTimelineRowId(connectionId, threadId, user.clientId)
    : `${connectionId}\u0000${threadId}\u0000turn\u0000${turn.id}`;
}

export type ThreadDetailSnapshot = {
  connectionId: string;
  fresh: boolean;
  thread: Thread;
};

type MaterializedTurnCacheEntry = {
  activity: Turn["items"] | undefined;
  metadata: ProjectedTurnMetadata | undefined;
  value: Turn;
};

// Completed turn rows are immutable. Preserve their object identity across
// live-query emissions so LegendList does not rematerialize static history
// when only the active turn or a tiny metadata overlay changed.
const materializedTurnCache = new WeakMap<Turn, MaterializedTurnCacheEntry>();

export function materializeThreadDetails(
  rows: Iterable<ThreadDetailRow>,
  currentSessionId: string,
): ThreadDetailSnapshot[] {
  const values = [...rows];
  return values
    .filter((row) => row.kind === "thread")
    .flatMap((row) => {
      const snapshot = materializeThreadDetail(
        values,
        row.connectionId,
        row.remoteThreadId,
        currentSessionId,
      );
      return snapshot === null ? [] : [snapshot];
    });
}

// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
export function materializeThreadDetail(
  rows: Iterable<ThreadDetailRow>,
  connectionId: string,
  threadId: string,
  currentSessionId: string,
): ThreadDetailSnapshot | null {
  const values = [...rows];
  const meta =
    values.find(
      (row) =>
        row.connectionId === connectionId &&
        row.remoteThreadId === threadId &&
        row.kind === "thread",
    ) ?? null;
  if (meta?.thread === null || meta === null) {
    return null;
  }
  const turns = new Map<string, ThreadDetailRow>();
  const turnMetadata = new Map<string, ProjectedTurnMetadata>();
  const activities = new Map<string, Turn["items"]>();
  for (const row of values) {
    if (row.connectionId !== connectionId || row.remoteThreadId !== threadId) {
      continue;
    }
    if (row.kind !== "thread" && row.kind !== "pending" && row.historyEpoch !== meta.historyEpoch) {
      continue;
    }
    if (row.remoteTurnId !== null && row.kind === "turn") {
      turns.set(row.remoteTurnId, row);
    } else if (row.remoteTurnId !== null && row.kind === "turnMeta" && row.turnMetadata !== null) {
      turnMetadata.set(row.remoteTurnId, row.turnMetadata);
    } else if (row.remoteTurnId !== null && row.kind === "activity" && row.activityItems !== null) {
      activities.set(row.remoteTurnId, row.activityItems);
    }
  }
  const ordered = deduplicateThreadTurns(
    [...turns.values()].sort(compareTurnRows).flatMap((row) => {
      if (row.turn === null) {
        return [];
      }
      const activity = row.remoteTurnId === null ? undefined : activities.get(row.remoteTurnId);
      const metadata = row.remoteTurnId === null ? undefined : turnMetadata.get(row.remoteTurnId);
      return [materializeTurn(row.turn, activity, metadata)];
    }),
  );
  return {
    connectionId,
    fresh: meta.sessionId === currentSessionId,
    thread: { ...meta.thread, turns: ordered },
  };
}

/**
 * Materializes an immutable row partition without requiring the mutable thread
 * envelope. The UI subscribes to sealed and live rows separately, so streaming
 * a single active turn never reparses or resorts the full retained history.
 */
export function materializeThreadTurns(rows: Iterable<ThreadDetailRow>): Turn[] {
  const turns = new Map<string, ThreadDetailRow>();
  const turnMetadata = new Map<string, ProjectedTurnMetadata>();
  const activities = new Map<string, Turn["items"]>();
  for (const row of rows) {
    if (row.remoteTurnId === null) {
      continue;
    }
    if (row.kind === "turn") {
      turns.set(row.remoteTurnId, row);
    } else if (row.kind === "turnMeta" && row.turnMetadata !== null) {
      turnMetadata.set(row.remoteTurnId, row.turnMetadata);
    } else if (row.kind === "activity" && row.activityItems !== null) {
      activities.set(row.remoteTurnId, row.activityItems);
    }
  }
  return deduplicateThreadTurns(
    [...turns.values()].sort(compareTurnRows).flatMap((row) => {
      if (row.turn === null || row.remoteTurnId === null) {
        return [];
      }
      return [
        materializeTurn(
          row.turn,
          activities.get(row.remoteTurnId),
          turnMetadata.get(row.remoteTurnId),
        ),
      ];
    }),
  );
}

export function materializePendingTimeline(
  rows: Iterable<ThreadDetailRow>,
): PendingTimelineEntry[] {
  return [...rows]
    .flatMap((row) =>
      row.kind === "pending" && row.pending !== null && row.pending !== undefined
        ? [row.pending]
        : [],
    )
    .sort((left, right) => {
      const order = left.order - right.order;
      if (order !== 0) {
        return order;
      }
      const createdAtOrder = left.createdAt - right.createdAt;
      return createdAtOrder !== 0 ? createdAtOrder : left.commandId.localeCompare(right.commandId);
    });
}

/**
 * A ledger read can predate enqueue, and queue handoffs need not have a direct
 * native command at all. Absence from that ledger cannot retire authored text.
 * Only a canonical user item in this projection proves the replacement exists.
 * This also cleans up steered messages whose client id is not the turn's first
 * user id (and therefore does not own its storage key).
 */
export function planPendingDeliveryProjectionCleanup(
  rows: Iterable<ThreadDetailRow>,
  activeCommandIds: ReadonlySet<string>,
): PendingTimelineMutation {
  const values = [...rows];
  const canonicalRows = new Set<string>();
  for (const row of values) {
    if (row.kind !== "turn" || row.turn === null) {
      continue;
    }
    for (const item of row.turn.items) {
      if (
        item.type === "userMessage" &&
        typeof item.clientId === "string" &&
        item.clientId.length > 0
      ) {
        canonicalRows.add(
          pendingTimelineRowId(row.connectionId, row.remoteThreadId, item.clientId),
        );
      }
    }
  }
  const deletes = values.flatMap((row) =>
    row.kind === "pending" &&
    row.pending?.presentation === "delivery" &&
    !activeCommandIds.has(row.pending.commandId) &&
    canonicalRows.has(
      pendingTimelineRowId(row.connectionId, row.remoteThreadId, row.pending.commandId),
    )
      ? [row.id]
      : [],
  );
  return { deletes, upserts: [] };
}

/** Keeps only the caller-provided mutable head when it changed after an RPC began. */
export function reconcileAuthoritativeThread(
  incoming: Thread,
  currentMutableHead: Thread | null | undefined,
  preserveConcurrentHead: boolean,
): Thread {
  if (!preserveConcurrentHead || currentMutableHead === null || currentMutableHead === undefined) {
    return incoming;
  }
  const incomingById = new Map(incoming.turns.map((turn) => [turn.id, turn] as const));
  const turns = incoming.turns.map((turn) => {
    const previous = currentMutableHead.turns.find((candidate) => candidate.id === turn.id);
    return previous ?? turn;
  });
  for (const turn of currentMutableHead.turns) {
    if (!incomingById.has(turn.id)) {
      turns.push(turn);
    }
  }
  turns.sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
  return { ...incoming, turns };
}

/**
 * Sealed turns keep their chat boundary in the resident row while activity is
 * fetched into its own immutable overlay. This prevents a completed turn with
 * megabytes of stdout/diffs from blocking newer live events without losing the
 * activity index needed to render and hydrate its collapsed tool-call row.
 */
// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
export function compactCompletedTurnForStorage(turn: Turn): Turn {
  if (turn.status === "inProgress" || turn.itemsView !== "full") {
    return turn;
  }
  let latestAgentIndex = -1;
  let explicitFinalAgentIndex = -1;
  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index];
    if (item?.type !== "agentMessage" || item.text.trim() === "") {
      continue;
    }
    latestAgentIndex = index;
    if (item.phase === "final_answer") {
      explicitFinalAgentIndex = index;
    }
  }
  // App Server may finish an interrupted/churned turn with an empty terminal
  // agent placeholder after text that was already streamed. That placeholder
  // is lifecycle evidence, not the chat boundary: compacting around it would
  // discard the visible answer and produce "Completed without final response".
  const finalAgentIndex = explicitFinalAgentIndex >= 0 ? explicitFinalAgentIndex : latestAgentIndex;
  const retained = turn.items.filter(
    (item, index) => item.type === "userMessage" || index === finalAgentIndex,
  );
  const kinds = turn.items.flatMap((item, index) =>
    item.type === "userMessage" || index === finalAgentIndex ? [] : [item.type],
  );
  if (kinds.length === 0) {
    return turn;
  }
  const metadata = projectedTurnMetadata(turn) ?? {};
  const artifacts = compactTurnArtifactReferences(turn);
  const outputFootprint = sumOutputFootprints(
    turn.items.map((item) =>
      projectedOutputFootprint(unknownRecord(item)?.codewideOutputFootprint),
    ),
  );
  const compacted: Turn & { codewide: ProjectedTurnMetadata } = {
    ...turn,
    codewide: {
      ...metadata,
      ...(artifacts.length === 0 ? {} : { artifacts }),
      activity: {
        ...metadata.activity,
        count: kinds.length,
        kinds,
        ...(outputFootprint === null ? {} : { outputFootprint }),
      },
    },
    items: retained,
    itemsView: "summary",
  };
  return compacted;
}

// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
function materializeTurn(
  source: Turn,
  activity: Turn["items"] | undefined,
  metadata: ProjectedTurnMetadata | undefined,
): Turn {
  if (activity === undefined && metadata === undefined) {
    return source;
  }
  const cached = materializedTurnCache.get(source);
  if (cached !== undefined && cached.activity === activity && cached.metadata === metadata) {
    return cached.value;
  }
  const base: Turn =
    activity === undefined
      ? { ...source }
      : {
          ...source,
          items: mergeSummaryWithActivity(source.items, activity),
          itemsView: "full" as const,
        };
  const extended: Turn & { codewide: ProjectedTurnMetadata } = {
    ...base,
    codewide: cloneProtocolValue(metadata ?? {}),
  };
  const value: Turn = metadata === undefined ? base : extended;
  materializedTurnCache.set(source, { activity, metadata, value });
  return value;
}

export function shouldApplyLiveThreadRow(
  previous: ThreadDetailRow | undefined,
  next: ThreadDetailRow,
): boolean {
  return shouldWriteThreadDetailRow(previous, next);
}

/** A sealed row is immutable inside one history generation. */
export function reconcileAuthoritativeThreadDetailRow(
  previous: ThreadDetailRow | undefined,
  next: ThreadDetailRow,
): ThreadDetailRow {
  return previous?.kind === "turn" &&
    previous.sealed &&
    next.kind === "turn" &&
    previous.historyEpoch === next.historyEpoch
    ? previous
    : next;
}

/** Only a mutable row, or the same turn in a new history generation, is writable. */
export function shouldWriteAuthoritativeThreadDetailRow(
  previous: ThreadDetailRow | undefined,
  next: ThreadDetailRow,
): boolean {
  // Sealing protects content inside a chain, not membership in a new chain.
  // Persistence reuses the content revision when only epoch/position changed.
  if (previous?.kind === "turn" && previous.sealed && next.kind === "turn") {
    return previous.historyEpoch !== next.historyEpoch;
  }
  return shouldWriteThreadDetailRow(previous, next);
}

/** Large completed content and hydrated activity are immutable cache entries. */
export function shouldWriteThreadDetailRow(
  previous: ThreadDetailRow | undefined,
  next: ThreadDetailRow,
): boolean {
  if (next.kind === "turn") {
    return previous?.sealed !== true;
  }
  if (next.kind === "activity") {
    return previous === undefined;
  }
  return true;
}

/**
 * An explicit per-turn hydration is also the repair path for evicted private
 * assets. Unlike passive history refreshes, it must be allowed to replace an
 * already cached activity row when the companion returns a fresh projection.
 */
export function shouldWriteHydratedActivityRow(
  previous: ThreadDetailRow | undefined,
  next: ThreadDetailRow,
): boolean {
  if (next.kind !== "activity") {
    return false;
  }
  if (previous?.kind !== "activity") {
    return true;
  }
  return JSON.stringify(previous.activityItems) !== JSON.stringify(next.activityItems);
}

function mergeSummaryWithActivity(summary: Turn["items"], activity: Turn["items"]): Turn["items"] {
  const activityIds = new Set(activity.map((item) => item.id));
  if (summary.every((item) => activityIds.has(item.id))) {
    return activity;
  }
  return reconcileTurnItems(activity, summary);
}

// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
function compareTurnRows(left: ThreadDetailRow, right: ThreadDetailRow): number {
  const leftStartedAt = left.turn?.startedAt;
  const rightStartedAt = right.turn?.startedAt;
  if (
    leftStartedAt !== null &&
    leftStartedAt !== undefined &&
    rightStartedAt !== null &&
    rightStartedAt !== undefined &&
    leftStartedAt !== rightStartedAt
  ) {
    return leftStartedAt - rightStartedAt;
  }
  const ordinalOrder = left.ordinal - right.ordinal;
  return ordinalOrder !== 0 ? ordinalOrder : left.id.localeCompare(right.id);
}
