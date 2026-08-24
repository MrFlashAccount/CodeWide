import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedOutputFootprint, projectedTurnMetadata, reconcileTurnItems, sumOutputFootprints, type ProjectedTurnMetadata, type RemoteFileAttachment } from "@codewide/sync-client";

import { deduplicateThreadTurns } from "./thread-partitions";

export type ThreadDetailRow = {
  id: string;
  kind: "thread" | "turn" | "turnMeta" | "activity" | "pending";
  connectionId: string;
  remoteThreadId: string;
  remoteTurnId: string | null;
  /** Identifies one contiguous cursor chain for this thread. */
  historyEpoch: number;
  /**
   * Opaque continuation for the oldest durable turn in this epoch. Present on
   * the thread row only. Missing means an older app cached the history before
   * cursor persistence existed; null means the server proved it complete.
   */
  historyCursor?: string | null;
  ordinal: number;
  sessionId: string | null;
  lastOpenedAt: number;
  sealed: boolean;
  thread: Thread | null;
  turn: Turn | null;
  turnMetadata: ProjectedTurnMetadata | null;
  activityItems: Turn["items"] | null;
  /**
   * Local delivery intent projected into the same collection as authoritative
   * turns. The row id is derived from commandId and is deliberately identical
   * to the future authoritative turn row whenever App Server echoes clientId.
   */
  pending?: PendingTimelineEntry | null;
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
    if (row.kind !== "turn" || row.remoteTurnId === null) continue;
    existingByTurnId.set(row.remoteTurnId, row.ordinal);
    maxOrdinal = Math.max(maxOrdinal, row.ordinal);
  }

  let baseOrdinal: number | null = null;
  for (let index = 0; index < incomingTurnIds.length; index += 1) {
    const existingOrdinal = existingByTurnId.get(incomingTurnIds[index]!);
    if (existingOrdinal === undefined) continue;
    baseOrdinal = existingOrdinal - index;
    break;
  }
  baseOrdinal ??= maxOrdinal + 1;

  return new Map(incomingTurnIds.map((turnId, index) => [turnId, baseOrdinal + index]));
}

/** Starts a new contiguous cursor chain when the newest authoritative page has
 * no turn in common with the currently visible history island. */
export function projectAuthoritativeHistoryEpoch(
  existingRows: readonly Pick<ThreadDetailRow, "kind" | "remoteTurnId" | "historyEpoch" | "ordinal">[],
  incomingTurnIds: readonly string[],
): number {
  const currentEpoch = existingRows.find((row) => row.kind === "thread")?.historyEpoch ?? 0;
  const currentTurns = existingRows.flatMap((row) => row.kind === "turn"
    && row.historyEpoch === currentEpoch
    && row.remoteTurnId !== null
    ? [{ id: row.remoteTurnId, ordinal: row.ordinal }]
    : []);
  if (currentTurns.length === 0 || incomingTurnIds.length === 0) return currentEpoch;
  const ordinalsByTurnId = new Map(currentTurns.map(({ id, ordinal }) => [id, ordinal]));
  const turnIdByOrdinal = new Map(currentTurns.map(({ id, ordinal }) => [ordinal, id]));
  const firstOverlapIndex = incomingTurnIds.findIndex((turnId) => ordinalsByTurnId.has(turnId));
  if (firstOverlapIndex < 0) return currentEpoch + 1;
  const overlapId = incomingTurnIds[firstOverlapIndex]!;
  const baseOrdinal = ordinalsByTurnId.get(overlapId)! - firstOverlapIndex;
  const conflicts = incomingTurnIds.some((turnId, index) => {
    const projectedOrdinal = baseOrdinal + index;
    const existingOrdinal = ordinalsByTurnId.get(turnId);
    const existingTurnId = turnIdByOrdinal.get(projectedOrdinal);
    return (existingOrdinal !== undefined && existingOrdinal !== projectedOrdinal)
      || (existingTurnId !== undefined && existingTurnId !== turnId);
  });
  return conflicts ? currentEpoch + 1 : currentEpoch;
}

/** Assigns one older cursor page immediately before the current epoch's
 * minimum. Rows encountered in an obsolete epoch migrate into the current
 * chain instead of preserving their disconnected ordinal. */
export function projectPrependedTurnOrdinals(
  existingRows: readonly Pick<ThreadDetailRow, "kind" | "remoteTurnId" | "historyEpoch" | "ordinal">[],
  historyEpoch: number,
  incomingTurnIds: readonly string[],
): ReadonlyMap<string, number> {
  const currentOrdinals = new Map(existingRows.flatMap((row) => row.kind === "turn"
    && row.historyEpoch === historyEpoch
    && row.remoteTurnId !== null
    ? [[row.remoteTurnId, row.ordinal] as const]
    : []));
  const additions = incomingTurnIds.filter((turnId) => !currentOrdinals.has(turnId));
  const currentValues = [...currentOrdinals.values()];
  let nextOrdinal = (currentValues.length === 0 ? 0 : Math.min(...currentValues)) - additions.length;
  return new Map(incomingTurnIds.map((turnId) => {
    const existing = currentOrdinals.get(turnId);
    return [turnId, existing ?? nextOrdinal++] as const;
  }));
}

export type PendingTimelineEntry = {
  commandId: string;
  method: "turn/start" | "turn/steer";
  presentation: "delivery" | "queue";
  workspaceRequestId?: string | null;
  text: string;
  attachments: RemoteFileAttachment[];
  state: "queued" | "sending" | "accepted" | "uncertain" | "failed" | "delivered";
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  order: number;
};

export type PendingTimelineMutation = {
  upserts: readonly ThreadDetailRow[];
  deletes: readonly string[];
  beforeCommandId?: string | null;
};

export type PendingTimelineOverlay = {
  key: string;
  connectionId: string;
  threadId: string;
  row: ThreadDetailRow | null;
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
    if (overlay.connectionId !== connectionId || overlay.threadId !== threadId) continue;
    if (rows.get(overlay.key)?.kind === "turn") continue;
    rows.set(overlay.key, overlay.row);
  }
  return [...rows.values()].flatMap((row) => row === null ? [] : [row]);
}

export function reusableTurnOrdinal(row: ThreadDetailRow | undefined, historyEpoch: number): number | null {
  return row?.kind === "turn" && row.historyEpoch === historyEpoch ? row.ordinal : null;
}

/**
 * Merges native delivery observations with the optimistic JS transaction.
 * Native delivery can finish before the JS mutation records `accepted`, so a
 * later timestamp alone must not revive `Sending` after delivery was proven.
 * Other transitions remain timestamp-driven so retries can leave a failed or
 * uncertain state.
 */
export function mergePendingTimelineEntry(
  previous: PendingTimelineEntry,
  incoming: PendingTimelineEntry,
): PendingTimelineEntry {
  if (incoming.state === "delivered") {
    return incoming.attachments.length === 0 && previous.attachments.length > 0
      ? { ...incoming, attachments: previous.attachments }
      : incoming;
  }
  if (previous.state === "delivered") return previous;
  if (incoming.updatedAt < previous.updatedAt) return previous;
  if (incoming.updatedAt === previous.updatedAt && deliveryStateRank(incoming.state) < deliveryStateRank(previous.state)) return previous;
  return incoming.attachments.length === 0 && previous.attachments.length > 0
    ? { ...incoming, attachments: previous.attachments }
    : incoming;
}

function deliveryStateRank(state: PendingTimelineEntry["state"]): number {
  switch (state) {
    case "queued": return 0;
    case "sending": return 1;
    case "accepted": return 2;
    case "uncertain": return 3;
    case "failed": return 4;
    case "delivered": return 5;
  }
}

export function planQueuedEditMutation(
  row: ThreadDetailRow | undefined,
  text: string,
  attachments: RemoteFileAttachment[],
  updatedAt = Date.now(),
): PendingTimelineMutation | null {
  if (row?.kind !== "pending" || row.pending?.presentation !== "queue") return null;
  return {
    upserts: [{ ...row, pending: { ...row.pending, text, attachments, lastError: null, updatedAt } }],
    deletes: [],
  };
}

export function planQueuedRemovalMutation(row: ThreadDetailRow | undefined): PendingTimelineMutation | null {
  if (row?.kind !== "pending" || row.pending?.presentation !== "queue") return null;
  return { upserts: [], deletes: [row.id] };
}

export function planQueuedMoveMutation(
  candidates: readonly ThreadDetailRow[],
  commandId: string,
  direction: -1 | 1,
  updatedAt = Date.now(),
): PendingTimelineMutation | null {
  const rows = candidates
    .filter((row) => row.kind === "pending" && row.pending?.presentation === "queue")
    .sort((left, right) => left.pending!.order - right.pending!.order || left.pending!.createdAt - right.pending!.createdAt);
  const index = rows.findIndex((row) => row.pending?.commandId === commandId);
  const current = rows[index];
  const neighbor = rows[index + direction];
  if (current?.pending === null || current?.pending === undefined || neighbor?.pending === null || neighbor?.pending === undefined) return null;
  const reordered = rows.slice();
  [reordered[index], reordered[index + direction]] = [reordered[index + direction]!, reordered[index]!];
  return {
    upserts: [
      { ...current, pending: { ...current.pending, order: neighbor.pending.order, updatedAt } },
      { ...neighbor, pending: { ...neighbor.pending, order: current.pending.order, updatedAt } },
    ],
    deletes: [],
    beforeCommandId: reordered[index + direction + 1]?.pending?.commandId ?? null,
  };
}

export function pendingTimelineRowId(connectionId: string, threadId: string, commandId: string): string {
  return `${connectionId}\u0000${threadId}\u0000turnClient\u0000${commandId}`;
}

export function authoritativeTimelineRowId(connectionId: string, threadId: string, turn: Turn): string {
  const user = turn.items.find((item): item is Extract<Turn["items"][number], { type: "userMessage" }> => item.type === "userMessage");
  return typeof user?.clientId === "string" && user.clientId.length > 0
    ? pendingTimelineRowId(connectionId, threadId, user.clientId)
    : `${connectionId}\u0000${threadId}\u0000turn\u0000${turn.id}`;
}

export type ThreadDetailSnapshot = {
  connectionId: string;
  thread: Thread;
  fresh: boolean;
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
      const snapshot = materializeThreadDetail(values, row.connectionId, row.remoteThreadId, currentSessionId);
      return snapshot === null ? [] : [snapshot];
    });
}

export function materializeThreadDetail(
  rows: Iterable<ThreadDetailRow>,
  connectionId: string,
  threadId: string,
  currentSessionId: string,
): ThreadDetailSnapshot | null {
  const values = [...rows];
  const meta = values.find((row) => row.connectionId === connectionId
    && row.remoteThreadId === threadId
    && row.kind === "thread") ?? null;
  if (meta?.thread === null || meta === null) return null;
  const turns = new Map<string, ThreadDetailRow>();
  const turnMetadata = new Map<string, ProjectedTurnMetadata>();
  const activities = new Map<string, Turn["items"]>();
  for (const row of values) {
    if (row.connectionId !== connectionId || row.remoteThreadId !== threadId) continue;
    if (row.kind !== "thread" && row.kind !== "pending" && row.historyEpoch !== meta.historyEpoch) continue;
    if (row.remoteTurnId !== null && row.kind === "turn") turns.set(row.remoteTurnId, row);
    else if (row.remoteTurnId !== null && row.kind === "turnMeta" && row.turnMetadata !== null) turnMetadata.set(row.remoteTurnId, row.turnMetadata);
    else if (row.remoteTurnId !== null && row.kind === "activity" && row.activityItems !== null) activities.set(row.remoteTurnId, row.activityItems);
  }
  const ordered = deduplicateThreadTurns([...turns.values()].sort(compareTurnRows).flatMap((row) => {
    if (row.turn === null) return [];
    const activity = row.remoteTurnId === null ? undefined : activities.get(row.remoteTurnId);
    const metadata = row.remoteTurnId === null ? undefined : turnMetadata.get(row.remoteTurnId);
    return [materializeTurn(row.turn, activity, metadata)];
  }));
  return {
    connectionId,
    thread: { ...meta.thread, turns: ordered },
    fresh: meta.sessionId === currentSessionId,
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
    if (row.remoteTurnId === null) continue;
    if (row.kind === "turn") turns.set(row.remoteTurnId, row);
    else if (row.kind === "turnMeta" && row.turnMetadata !== null) turnMetadata.set(row.remoteTurnId, row.turnMetadata);
    else if (row.kind === "activity" && row.activityItems !== null) activities.set(row.remoteTurnId, row.activityItems);
  }
  return deduplicateThreadTurns([...turns.values()].sort(compareTurnRows).flatMap((row) => {
    if (row.turn === null || row.remoteTurnId === null) return [];
    return [materializeTurn(
      row.turn,
      activities.get(row.remoteTurnId),
      turnMetadata.get(row.remoteTurnId),
    )];
  }));
}

export function materializePendingTimeline(rows: Iterable<ThreadDetailRow>): PendingTimelineEntry[] {
  return [...rows]
    .flatMap((row) => row.kind === "pending" && row.pending !== null && row.pending !== undefined ? [row.pending] : [])
    .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt || left.commandId.localeCompare(right.commandId));
}

/**
 * Kotlin owns the durable direct-delivery ledger. A direct-delivery projection
 * which is no longer present in that ledger is stale: delivered receipts are
 * retired only after the authoritative user item was observed, while unresolved
 * commands remain in `activeCommandIds`. The resident chat range must not keep
 * an independent optimistic lifetime or wait for the matching turn to scroll
 * into view.
 */
export function planPendingDeliveryProjectionCleanup(
  rows: Iterable<ThreadDetailRow>,
  activeCommandIds: ReadonlySet<string>,
): PendingTimelineMutation {
  const values = [...rows];
  const deletes = values.flatMap((row) => (
    row.kind === "pending"
      && row.pending?.presentation === "delivery"
      && !activeCommandIds.has(row.pending.commandId)
      ? [row.id]
      : []
  ));
  return { upserts: [], deletes };
}

/**
 * Builds the smallest thread slice needed by a live event batch. Static sealed
 * history is deliberately excluded; only the mutable head and explicitly
 * addressed turns participate in event reduction.
 */
export function selectLiveThreadDetailRows(
  rows: Iterable<ThreadDetailRow>,
  connectionId: string,
  threadId: string,
  payloads: Record<string, unknown>[],
): ThreadDetailRow[] {
  const values = [...rows].filter((row) => row.connectionId === connectionId && row.remoteThreadId === threadId);
  const selectedTurnIds = new Set(values
    .filter((row) => row.kind === "turn" && !row.sealed && row.remoteTurnId !== null)
    .map((row) => row.remoteTurnId!));
  for (const payload of payloads) {
    const params = asRecord(payload.params);
    if (typeof params?.turnId === "string") selectedTurnIds.add(params.turnId);
    const turn = asRecord(params?.turn);
    if (typeof turn?.id === "string") selectedTurnIds.add(turn.id);
  }
  return values.filter((row) => row.kind === "thread" || (row.remoteTurnId !== null && selectedTurnIds.has(row.remoteTurnId)));
}

export function reconcileAuthoritativeThread(
  incoming: Thread,
  current: Thread | null | undefined,
  preserveConcurrentHead: boolean,
): Thread {
  if (!preserveConcurrentHead || current === null || current === undefined) return incoming;
  const incomingById = new Map(incoming.turns.map((turn) => [turn.id, turn] as const));
  const turns = incoming.turns.map((turn) => {
    const previous = current.turns.find((candidate) => candidate.id === turn.id);
    if (previous === undefined || turn.status !== "inProgress" || previous.status !== "inProgress") return turn;
    return previous;
  });
  for (const turn of current.turns) {
    if (!incomingById.has(turn.id) && turn.status === "inProgress") turns.push(turn);
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
export function compactCompletedTurnForStorage(turn: Turn): Turn {
  if (turn.status === "inProgress" || turn.itemsView !== "full") return turn;
  let latestAgentIndex = -1;
  let explicitFinalAgentIndex = -1;
  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index];
    if (item?.type !== "agentMessage" || item.text.trim() === "") continue;
    latestAgentIndex = index;
    if (item.phase === "final_answer") explicitFinalAgentIndex = index;
  }
  // App Server may finish an interrupted/churned turn with an empty terminal
  // agent placeholder after text that was already streamed. That placeholder
  // is lifecycle evidence, not the chat boundary: compacting around it would
  // discard the visible answer and produce "Completed without final response".
  const finalAgentIndex = explicitFinalAgentIndex >= 0 ? explicitFinalAgentIndex : latestAgentIndex;
  const retained = turn.items.filter((item, index) => item.type === "userMessage" || index === finalAgentIndex);
  const kinds = turn.items.flatMap((item, index) => item.type === "userMessage" || index === finalAgentIndex ? [] : [item.type]);
  if (kinds.length === 0) return turn;
  const metadata = projectedTurnMetadata(turn) ?? {};
  const outputFootprint = sumOutputFootprints(turn.items.map((item) => {
    const value = item as unknown as Record<string, unknown>;
    return projectedOutputFootprint(value.codewideOutputFootprint);
  }));
  return {
    ...turn,
    items: retained,
    itemsView: "summary",
    codewide: {
      ...metadata,
      activity: {
        ...metadata.activity,
        count: kinds.length,
        kinds,
        ...(outputFootprint === null ? {} : { outputFootprint }),
      },
    },
  } as Turn;
}

function materializeTurn(
  source: Turn,
  activity: Turn["items"] | undefined,
  metadata: ProjectedTurnMetadata | undefined,
): Turn {
  if (activity === undefined && metadata === undefined) return source;
  const cached = materializedTurnCache.get(source);
  if (cached !== undefined && cached.activity === activity && cached.metadata === metadata) return cached.value;
  const value: Turn = activity === undefined
    ? { ...source }
    : { ...source, items: mergeSummaryWithActivity(source.items, activity), itemsView: "full" as const };
  if (metadata !== undefined) {
    (value as Turn & { codewide?: ProjectedTurnMetadata }).codewide = structuredClone(metadata);
  }
  materializedTurnCache.set(source, { activity, metadata, value });
  return value;
}

export function shouldApplyLiveThreadRow(previous: ThreadDetailRow | undefined, next: ThreadDetailRow): boolean {
  return shouldWriteThreadDetailRow(previous, next);
}

/**
 * Keeps sealed message content immutable while allowing an authoritative read
 * to repair the small lifecycle envelope. Terminal state is monotonic: a stale
 * in-progress response can never reopen a turn completed by a live event.
 */
export function reconcileAuthoritativeThreadDetailRow(
  previous: ThreadDetailRow | undefined,
  next: ThreadDetailRow,
): ThreadDetailRow {
  if (previous?.kind !== "turn" || !previous.sealed || previous.turn === null || next.kind !== "turn" || next.turn === null) {
    return next;
  }
  const content = reconcileSealedChatBoundary(previous.turn, next.turn);
  const lifecycle = previous.turn.status !== "inProgress" && next.turn.status === "inProgress" ? previous.turn : next.turn;
  const turn: Turn = {
    ...next.turn,
    items: content.items,
    itemsView: content.itemsView,
    status: lifecycle.status,
    error: lifecycle.error,
    startedAt: lifecycle.startedAt,
    completedAt: lifecycle.completedAt,
    durationMs: lifecycle.durationMs,
  };
  return { ...next, sealed: turn.status !== "inProgress", turn };
}

/**
 * A completion event can seal a protocol turn before its bounded history
 * summary arrives. The authoritative summary may therefore fill missing chat
 * boundary items once, while already-complete sealed content stays immutable.
 */
export function shouldWriteAuthoritativeThreadDetailRow(previous: ThreadDetailRow | undefined, next: ThreadDetailRow): boolean {
  if (previous?.kind === "turn" && previous.sealed && next.kind === "turn") {
    return previous.historyEpoch !== next.historyEpoch
      || previous.ordinal !== next.ordinal
      || shouldReplaceSealedChatBoundary(previous.turn, next.turn)
      || !sameTurnLifecycle(previous.turn, next.turn);
  }
  return shouldWriteThreadDetailRow(previous, next);
}

function shouldReplaceSealedChatBoundary(previous: Turn | null, next: Turn | null): boolean {
  if (previous === null || next === null) return next !== null && previous === null;
  if (previous.itemsView === "summary" && next.itemsView === "summary") {
    const previousCounts = chatBoundaryCounts(previous);
    const nextCounts = chatBoundaryCounts(next);
    // A page can be temporarily incomplete while the rollout tail settles.
    // Never let it erase the last persisted prompt or final answer. Count
    // reduction remains valid for cleaning an already-duplicated summary.
    if ((previousCounts.users > 0 && nextCounts.users === 0)
      || (previousCounts.agents > 0 && nextCounts.agents === 0)) return false;
    if (previousCounts.users > nextCounts.users || previousCounts.agents > nextCounts.agents) return true;
  }
  const previousScore = chatBoundaryScore(previous);
  const nextScore = chatBoundaryScore(next);
  if (nextScore !== previousScore) return nextScore > previousScore;
  // A live completion can seal a summary that still points at an intermediate
  // agent message. The subsequent authoritative page has the same coarse
  // user/agent score, but a different final item. Treat that final boundary as
  // canonical; reconciliation below preserves any hydrated full activity.
  return chatBoundaryRevision(previous) !== chatBoundaryRevision(next);
}

function chatBoundaryCounts(turn: Turn): { users: number; agents: number } {
  let users = 0;
  let agents = 0;
  for (const item of turn.items) {
    if (item.type === "userMessage") users += 1;
    else if (item.type === "agentMessage") agents += 1;
  }
  return { users, agents };
}

function reconcileSealedChatBoundary(previous: Turn, next: Turn): Turn {
  if (!shouldReplaceSealedChatBoundary(previous, next)) return previous;
  if (previous.itemsView === "full" && next.itemsView !== "full") {
    return { ...previous, items: reconcileTurnItems(previous.items, next.items) };
  }
  const reconciled = reconcileTurnItems(previous.items, next.items);
  const reconciledByIncomingId = new Map(reconciled.map((item) => [item.id, item] as const));
  return {
    ...next,
    items: next.items.map((item) => reconciledByIncomingId.get(item.id) ?? item),
  };
}

function chatBoundaryRevision(turn: Turn): string {
  const user = turn.items.find((item) => item.type === "userMessage");
  const agent = [...turn.items].reverse().find((item) => item.type === "agentMessage");
  return `${user?.id ?? ""}\u0000${agent?.id ?? ""}`;
}

/** Large completed content and hydrated activity are immutable cache entries. */
export function shouldWriteThreadDetailRow(previous: ThreadDetailRow | undefined, next: ThreadDetailRow): boolean {
  if (next.kind === "turn") return previous?.sealed !== true;
  if (next.kind === "activity") return previous === undefined;
  return true;
}

/**
 * An explicit per-turn hydration is also the repair path for evicted private
 * assets. Unlike passive history refreshes, it must be allowed to replace an
 * already cached activity row when the companion returns a fresh projection.
 */
export function shouldWriteHydratedActivityRow(previous: ThreadDetailRow | undefined, next: ThreadDetailRow): boolean {
  if (next.kind !== "activity") return false;
  if (previous?.kind !== "activity") return true;
  return JSON.stringify(previous.activityItems) !== JSON.stringify(next.activityItems);
}

function chatBoundaryScore(turn: Turn | null): number {
  if (turn === null) return 0;
  let score = 0;
  if (turn.items.some((item) => item.type === "userMessage")) score += 1;
  if (turn.items.some((item) => item.type === "agentMessage")) score += 1;
  return score;
}

function sameTurnLifecycle(left: Turn | null, right: Turn | null): boolean {
  if (left === null || right === null) return left === right;
  return left.status === right.status
    && left.startedAt === right.startedAt
    && left.completedAt === right.completedAt
    && left.durationMs === right.durationMs
    && JSON.stringify(left.error) === JSON.stringify(right.error);
}

function mergeSummaryWithActivity(summary: Turn["items"], activity: Turn["items"]): Turn["items"] {
  const activityIds = new Set(activity.map((item) => item.id));
  if (summary.every((item) => activityIds.has(item.id))) return activity;
  return reconcileTurnItems(activity, summary);
}

function compareTurnRows(left: ThreadDetailRow, right: ThreadDetailRow): number {
  const leftStartedAt = left.turn?.startedAt;
  const rightStartedAt = right.turn?.startedAt;
  if (leftStartedAt !== null && leftStartedAt !== undefined && rightStartedAt !== null && rightStartedAt !== undefined && leftStartedAt !== rightStartedAt) {
    return leftStartedAt - rightStartedAt;
  }
  return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
