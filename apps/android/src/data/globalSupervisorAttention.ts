import type { SyncEvent, SyncServerRequest, SyncSnapshotThread } from "@codewide/sync-client";
import { threadProjectionPatchFromEvent } from "@codewide/sync-client";

import { appLogger } from "../observability/logger";
import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import type {
  GlobalSupervisorAttentionEvent,
  GlobalSupervisorAttentionStorage,
  GlobalSupervisorAttentionStorageChange,
  GlobalSupervisorAttentionStorageRow,
  GlobalSupervisorAttentionStoredRow,
  GlobalSupervisorRelationStorageRow,
} from "./globalSupervisorAttentionStorage.types";
import { unknownRecord } from "./unknownRecord";

const ATTENTION_SUMMARY_MAX_CHARACTERS = 480;
const ATTENTION_READ_MAX_ENTRIES = 32;
const MILLISECONDS_PER_SECOND = 1000;
export const GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX = "codewide-global-supervisor-worker:";

const USER_INTERACTION_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
]);

export type { GlobalSupervisorAttentionEvent } from "./globalSupervisorAttentionStorage.types";

type AttentionSubscription = { readonly unsubscribe: () => void };
type AttentionSource = Omit<GlobalSupervisorAttentionEvent, "supervisor" | "worker">;
type AttentionCandidate = { readonly source: AttentionSource; readonly threadId: string };
type TerminalTurnStatus = "completed" | "failed" | "interrupted";

export type GlobalSupervisorAttentionOwner = {
  readonly acknowledge: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    eventId: string,
  ) => Promise<void>;
  readonly beginWorkerCreation: (request: {
    readonly source: string;
    readonly supervisor: GlobalSupervisorQualifiedChatRef;
    readonly workerConnectionId: string;
  }) => Promise<void>;
  readonly close: () => void;
  readonly completeWorkerCreation: (request: {
    readonly source: string;
    readonly worker: GlobalSupervisorQualifiedChatRef;
  }) => Promise<void>;
  readonly disableDelivery: (supervisor: GlobalSupervisorQualifiedChatRef) => Promise<void>;
  readonly enableDelivery: (supervisor: GlobalSupervisorQualifiedChatRef) => Promise<void>;
  readonly follow: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    worker: GlobalSupervisorQualifiedChatRef,
  ) => Promise<void>;
  readonly ingestEvents: (connectionId: string, events: readonly SyncEvent[]) => Promise<void>;
  readonly ingestPendingRequests: (
    connectionId: string,
    requests: readonly SyncServerRequest[],
  ) => Promise<void>;
  readonly ingestSnapshot: (
    connectionId: string,
    snapshots: readonly SyncSnapshotThread[],
  ) => Promise<void>;
  readonly pending: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    limit?: number,
  ) => Promise<readonly GlobalSupervisorAttentionEvent[]>;
  readonly pendingCount: (supervisor: GlobalSupervisorQualifiedChatRef) => Promise<number>;
  readonly ready: Promise<void>;
  readonly subscribe: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    listener: () => void,
  ) => AttentionSubscription;
  readonly subscribeAll: (listener: () => void) => AttentionSubscription;
  readonly unfollow: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    worker: GlobalSupervisorQualifiedChatRef,
  ) => Promise<void>;
};

function identity(parts: readonly (number | string)[]): string {
  return JSON.stringify(parts);
}

function qualifiedKey(ref: GlobalSupervisorQualifiedChatRef): string {
  return identity([ref.connectionId, ref.threadId]);
}

function relationRowId(
  supervisor: GlobalSupervisorQualifiedChatRef,
  worker: GlobalSupervisorQualifiedChatRef,
): string {
  return `relation:${identity([
    supervisor.connectionId,
    supervisor.threadId,
    worker.connectionId,
    worker.threadId,
  ])}`;
}

function creationRowId(
  supervisor: GlobalSupervisorQualifiedChatRef,
  workerConnectionId: string,
  source: string,
): string {
  return `creation:${identity([
    supervisor.connectionId,
    supervisor.threadId,
    workerConnectionId,
    source,
  ])}`;
}

function attentionRowId(supervisor: GlobalSupervisorQualifiedChatRef, eventId: string): string {
  return `attention:${identity([supervisor.connectionId, supervisor.threadId, eventId])}`;
}

function sameRef(
  left: GlobalSupervisorQualifiedChatRef,
  right: GlobalSupervisorQualifiedChatRef,
): boolean {
  return left.connectionId === right.connectionId && left.threadId === right.threadId;
}

function supervisorFromRow(
  row: GlobalSupervisorAttentionStoredRow,
): GlobalSupervisorQualifiedChatRef {
  return globalSupervisorQualifiedChatRef(row.supervisorConnectionId, row.supervisorThreadId);
}

function workerFromRelation(
  row: GlobalSupervisorRelationStorageRow,
): GlobalSupervisorQualifiedChatRef | null {
  return row.relation.status === "active" && row.workerThreadId !== null
    ? globalSupervisorQualifiedChatRef(row.workerConnectionId, row.workerThreadId)
    : null;
}

function boundedSummary(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  if (normalized === "") {
    return fallback;
  }
  const characters = Array.from(normalized);
  return characters.length <= ATTENTION_SUMMARY_MAX_CHARACTERS
    ? normalized
    : `${characters.slice(0, ATTENTION_SUMMARY_MAX_CHARACTERS - 1).join("")}…`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function terminalTurnStatus(value: unknown): TerminalTurnStatus | null {
  if (value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  return null;
}

function terminalAttentionKind(status: TerminalTurnStatus): "blocked" | "completed" | "failed" {
  if (status === "completed") {
    return "completed";
  }
  return status === "failed" ? "failed" : "blocked";
}

function terminalAttentionSummary(status: TerminalTurnStatus, completedSummary: unknown): string {
  if (status === "completed") {
    return boundedSummary(completedSummary, "Worker chat turn completed.");
  }
  return status === "failed"
    ? "Worker chat turn failed."
    : "Worker chat stopped before completion.";
}

function hasBlockedStatus(value: unknown): boolean {
  return unknownRecord(value)?.status === "blocked";
}

function eventObservedAt(payload: Readonly<Record<string, unknown>>, fallback: number): number {
  const value = payload.emittedAtMs;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function turnAttention(
  connectionId: string,
  event: SyncEvent,
  fallbackObservedAt: number,
): AttentionSource | null {
  const patch = threadProjectionPatchFromEvent(event.payload);
  if (patch?.operation.kind !== "turnCompleted") {
    return null;
  }
  const turn = unknownRecord(patch.operation.turn);
  if (turn === null) {
    return null;
  }
  const status = terminalTurnStatus(turn.status);
  const turnId = nonEmptyString(turn.id);
  if (turnId === null || status === null) {
    return null;
  }
  const summary = unknownRecord(patch.operation.summary);
  const observedAt = eventObservedAt(event.payload, completedAt(turn) ?? fallbackObservedAt);
  return {
    eventId: `turn:${identity([connectionId, patch.threadId, turnId, status])}`,
    kind: terminalAttentionKind(status),
    observedAt,
    sourceCursor: event.cursor,
    summary: terminalAttentionSummary(status, summary?.previewText),
    turnId,
  };
}

function blockedGoalAttention(
  connectionId: string,
  event: SyncEvent,
  fallbackObservedAt: number,
):
  | (Omit<GlobalSupervisorAttentionEvent, "supervisor" | "worker"> & {
      readonly threadId: string;
    })
  | null {
  if (event.payload.method !== "thread/goal/updated") {
    return null;
  }
  const params = unknownRecord(event.payload.params);
  const threadId = nonEmptyString(params?.threadId);
  if (threadId === null || !hasBlockedStatus(params?.goal)) {
    return null;
  }
  return {
    eventId: `goal:${identity([connectionId, threadId, event.cursor, "blocked"])}`,
    kind: "blocked",
    observedAt: eventObservedAt(event.payload, fallbackObservedAt),
    sourceCursor: event.cursor,
    summary: "Worker chat reported a blocker.",
    threadId,
    turnId: nonEmptyString(params?.turnId),
  };
}

function systemErrorAttention(
  connectionId: string,
  event: SyncEvent,
  fallbackObservedAt: number,
):
  | (Omit<GlobalSupervisorAttentionEvent, "supervisor" | "worker"> & {
      readonly threadId: string;
    })
  | null {
  if (event.payload.method !== "thread/status/changed") {
    return null;
  }
  const params = unknownRecord(event.payload.params);
  const status = unknownRecord(params?.status);
  const threadId = typeof params?.threadId === "string" ? params.threadId : null;
  if (threadId === null || status?.type !== "systemError") {
    return null;
  }
  return {
    eventId: `status:${identity([connectionId, threadId, event.cursor, "systemError"])}`,
    kind: "failed",
    observedAt: eventObservedAt(event.payload, fallbackObservedAt),
    sourceCursor: event.cursor,
    summary: "Worker chat entered a system error state.",
    threadId,
    turnId: null,
  };
}

function eventThreadId(event: SyncEvent): string | null {
  const projected = threadProjectionPatchFromEvent(event.payload)?.threadId;
  if (projected !== undefined) {
    return projected;
  }
  const params = unknownRecord(event.payload.params);
  return typeof params?.threadId === "string" ? params.threadId : null;
}

function completedAt(turn: Readonly<Record<string, unknown>>): number | null {
  return typeof turn.completedAt === "number" && Number.isFinite(turn.completedAt)
    ? turn.completedAt * MILLISECONDS_PER_SECOND
    : null;
}

function activeRelationsForWorker(
  rows: Iterable<GlobalSupervisorAttentionStoredRow>,
  worker: GlobalSupervisorQualifiedChatRef,
): GlobalSupervisorRelationStorageRow[] {
  const matches: GlobalSupervisorRelationStorageRow[] = [];
  for (const row of rows) {
    if (row.rowKind !== "relation" || row.relation.status !== "active") {
      continue;
    }
    const target = workerFromRelation(row);
    if (target !== null && sameRef(target, worker)) {
      matches.push(row);
    }
  }
  return matches;
}

function attentionRow(input: {
  readonly deliveryEnabled: ReadonlySet<string>;
  readonly relation: GlobalSupervisorRelationStorageRow;
  readonly source: Omit<GlobalSupervisorAttentionEvent, "supervisor" | "worker">;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): GlobalSupervisorAttentionStorageRow {
  const { deliveryEnabled, relation, source, worker } = input;
  const supervisor = supervisorFromRow(relation);
  const attention: GlobalSupervisorAttentionEvent = { ...source, supervisor, worker };
  return {
    attention,
    id: attentionRowId(supervisor, source.eventId),
    observedAt: source.observedAt,
    rowKind: "attention",
    state: deliveryEnabled.has(qualifiedKey(supervisor)) ? "pending" : "acknowledged",
    supervisorConnectionId: supervisor.connectionId,
    supervisorThreadId: supervisor.threadId,
    workerConnectionId: worker.connectionId,
    workerThreadId: worker.threadId,
  };
}

function markPendingSupervisorChanged(
  row: GlobalSupervisorAttentionStorageRow,
  changedSupervisors: Set<string>,
): void {
  if (row.state === "pending") {
    changedSupervisors.add(qualifiedKey(row.attention.supervisor));
  }
}

function creatingThreadFromEvent(
  event: SyncEvent,
): { readonly id: string; readonly source: string } | null {
  if (event.payload.method !== "thread/started") {
    return null;
  }
  const params = unknownRecord(event.payload.params);
  const thread = unknownRecord(params?.thread);
  return typeof thread?.id === "string" &&
    typeof thread.threadSource === "string" &&
    thread.id.length > 0
    ? { id: thread.id, source: thread.threadSource }
    : null;
}

function isClosingEvent(event: SyncEvent): boolean {
  return event.payload.method === "thread/deleted";
}

function relationForActive(
  supervisor: GlobalSupervisorQualifiedChatRef,
  worker: GlobalSupervisorQualifiedChatRef,
  createdAt: number,
): GlobalSupervisorRelationStorageRow {
  return {
    id: relationRowId(supervisor, worker),
    observedAt: createdAt,
    relation: { createdAt, status: "active" },
    rowKind: "relation",
    supervisorConnectionId: supervisor.connectionId,
    supervisorThreadId: supervisor.threadId,
    workerConnectionId: worker.connectionId,
    workerThreadId: worker.threadId,
  };
}

function eventCandidate(
  connectionId: string,
  event: SyncEvent,
  now: number,
): AttentionCandidate | null {
  const turn = turnAttention(connectionId, event, now);
  if (turn !== null) {
    const threadId = eventThreadId(event);
    return threadId === null ? null : { source: turn, threadId };
  }
  const goal = blockedGoalAttention(connectionId, event, now);
  if (goal !== null) {
    const { threadId, ...source } = goal;
    return { source, threadId };
  }
  const status = systemErrorAttention(connectionId, event, now);
  if (status !== null) {
    const { threadId, ...source } = status;
    return { source, threadId };
  }
  return null;
}

function terminalSnapshotCandidate(
  connectionId: string,
  snapshot: SyncSnapshotThread,
): AttentionSource | null {
  const turn = snapshot.thread.turns.at(-1);
  if (turn === undefined || turn.completedAt === null) {
    return null;
  }
  const status = terminalTurnStatus(turn.status);
  if (status === null) {
    return null;
  }
  const observedAt = turn.completedAt * MILLISECONDS_PER_SECOND;
  const lastMessage = turn.items.findLast((item) => item.type === "agentMessage");
  return {
    eventId: `turn:${identity([connectionId, snapshot.thread.id, turn.id, status])}`,
    kind: terminalAttentionKind(status),
    observedAt,
    sourceCursor: null,
    summary: terminalAttentionSummary(
      status,
      lastMessage?.type === "agentMessage" ? lastMessage.text : null,
    ),
    turnId: turn.id,
  };
}

function isDecisionRequest(method: string): boolean {
  return method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request";
}

function requestEvent(
  connectionId: string,
  request: SyncServerRequest,
  observedAt: number,
): AttentionCandidate | null {
  if (!USER_INTERACTION_METHODS.has(request.method)) {
    return null;
  }
  const params = unknownRecord(request.params);
  const threadId = nonEmptyString(params?.threadId);
  if (threadId === null) {
    return null;
  }
  const summary = isDecisionRequest(request.method)
    ? "Worker chat is waiting for a user decision."
    : "Worker chat is waiting for user approval.";
  return {
    source: {
      eventId: `request:${identity([
        connectionId,
        threadId,
        typeof request.id,
        JSON.stringify(request.id),
      ])}`,
      kind: "needsInput",
      observedAt,
      sourceCursor: null,
      summary,
      turnId: typeof params?.turnId === "string" ? params.turnId : null,
    },
    threadId,
  };
}

type AttentionWorkingRows = Map<string, GlobalSupervisorAttentionStoredRow>;
type AttentionMutationBatch = {
  readonly changedSupervisors: Set<string>;
  readonly changes: GlobalSupervisorAttentionStorageChange[];
  readonly deliveryEnabled: ReadonlySet<string>;
  readonly working: AttentionWorkingRows;
};
type PendingRequestBatch = {
  readonly changedSupervisors: Set<string>;
  readonly changes: GlobalSupervisorAttentionStorageChange[];
  readonly connectionId: string;
  readonly currentEventIds: Set<string>;
  readonly deliveryEnabled: ReadonlySet<string>;
  readonly known: Set<string>;
  readonly rows: readonly GlobalSupervisorAttentionStoredRow[];
};

function activateStartedRelations(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly event: SyncEvent;
}): void {
  const { batch, connectionId, event } = input;
  const { changes, working } = batch;
  const started = creatingThreadFromEvent(event);
  if (started === null) {
    return;
  }
  const worker = globalSupervisorQualifiedChatRef(connectionId, started.id);
  for (const row of working.values()) {
    if (
      row.rowKind !== "relation" ||
      row.relation.status !== "creating" ||
      row.workerConnectionId !== connectionId ||
      row.relation.source !== started.source
    ) {
      continue;
    }
    const active = relationForActive(supervisorFromRow(row), worker, row.relation.createdAt);
    working.delete(row.id);
    working.set(active.id, active);
    changes.push({ id: row.id, type: "delete" }, { row: active, type: "put" });
  }
}

function addEventAttention(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly event: SyncEvent;
  readonly now: number;
}): {
  readonly eventId: string;
  readonly matchedRelations: number;
  readonly pendingRowsAdded: number;
  readonly sourceCursor: number | null;
  readonly workerThreadId: string;
} | null {
  const { batch, connectionId, event, now } = input;
  const { changedSupervisors, changes, deliveryEnabled, working } = batch;
  const candidate = eventCandidate(connectionId, event, now);
  if (candidate === null) {
    return null;
  }
  const worker = globalSupervisorQualifiedChatRef(connectionId, candidate.threadId);
  const params = unknownRecord(event.payload.params);
  const turn = unknownRecord(params?.turn);
  const terminalAt = turn === null ? null : completedAt(turn);
  let matchedRelations = 0;
  let pendingRowsAdded = 0;
  for (const relation of activeRelationsForWorker(working.values(), worker)) {
    matchedRelations += 1;
    if (terminalAt !== null && terminalAt < relation.relation.createdAt) {
      continue;
    }
    const row = attentionRow({ deliveryEnabled, relation, source: candidate.source, worker });
    if (working.has(row.id)) {
      continue;
    }
    working.set(row.id, row);
    changes.push({ row, type: "put" });
    markPendingSupervisorChanged(row, changedSupervisors);
    pendingRowsAdded += Number(row.state === "pending");
  }
  return {
    eventId: candidate.source.eventId,
    matchedRelations,
    pendingRowsAdded,
    sourceCursor: candidate.source.sourceCursor,
    workerThreadId: worker.threadId,
  };
}

function removeClosedRelations(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly event: SyncEvent;
}): void {
  const { batch, connectionId, event } = input;
  const { changes, working } = batch;
  if (!isClosingEvent(event)) {
    return;
  }
  const threadId = eventThreadId(event);
  if (threadId === null) {
    return;
  }
  const worker = globalSupervisorQualifiedChatRef(connectionId, threadId);
  for (const relation of activeRelationsForWorker(working.values(), worker)) {
    working.delete(relation.id);
    changes.push({ id: relation.id, type: "delete" });
  }
}

function addPendingRequestAttention(
  requests: readonly SyncServerRequest[],
  observedAt: number,
  batch: PendingRequestBatch,
): void {
  const {
    changedSupervisors,
    changes,
    connectionId,
    currentEventIds,
    deliveryEnabled,
    known,
    rows,
  } = batch;
  for (const request of requests) {
    const candidate = requestEvent(connectionId, request, observedAt);
    if (candidate === null) {
      continue;
    }
    currentEventIds.add(candidate.source.eventId);
    const worker = globalSupervisorQualifiedChatRef(connectionId, candidate.threadId);
    for (const relation of activeRelationsForWorker(rows, worker)) {
      const row = attentionRow({ deliveryEnabled, relation, source: candidate.source, worker });
      if (known.has(row.id)) {
        continue;
      }
      known.add(row.id);
      changes.push({ row, type: "put" });
      markPendingSupervisorChanged(row, changedSupervisors);
    }
  }
}

function acknowledgeMissingRequestAttention(batch: PendingRequestBatch): void {
  const { changedSupervisors, changes, connectionId, currentEventIds, rows } = batch;
  for (const row of rows) {
    if (
      row.rowKind !== "attention" ||
      row.state !== "pending" ||
      row.attention.kind !== "needsInput" ||
      row.workerConnectionId !== connectionId ||
      currentEventIds.has(row.attention.eventId)
    ) {
      continue;
    }
    changes.push({ row: { ...row, state: "acknowledged" }, type: "put" });
    changedSupervisors.add(qualifiedKey(row.attention.supervisor));
  }
}

function activateSnapshotRelations(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly snapshot: SyncSnapshotThread;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): void {
  const { batch, connectionId, snapshot, worker } = input;
  const { changes, working } = batch;
  const source = snapshot.thread.threadSource;
  if (typeof source !== "string") {
    return;
  }
  for (const row of working.values()) {
    if (
      row.rowKind !== "relation" ||
      row.relation.status !== "creating" ||
      row.workerConnectionId !== connectionId ||
      row.relation.source !== source
    ) {
      continue;
    }
    const active = relationForActive(supervisorFromRow(row), worker, row.relation.createdAt);
    working.delete(row.id);
    working.set(active.id, active);
    changes.push({ id: row.id, type: "delete" }, { row: active, type: "put" });
  }
}

function addSnapshotAttention(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly snapshot: SyncSnapshotThread;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): void {
  const { batch, connectionId, snapshot, worker } = input;
  const { changedSupervisors, changes, deliveryEnabled, working } = batch;
  const candidate = terminalSnapshotCandidate(connectionId, snapshot);
  if (candidate === null) {
    return;
  }
  for (const relation of activeRelationsForWorker(working.values(), worker)) {
    if (candidate.observedAt < relation.relation.createdAt) {
      continue;
    }
    const row = attentionRow({ deliveryEnabled, relation, source: candidate, worker });
    if (working.has(row.id)) {
      continue;
    }
    working.set(row.id, row);
    changes.push({ row, type: "put" });
    markPendingSupervisorChanged(row, changedSupervisors);
  }
}

function pendingAcknowledgementChanges(
  rows: readonly GlobalSupervisorAttentionStoredRow[],
  supervisor: GlobalSupervisorQualifiedChatRef,
): GlobalSupervisorAttentionStorageChange[] {
  const changes: GlobalSupervisorAttentionStorageChange[] = [];
  for (const row of rows) {
    if (
      row.rowKind === "attention" &&
      row.state === "pending" &&
      sameRef(row.attention.supervisor, supervisor)
    ) {
      changes.push({ row: { ...row, state: "acknowledged" }, type: "put" });
    }
  }
  return changes;
}

function updateDeliveryState(enabledSupervisors: Set<string>, key: string, enabled: boolean): void {
  if (enabled) {
    enabledSupervisors.add(key);
  } else {
    enabledSupervisors.delete(key);
  }
}

/** Durable relation, event reduction, dedupe, ordering and acknowledgement owner. */
export function createGlobalSupervisorAttentionOwner(options: {
  readonly now: () => number;
  readonly storage: GlobalSupervisorAttentionStorage;
}): GlobalSupervisorAttentionOwner {
  const listeners = new Map<string, Set<() => void>>();
  const allListeners = new Set<() => void>();
  const deliveryEnabled = new Set<string>();
  let tail = Promise.resolve();
  let closed = false;

  const enqueue = async (operation: () => Promise<ReadonlySet<string>>): Promise<void> => {
    const next = tail.then(async () => {
      if (closed) {
        return;
      }
      await options.storage.ready;
      const changed = await operation();
      for (const key of changed) {
        for (const listener of listeners.get(key) ?? []) {
          listener();
        }
      }
      if (changed.size > 0) {
        for (const listener of allListeners) {
          listener();
        }
      }
    });
    tail = next.catch(() => undefined);
    await next;
  };

  const apply = async (
    changes: readonly GlobalSupervisorAttentionStorageChange[],
    changedSupervisors: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> => {
    await options.storage.commit(changes);
    return changedSupervisors;
  };

  const setDeliveryEnabled = async (
    supervisor: GlobalSupervisorQualifiedChatRef,
    enabled: boolean,
  ): Promise<void> => {
    await enqueue(async () => {
      const key = qualifiedKey(supervisor);
      if (enabled && deliveryEnabled.has(key)) {
        return new Set();
      }
      const changes = pendingAcknowledgementChanges(options.storage.rows(), supervisor);
      const changedSupervisors = changes.length === 0 ? new Set<string>() : new Set([key]);
      const changed = await apply(changes, changedSupervisors);
      updateDeliveryState(deliveryEnabled, key, enabled);
      return changed;
    });
  };

  const follow = async (
    supervisor: GlobalSupervisorQualifiedChatRef,
    worker: GlobalSupervisorQualifiedChatRef,
  ): Promise<void> => {
    await enqueue(async () => {
      const id = relationRowId(supervisor, worker);
      if (options.storage.rows().some((row) => row.id === id)) {
        appLogger.info({
          event: "global_voice.attention.follow_committed",
          fields: {
            relationCreated: false,
            supervisorConnectionId: supervisor.connectionId,
            supervisorThreadId: supervisor.threadId,
            workerConnectionId: worker.connectionId,
            workerThreadId: worker.threadId,
          },
        });
        return new Set();
      }
      const changed = await apply(
        [{ row: relationForActive(supervisor, worker, options.now()), type: "put" }],
        new Set(),
      );
      appLogger.info({
        event: "global_voice.attention.follow_committed",
        fields: {
          relationCreated: true,
          supervisorConnectionId: supervisor.connectionId,
          supervisorThreadId: supervisor.threadId,
          workerConnectionId: worker.connectionId,
          workerThreadId: worker.threadId,
        },
      });
      return changed;
    });
  };

  const unfollow = async (
    supervisor: GlobalSupervisorQualifiedChatRef,
    worker: GlobalSupervisorQualifiedChatRef,
  ): Promise<void> => {
    await enqueue(async () => {
      const changes: GlobalSupervisorAttentionStorageChange[] = [
        { id: relationRowId(supervisor, worker), type: "delete" },
      ];
      for (const row of options.storage.rows()) {
        if (
          row.rowKind === "attention" &&
          row.state === "pending" &&
          sameRef(row.attention.supervisor, supervisor) &&
          sameRef(row.attention.worker, worker)
        ) {
          changes.push({ row: { ...row, state: "acknowledged" }, type: "put" });
        }
      }
      return apply(changes, new Set([qualifiedKey(supervisor)]));
    });
  };

  return {
    async acknowledge(supervisor, eventId) {
      await enqueue(async () => {
        const id = attentionRowId(supervisor, eventId);
        const current = options.storage.rows().find((row) => row.id === id);
        if (current?.rowKind !== "attention" || current.state === "acknowledged") {
          return new Set();
        }
        return apply(
          [{ row: { ...current, state: "acknowledged" }, type: "put" }],
          new Set([qualifiedKey(supervisor)]),
        );
      });
    },
    async beginWorkerCreation(request) {
      await enqueue(async () => {
        const id = creationRowId(request.supervisor, request.workerConnectionId, request.source);
        if (options.storage.rows().some((row) => row.id === id)) {
          return new Set();
        }
        const createdAt = options.now();
        const row: GlobalSupervisorRelationStorageRow = {
          id,
          observedAt: createdAt,
          relation: { createdAt, source: request.source, status: "creating" },
          rowKind: "relation",
          supervisorConnectionId: request.supervisor.connectionId,
          supervisorThreadId: request.supervisor.threadId,
          workerConnectionId: request.workerConnectionId,
          workerThreadId: null,
        };
        return apply([{ row, type: "put" }], new Set());
      });
    },
    close() {
      closed = true;
      deliveryEnabled.clear();
      listeners.clear();
      allListeners.clear();
      options.storage.close();
    },
    async completeWorkerCreation(request) {
      await enqueue(async () => {
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        for (const row of options.storage.rows()) {
          if (
            row.rowKind === "relation" &&
            row.relation.status === "creating" &&
            row.workerConnectionId === request.worker.connectionId &&
            row.relation.source === request.source
          ) {
            const supervisor = supervisorFromRow(row);
            changes.push({ id: row.id, type: "delete" });
            changes.push({
              row: relationForActive(supervisor, request.worker, row.relation.createdAt),
              type: "put",
            });
          }
        }
        return apply(changes, new Set());
      });
    },
    async disableDelivery(supervisor) {
      await setDeliveryEnabled(supervisor, false);
    },
    async enableDelivery(supervisor) {
      await setDeliveryEnabled(supervisor, true);
    },
    follow,
    async ingestEvents(connectionId, events) {
      await enqueue(async () => {
        const working = new Map(options.storage.rows().map((row) => [row.id, row]));
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        const changedSupervisors = new Set<string>();
        const batch = { changedSupervisors, changes, deliveryEnabled, working };
        const diagnostics = [];
        for (const event of events) {
          activateStartedRelations({ batch, connectionId, event });
          const diagnostic = addEventAttention({
            batch,
            connectionId,
            event,
            now: options.now(),
          });
          if (diagnostic !== null) {
            diagnostics.push(diagnostic);
          }
          removeClosedRelations({ batch, connectionId, event });
        }
        const changed = await apply(changes, changedSupervisors);
        for (const diagnostic of diagnostics) {
          appLogger.info({
            event: "global_voice.attention.event_committed",
            fields: { connectionId, ...diagnostic },
          });
        }
        return changed;
      });
    },
    async ingestPendingRequests(connectionId, requests) {
      await enqueue(async () => {
        const rows = options.storage.rows();
        const known = new Set(rows.map((row) => row.id));
        const currentEventIds = new Set<string>();
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        const changedSupervisors = new Set<string>();
        const observedAt = options.now();
        const batch = {
          changedSupervisors,
          changes,
          connectionId,
          currentEventIds,
          deliveryEnabled,
          known,
          rows,
        };
        addPendingRequestAttention(requests, observedAt, batch);
        acknowledgeMissingRequestAttention(batch);
        return apply(changes, changedSupervisors);
      });
    },
    async ingestSnapshot(connectionId, snapshots) {
      await enqueue(async () => {
        const working = new Map(options.storage.rows().map((row) => [row.id, row]));
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        const changedSupervisors = new Set<string>();
        const batch = { changedSupervisors, changes, deliveryEnabled, working };
        for (const snapshot of snapshots) {
          const worker = globalSupervisorQualifiedChatRef(connectionId, snapshot.thread.id);
          activateSnapshotRelations({ batch, connectionId, snapshot, worker });
          addSnapshotAttention({
            batch,
            connectionId,
            snapshot,
            worker,
          });
        }
        return apply(changes, changedSupervisors);
      });
    },
    async pending(supervisor, limit = ATTENTION_READ_MAX_ENTRIES) {
      await tail;
      await options.storage.ready;
      if (!deliveryEnabled.has(qualifiedKey(supervisor))) {
        return [];
      }
      const boundedLimit = Math.max(0, Math.min(limit, ATTENTION_READ_MAX_ENTRIES));
      return options.storage
        .rows()
        .flatMap((row) =>
          row.rowKind === "attention" &&
          row.state === "pending" &&
          sameRef(row.attention.supervisor, supervisor)
            ? [row.attention]
            : [],
        )
        .sort((left, right) => {
          const chronology = left.observedAt - right.observedAt;
          return chronology === 0 ? left.eventId.localeCompare(right.eventId) : chronology;
        })
        .slice(0, boundedLimit);
    },
    async pendingCount(supervisor) {
      await tail;
      await options.storage.ready;
      if (!deliveryEnabled.has(qualifiedKey(supervisor))) {
        return 0;
      }
      return options.storage
        .rows()
        .filter(
          (row) =>
            row.rowKind === "attention" &&
            row.state === "pending" &&
            sameRef(row.attention.supervisor, supervisor),
        ).length;
    },
    ready: options.storage.ready,
    subscribe(supervisor, listener) {
      const key = qualifiedKey(supervisor);
      const group = listeners.get(key) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(key, group);
      return {
        unsubscribe() {
          group.delete(listener);
          if (group.size === 0) {
            listeners.delete(key);
          }
        },
      };
    },
    subscribeAll(listener) {
      allListeners.add(listener);
      return {
        unsubscribe() {
          allListeners.delete(listener);
        },
      };
    },
    unfollow,
  };
}
