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
  GlobalSupervisorSpeechPolicyStorageRow,
} from "./globalSupervisorAttentionStorage.types";
import { projectGlobalSupervisorSafeText } from "./globalSupervisorSafeText";
import { globalSupervisorServerRequestEventId } from "./globalSupervisorPendingRequest";
import { isCatalogExcluded } from "./threadCatalogMembership";
import { unknownRecord } from "./unknownRecord";

const ATTENTION_SUMMARY_MAX_CHARACTERS = 480;
const ATTENTION_READ_MAX_ENTRIES = 32;
const ATTENTION_ACKNOWLEDGED_MAX_ENTRIES_PER_SUPERVISOR = 256;
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
type AutomaticDeliveryScope = {
  readonly baselineCursors: ReadonlyMap<string, number>;
  readonly enabledAt: number;
  readonly supervisor: GlobalSupervisorQualifiedChatRef;
};
type TerminalTurnStatus = "completed" | "failed" | "interrupted";

export type GlobalSupervisorSpokenAttentionPolicy =
  | { readonly mode: "active" }
  | { readonly mode: "muted" }
  | { readonly mode: "snoozed"; readonly until: number };

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
  readonly deleteConnection: (connectionId: string) => Promise<void>;
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
    cursor: number,
  ) => Promise<void>;
  readonly pending: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    limit?: number,
  ) => Promise<readonly GlobalSupervisorAttentionEvent[]>;
  readonly pendingCount: (supervisor: GlobalSupervisorQualifiedChatRef) => Promise<number>;
  readonly pendingForSpeech: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    limit?: number,
  ) => Promise<readonly GlobalSupervisorAttentionEvent[]>;
  readonly ready: Promise<void>;
  readonly setSpokenAttention: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    worker: GlobalSupervisorQualifiedChatRef,
    policy: GlobalSupervisorSpokenAttentionPolicy,
  ) => Promise<void>;
  readonly spokenAttention: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    worker: GlobalSupervisorQualifiedChatRef,
  ) => Promise<GlobalSupervisorSpokenAttentionPolicy>;
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

function speechPolicyRowId(
  supervisor: GlobalSupervisorQualifiedChatRef,
  worker: GlobalSupervisorQualifiedChatRef,
): string {
  return `speech-policy:${identity([
    supervisor.connectionId,
    supervisor.threadId,
    worker.connectionId,
    worker.threadId,
  ])}`;
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
  const projected = projectGlobalSupervisorSafeText(value, ATTENTION_SUMMARY_MAX_CHARACTERS);
  if (projected === "") {
    return fallback;
  }
  return projected;
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
  readonly deliveryScopes: ReadonlyMap<string, AutomaticDeliveryScope>;
  readonly relation: GlobalSupervisorRelationStorageRow;
  readonly source: Omit<GlobalSupervisorAttentionEvent, "supervisor" | "worker">;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): GlobalSupervisorAttentionStorageRow {
  const { deliveryScopes, relation, source, worker } = input;
  const supervisor = supervisorFromRow(relation);
  const attention: GlobalSupervisorAttentionEvent = { ...source, supervisor, worker };
  const delivery = deliveryScopes.get(qualifiedKey(supervisor));
  const baseline = delivery?.baselineCursors.get(worker.connectionId);
  const isAfterBaseline =
    source.sourceCursor === null || baseline === undefined || source.sourceCursor > baseline;
  return {
    attention,
    id: attentionRowId(supervisor, source.eventId),
    observedAt: source.observedAt,
    rowKind: "attention",
    state:
      delivery !== undefined && isAfterBaseline && source.observedAt >= delivery.enabledAt
        ? "pending"
        : "acknowledged",
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

function startedThreadId(event: SyncEvent): string | null {
  if (event.payload.method !== "thread/started") {
    return null;
  }
  const params = unknownRecord(event.payload.params);
  return nonEmptyString(unknownRecord(params?.thread)?.id);
}

function isClosingEvent(event: SyncEvent): boolean {
  return event.payload.method === "thread/deleted";
}

function startedThreadHasParent(event: SyncEvent): boolean {
  if (event.payload.method !== "thread/started") {
    return false;
  }
  const params = unknownRecord(event.payload.params);
  const thread = unknownRecord(params?.thread);
  return thread?.parentThreadId !== null && thread?.parentThreadId !== undefined;
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
      eventId: globalSupervisorServerRequestEventId(connectionId, request, threadId),
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
  readonly deliveryScopes: ReadonlyMap<string, AutomaticDeliveryScope>;
  readonly working: AttentionWorkingRows;
};
type PendingRequestBatch = {
  readonly changedSupervisors: Set<string>;
  readonly changes: GlobalSupervisorAttentionStorageChange[];
  readonly connectionId: string;
  readonly currentEventIds: Set<string>;
  readonly deliveryScopes: ReadonlyMap<string, AutomaticDeliveryScope>;
  readonly ineligibleWorkers: ReadonlySet<string>;
  readonly known: Set<string>;
  readonly rows: readonly GlobalSupervisorAttentionStoredRow[];
};

function automaticRelationCandidates(input: {
  readonly connectionId: string;
  readonly deliveryScopes: ReadonlyMap<string, AutomaticDeliveryScope>;
  readonly sourceCursor: number | null;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): GlobalSupervisorRelationStorageRow[] {
  const { connectionId, deliveryScopes, sourceCursor, worker } = input;
  const relations: GlobalSupervisorRelationStorageRow[] = [];
  for (const scope of deliveryScopes.values()) {
    if (sameRef(scope.supervisor, worker)) {
      continue;
    }
    const baseline = scope.baselineCursors.get(connectionId);
    if (sourceCursor !== null && baseline !== undefined && sourceCursor <= baseline) {
      continue;
    }
    relations.push(relationForActive(scope.supervisor, worker, scope.enabledAt));
  }
  return relations;
}

function attentionRelations(input: {
  readonly automatic: readonly GlobalSupervisorRelationStorageRow[];
  readonly rows: Iterable<GlobalSupervisorAttentionStoredRow>;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): readonly GlobalSupervisorRelationStorageRow[] {
  const bySupervisor = new Map<string, GlobalSupervisorRelationStorageRow>();
  for (const relation of activeRelationsForWorker(input.rows, input.worker)) {
    bySupervisor.set(qualifiedKey(supervisorFromRow(relation)), relation);
  }
  for (const relation of input.automatic) {
    const key = qualifiedKey(supervisorFromRow(relation));
    if (!bySupervisor.has(key)) {
      bySupervisor.set(key, relation);
    }
  }
  return [...bySupervisor.values()];
}

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

type AttentionDiagnostic = {
  readonly eventId: string;
  readonly matchedRelations: number;
  readonly pendingRowsAdded: number;
  readonly sourceCursor: number | null;
  readonly workerThreadId: string;
};

function attentionDiagnostic(input: {
  readonly candidate: AttentionCandidate;
  readonly matchedRelations: number;
  readonly pendingRowsAdded: number;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): AttentionDiagnostic {
  const { candidate, matchedRelations, pendingRowsAdded, worker } = input;
  return {
    eventId: candidate.source.eventId,
    matchedRelations,
    pendingRowsAdded,
    sourceCursor: candidate.source.sourceCursor,
    workerThreadId: worker.threadId,
  };
}

function appendCandidateAttention(input: {
  readonly batch: AttentionMutationBatch;
  readonly candidate: AttentionCandidate;
  readonly connectionId: string;
  readonly terminalAt: number | null;
  readonly worker: GlobalSupervisorQualifiedChatRef;
}): AttentionDiagnostic {
  const { batch, candidate, connectionId, terminalAt, worker } = input;
  const { changedSupervisors, changes, deliveryScopes, working } = batch;
  let matchedRelations = 0;
  let pendingRowsAdded = 0;
  const automatic = automaticRelationCandidates({
    connectionId,
    deliveryScopes,
    sourceCursor: candidate.source.sourceCursor,
    worker,
  });
  for (const relation of attentionRelations({ automatic, rows: working.values(), worker })) {
    matchedRelations += 1;
    if (terminalAt !== null && terminalAt < relation.relation.createdAt) {
      continue;
    }
    const row = attentionRow({ deliveryScopes, relation, source: candidate.source, worker });
    if (working.has(row.id)) {
      continue;
    }
    working.set(row.id, row);
    changes.push({ row, type: "put" });
    markPendingSupervisorChanged(row, changedSupervisors);
    pendingRowsAdded += Number(row.state === "pending");
  }
  return attentionDiagnostic({ candidate, matchedRelations, pendingRowsAdded, worker });
}

function addEventAttention(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly event: SyncEvent;
  readonly ineligibleWorkers: ReadonlySet<string>;
  readonly now: number;
}): AttentionDiagnostic | null {
  const { batch, connectionId, event, ineligibleWorkers, now } = input;
  const candidate = eventCandidate(connectionId, event, now);
  if (candidate === null) {
    return null;
  }
  const worker = globalSupervisorQualifiedChatRef(connectionId, candidate.threadId);
  if (isCatalogExcluded(event.payload) || ineligibleWorkers.has(qualifiedKey(worker))) {
    return attentionDiagnostic({ candidate, matchedRelations: 0, pendingRowsAdded: 0, worker });
  }
  const turn = unknownRecord(unknownRecord(event.payload.params)?.turn);
  return appendCandidateAttention({
    batch,
    candidate,
    connectionId,
    terminalAt: turn === null ? null : completedAt(turn),
    worker,
  });
}

function updateAutomaticWorkerEligibility(
  connectionId: string,
  event: SyncEvent,
  ineligibleWorkers: Set<string>,
): void {
  const threadId = eventThreadId(event) ?? startedThreadId(event);
  if (threadId === null) {
    return;
  }
  const key = qualifiedKey(globalSupervisorQualifiedChatRef(connectionId, threadId));
  if (isClosingEvent(event) || isCatalogExcluded(event.payload) || startedThreadHasParent(event)) {
    ineligibleWorkers.add(key);
    return;
  }
  if (event.payload.method === "thread/started") {
    ineligibleWorkers.delete(key);
  }
}

function reduceEventAttentionBatch(input: {
  readonly batch: AttentionMutationBatch;
  readonly connectionId: string;
  readonly events: readonly SyncEvent[];
  readonly ineligibleWorkers: Set<string>;
  readonly now: () => number;
}): readonly AttentionDiagnostic[] {
  const diagnostics: AttentionDiagnostic[] = [];
  for (const event of input.events) {
    updateAutomaticWorkerEligibility(input.connectionId, event, input.ineligibleWorkers);
    activateStartedRelations({ batch: input.batch, connectionId: input.connectionId, event });
    const diagnostic = addEventAttention({
      batch: input.batch,
      connectionId: input.connectionId,
      event,
      ineligibleWorkers: input.ineligibleWorkers,
      now: input.now(),
    });
    if (diagnostic !== null) {
      diagnostics.push(diagnostic);
    }
    removeClosedRelations({ batch: input.batch, connectionId: input.connectionId, event });
  }
  return diagnostics;
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
    deliveryScopes,
    ineligibleWorkers,
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
    if (ineligibleWorkers.has(qualifiedKey(worker))) {
      continue;
    }
    const automatic = automaticRelationCandidates({
      connectionId,
      deliveryScopes,
      sourceCursor: candidate.source.sourceCursor,
      worker,
    });
    for (const relation of attentionRelations({ automatic, rows, worker })) {
      const row = attentionRow({ deliveryScopes, relation, source: candidate.source, worker });
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
  const { changedSupervisors, changes, deliveryScopes, working } = batch;
  const candidate = terminalSnapshotCandidate(connectionId, snapshot);
  if (candidate === null) {
    return;
  }
  const automatic = automaticRelationCandidates({
    connectionId,
    deliveryScopes,
    sourceCursor: candidate.sourceCursor,
    worker,
  });
  for (const relation of attentionRelations({ automatic, rows: working.values(), worker })) {
    if (candidate.observedAt < relation.relation.createdAt) {
      continue;
    }
    const row = attentionRow({ deliveryScopes, relation, source: candidate, worker });
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

function applyAttentionStorageChange(
  rows: Map<string, GlobalSupervisorAttentionStoredRow>,
  change: GlobalSupervisorAttentionStorageChange,
): void {
  if (change.type === "delete") {
    rows.delete(change.id);
    return;
  }
  rows.set(change.row.id, change.row);
}

function projectedAttentionRows(
  rows: readonly GlobalSupervisorAttentionStoredRow[],
  changes: readonly GlobalSupervisorAttentionStorageChange[],
): Iterable<GlobalSupervisorAttentionStoredRow> {
  const projected = new Map(rows.map((row) => [row.id, row]));
  for (const change of changes) {
    applyAttentionStorageChange(projected, change);
  }
  return projected.values();
}

function appendAcknowledgedAttention(
  bySupervisor: Map<string, GlobalSupervisorAttentionStorageRow[]>,
  row: GlobalSupervisorAttentionStoredRow,
): void {
  if (row.rowKind !== "attention" || row.state !== "acknowledged") {
    return;
  }
  const key = identity([row.supervisorConnectionId, row.supervisorThreadId]);
  const group = bySupervisor.get(key) ?? [];
  group.push(row);
  bySupervisor.set(key, group);
}

function acknowledgedAttentionBySupervisor(
  rows: Iterable<GlobalSupervisorAttentionStoredRow>,
): Iterable<GlobalSupervisorAttentionStorageRow[]> {
  const bySupervisor = new Map<string, GlobalSupervisorAttentionStorageRow[]>();
  for (const row of rows) {
    appendAcknowledgedAttention(bySupervisor, row);
  }
  return bySupervisor.values();
}

function compareStoredAttention(
  left: GlobalSupervisorAttentionStorageRow,
  right: GlobalSupervisorAttentionStorageRow,
): number {
  const chronology = left.observedAt - right.observedAt;
  return chronology === 0 ? left.id.localeCompare(right.id) : chronology;
}

function acknowledgedRetentionChanges(
  groups: Iterable<GlobalSupervisorAttentionStorageRow[]>,
): GlobalSupervisorAttentionStorageChange[] {
  const deletes: GlobalSupervisorAttentionStorageChange[] = [];
  for (const group of groups) {
    group.sort(compareStoredAttention);
    const excess = Math.max(0, group.length - ATTENTION_ACKNOWLEDGED_MAX_ENTRIES_PER_SUPERVISOR);
    deletes.push(...group.slice(0, excess).map((row) => ({ id: row.id, type: "delete" as const })));
  }
  return deletes;
}

function withAcknowledgedAttentionRetention(
  rows: readonly GlobalSupervisorAttentionStoredRow[],
  changes: readonly GlobalSupervisorAttentionStorageChange[],
): readonly GlobalSupervisorAttentionStorageChange[] {
  const projected = projectedAttentionRows(rows, changes);
  const groups = acknowledgedAttentionBySupervisor(projected);
  return [...changes, ...acknowledgedRetentionChanges(groups)];
}

function storedSpeechPolicy(
  rows: readonly GlobalSupervisorAttentionStoredRow[],
  supervisor: GlobalSupervisorQualifiedChatRef,
  worker: GlobalSupervisorQualifiedChatRef,
): GlobalSupervisorSpeechPolicyStorageRow | null {
  const row = rows.find((candidate) => candidate.id === speechPolicyRowId(supervisor, worker));
  return row?.rowKind === "speechPolicy" ? row : null;
}

function effectiveSpeechPolicy(
  row: GlobalSupervisorSpeechPolicyStorageRow | null,
  now: number,
): GlobalSupervisorSpokenAttentionPolicy {
  if (row === null || (row.policy.mode === "snoozed" && row.policy.until <= now)) {
    return { mode: "active" };
  }
  return row.policy;
}

function pendingAttentionEvents(input: {
  readonly include: (event: GlobalSupervisorAttentionEvent) => boolean;
  readonly limit: number;
  readonly rows: readonly GlobalSupervisorAttentionStoredRow[];
  readonly supervisor: GlobalSupervisorQualifiedChatRef;
}): readonly GlobalSupervisorAttentionEvent[] {
  return input.rows
    .flatMap((row) =>
      row.rowKind === "attention" &&
      row.state === "pending" &&
      sameRef(row.attention.supervisor, input.supervisor) &&
      input.include(row.attention)
        ? [row.attention]
        : [],
    )
    .sort((left, right) => {
      const chronology = left.observedAt - right.observedAt;
      return chronology === 0 ? left.eventId.localeCompare(right.eventId) : chronology;
    })
    .slice(0, input.limit);
}

/** Durable relation, event reduction, dedupe, ordering and acknowledgement owner. */
export function createGlobalSupervisorAttentionOwner(options: {
  readonly now: () => number;
  readonly storage: GlobalSupervisorAttentionStorage;
}): GlobalSupervisorAttentionOwner {
  const listeners = new Map<string, Set<() => void>>();
  const allListeners = new Set<() => void>();
  const deliveryScopes = new Map<string, AutomaticDeliveryScope>();
  const connectionCursors = new Map<string, number>();
  const ineligibleWorkers = new Set<string>();
  let speechWakeTimer: ReturnType<typeof setTimeout> | null = null;
  let tail = Promise.resolve();
  let closed = false;

  const notify = (keys: ReadonlySet<string>): void => {
    for (const key of keys) {
      for (const listener of listeners.get(key) ?? []) {
        listener();
      }
    }
    if (keys.size > 0) {
      for (const listener of allListeners) {
        listener();
      }
    }
  };

  const scheduleSpeechWake = (): void => {
    if (speechWakeTimer !== null) {
      clearTimeout(speechWakeTimer);
      speechWakeTimer = null;
    }
    if (closed) {
      return;
    }
    const now = options.now();
    const next = options.storage
      .rows()
      .flatMap((row) =>
        row.rowKind === "speechPolicy" && row.policy.mode === "snoozed" && row.policy.until > now
          ? [row.policy.until]
          : [],
      )
      .sort((left, right) => left - right)[0];
    if (next === undefined) {
      return;
    }
    speechWakeTimer = setTimeout(
      () => {
        speechWakeTimer = null;
        enqueue(async () => {
          const currentNow = options.now();
          const changes: GlobalSupervisorAttentionStorageChange[] = [];
          const changed = new Set<string>();
          for (const row of options.storage.rows()) {
            if (
              row.rowKind === "speechPolicy" &&
              row.policy.mode === "snoozed" &&
              row.policy.until <= currentNow
            ) {
              changes.push({ id: row.id, type: "delete" });
              changed.add(
                qualifiedKey(
                  globalSupervisorQualifiedChatRef(
                    row.supervisorConnectionId,
                    row.supervisorThreadId,
                  ),
                ),
              );
            }
          }
          const result = await apply(changes, changed);
          scheduleSpeechWake();
          return result;
        }).catch((error: unknown) => {
          appLogger.warnCaught({
            error,
            event: "global_voice.attention.speech_policy_wake.failed",
          });
        });
      },
      Math.max(0, next - now),
    );
  };

  const enqueue = async (operation: () => Promise<ReadonlySet<string>>): Promise<void> => {
    const next = tail.then(async () => {
      if (closed) {
        return;
      }
      await options.storage.ready;
      const changed = await operation();
      notify(changed);
    });
    tail = next.catch(() => undefined);
    await next;
  };

  const apply = async (
    changes: readonly GlobalSupervisorAttentionStorageChange[],
    changedSupervisors: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> => {
    await options.storage.commit(
      withAcknowledgedAttentionRetention(options.storage.rows(), changes),
    );
    return changedSupervisors;
  };

  void options.storage.ready.then(scheduleSpeechWake).catch((error: unknown) => {
    appLogger.warnCaught({ error, event: "global_voice.attention.speech_policy_restore.failed" });
  });

  const setDeliveryEnabled = async (
    supervisor: GlobalSupervisorQualifiedChatRef,
    enabled: boolean,
  ): Promise<void> => {
    await enqueue(async () => {
      const key = qualifiedKey(supervisor);
      if (enabled && deliveryScopes.has(key)) {
        return new Set();
      }
      const changes = pendingAcknowledgementChanges(options.storage.rows(), supervisor);
      const changedSupervisors = changes.length === 0 ? new Set<string>() : new Set([key]);
      const changed = await apply(changes, changedSupervisors);
      if (enabled) {
        deliveryScopes.set(key, {
          baselineCursors: new Map(connectionCursors),
          enabledAt: options.now(),
          supervisor,
        });
      } else {
        deliveryScopes.delete(key);
      }
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
      if (speechWakeTimer !== null) {
        clearTimeout(speechWakeTimer);
        speechWakeTimer = null;
      }
      deliveryScopes.clear();
      connectionCursors.clear();
      ineligibleWorkers.clear();
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
    async deleteConnection(connectionId) {
      await enqueue(async () => {
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        const changedSupervisors = new Set<string>();
        for (const row of options.storage.rows()) {
          if (
            row.supervisorConnectionId !== connectionId &&
            row.workerConnectionId !== connectionId
          ) {
            continue;
          }
          changes.push({ id: row.id, type: "delete" });
          changedSupervisors.add(
            qualifiedKey(
              globalSupervisorQualifiedChatRef(row.supervisorConnectionId, row.supervisorThreadId),
            ),
          );
        }
        await options.storage.commit(changes);
        const prefix = `[${JSON.stringify(connectionId)},`;
        for (const key of deliveryScopes.keys()) {
          if (key.startsWith(prefix)) {
            deliveryScopes.delete(key);
          }
        }
        connectionCursors.delete(connectionId);
        for (const key of ineligibleWorkers) {
          if (key.startsWith(prefix)) {
            ineligibleWorkers.delete(key);
          }
        }
        return changedSupervisors;
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
        const batch = { changedSupervisors, changes, deliveryScopes, working };
        const diagnostics = reduceEventAttentionBatch({
          batch,
          connectionId,
          events,
          ineligibleWorkers,
          now: options.now,
        });
        const changed = await apply(changes, changedSupervisors);
        const lastCursor = events.at(-1)?.cursor;
        if (lastCursor !== undefined) {
          connectionCursors.set(connectionId, lastCursor);
        }
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
          deliveryScopes,
          ineligibleWorkers,
          known,
          rows,
        };
        addPendingRequestAttention(requests, observedAt, batch);
        acknowledgeMissingRequestAttention(batch);
        return apply(changes, changedSupervisors);
      });
    },
    async ingestSnapshot(connectionId, snapshots, cursor) {
      await enqueue(async () => {
        connectionCursors.set(connectionId, cursor);
        for (const [key, scope] of deliveryScopes) {
          if (scope.baselineCursors.has(connectionId)) {
            continue;
          }
          deliveryScopes.set(key, {
            ...scope,
            baselineCursors: new Map([...scope.baselineCursors, [connectionId, cursor]]),
          });
        }
        const working = new Map(options.storage.rows().map((row) => [row.id, row]));
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        const changedSupervisors = new Set<string>();
        const batch = { changedSupervisors, changes, deliveryScopes, working };
        for (const snapshot of snapshots) {
          const worker = globalSupervisorQualifiedChatRef(connectionId, snapshot.thread.id);
          const thread = unknownRecord(snapshot.thread);
          if (
            thread === null ||
            isCatalogExcluded(thread) ||
            (thread.parentThreadId !== null && thread.parentThreadId !== undefined)
          ) {
            ineligibleWorkers.add(qualifiedKey(worker));
            continue;
          }
          ineligibleWorkers.delete(qualifiedKey(worker));
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
      if (!deliveryScopes.has(qualifiedKey(supervisor))) {
        return [];
      }
      const boundedLimit = Math.max(0, Math.min(limit, ATTENTION_READ_MAX_ENTRIES));
      return pendingAttentionEvents({
        include: () => true,
        limit: boundedLimit,
        rows: options.storage.rows(),
        supervisor,
      });
    },
    async pendingCount(supervisor) {
      await tail;
      await options.storage.ready;
      if (!deliveryScopes.has(qualifiedKey(supervisor))) {
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
    async pendingForSpeech(supervisor, limit = ATTENTION_READ_MAX_ENTRIES) {
      await tail;
      await options.storage.ready;
      if (!deliveryScopes.has(qualifiedKey(supervisor))) {
        return [];
      }
      const boundedLimit = Math.max(0, Math.min(limit, ATTENTION_READ_MAX_ENTRIES));
      const now = options.now();
      return pendingAttentionEvents({
        include: (event) => {
          const policy = storedSpeechPolicy(options.storage.rows(), supervisor, event.worker);
          return effectiveSpeechPolicy(policy, now).mode === "active";
        },
        limit: boundedLimit,
        rows: options.storage.rows(),
        supervisor,
      });
    },
    ready: options.storage.ready,
    async setSpokenAttention(supervisor, worker, policy) {
      await enqueue(async () => {
        const id = speechPolicyRowId(supervisor, worker);
        const changes: GlobalSupervisorAttentionStorageChange[] = [];
        if (
          policy.mode === "active" ||
          (policy.mode === "snoozed" && policy.until <= options.now())
        ) {
          changes.push({ id, type: "delete" });
        } else {
          const row: GlobalSupervisorSpeechPolicyStorageRow = {
            id,
            observedAt: options.now(),
            policy,
            rowKind: "speechPolicy",
            supervisorConnectionId: supervisor.connectionId,
            supervisorThreadId: supervisor.threadId,
            workerConnectionId: worker.connectionId,
            workerThreadId: worker.threadId,
          };
          changes.push({ row, type: "put" });
        }
        const changed = await apply(changes, new Set([qualifiedKey(supervisor)]));
        scheduleSpeechWake();
        return changed;
      });
    },
    async spokenAttention(supervisor, worker) {
      await tail;
      await options.storage.ready;
      return effectiveSpeechPolicy(
        storedSpeechPolicy(options.storage.rows(), supervisor, worker),
        options.now(),
      );
    },
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
