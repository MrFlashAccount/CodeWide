import type { Thread, ThreadItem, Turn, TurnPlanStep } from "@codewide/codex-protocol/v0.147.0/v2";

import { reconcileTurnItems } from "./thread-items";

export type ProjectedTurnMetadata = {
  usage?: TurnUsageProjection;
  diff?: string;
  plan?: { explanation: string | null; steps: TurnPlanStep[] };
  activity?: { count: number; kinds: string[]; outputFootprint?: OutputFootprintProjection };
  execution?: {
    model: string;
    effort: string | null;
    permissions: string | null;
    modelSource: "settings" | "reroute";
  };
};

export type OutputFootprintProjection = {
  version: 1;
  basis: "approxBytesPerToken";
  bytes: number;
  estimatedTokens: number;
};

export function projectedOutputFootprint(value: unknown): OutputFootprintProjection | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const bytes = candidate.bytes;
  const estimatedTokens = candidate.estimatedTokens;
  if (candidate.version !== 1
    || candidate.basis !== "approxBytesPerToken"
    || typeof bytes !== "number"
    || !Number.isSafeInteger(bytes)
    || bytes < 0
    || typeof estimatedTokens !== "number"
    || !Number.isSafeInteger(estimatedTokens)
    || estimatedTokens < 0) return null;
  return { version: 1, basis: "approxBytesPerToken", bytes, estimatedTokens };
}

export function sumOutputFootprints(values: readonly unknown[]): OutputFootprintProjection | null {
  const total = values.reduce<{ bytes: number; estimatedTokens: number }>((sum, value) => {
    const footprint = projectedOutputFootprint(value);
    return footprint === null
      ? sum
      : {
          bytes: Math.min(Number.MAX_SAFE_INTEGER, sum.bytes + footprint.bytes),
          estimatedTokens: Math.min(Number.MAX_SAFE_INTEGER, sum.estimatedTokens + footprint.estimatedTokens),
        };
  }, { bytes: 0, estimatedTokens: 0 });
  return total.bytes === 0 && total.estimatedTokens === 0
    ? null
    : { version: 1, basis: "approxBytesPerToken", ...total };
}

export type UsageTokenCounts = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type UsageCostProjection = {
  model: string;
  pricingVersion: string;
  currency: "USD";
  basis: "apiEquivalent";
  price: { input: number; cachedInput: number; output: number };
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  cacheHitPercent: number;
  uncachedInputCostUsd: number;
  cachedInputCostUsd: number;
  cacheWriteInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

export type UsageScopeProjection = {
  tokens: UsageTokenCounts;
  cost: UsageCostProjection | null;
};

export type TurnUsageProjection = {
  version: 1;
  status: "live" | "final";
  modelContextWindow: number | null;
  latestRequest: UsageTokenCounts;
  turn: UsageScopeProjection;
  thread: UsageScopeProjection;
};

type ProjectedTurn = Turn & { codewide?: ProjectedTurnMetadata };
type ProjectedThreadMetadata = {
  executionSettings?: {
    model: string;
    effort: string | null;
    permissions: string | null;
    approvalPolicy: string | null;
    sandboxPolicy: string | null;
  };
};
type ProjectedThread = Thread & { codewide?: ProjectedThreadMetadata };

export type ProjectedThreadExecutionSettings = NonNullable<ProjectedThreadMetadata["executionSettings"]>;

type ThreadEventIndex = {
  turns: Thread["turns"];
  turnIndexById: Map<string, number>;
  itemIndexByTurnId: Map<string, Map<string, number>>;
  itemArraysByTurnId: Map<string, Turn["items"]>;
};

const threadEventIndexes = new WeakMap<Thread, ThreadEventIndex>();
export const MAX_LIVE_FIELD_CHARS = 64 * 1024;
const LIVE_HEAD_CHARS = 48 * 1024;
const LIVE_TRUNCATION_MARKER = "\n… [earlier live output omitted] …\n";
export const THREAD_PROJECTION_PATCH_FIELD = "codewideThreadPatch";

export type ThreadProjectionPatchV1 = {
  version: 1;
  threadId: string;
  operation: Record<string, unknown> & { kind: string };
};

/**
 * Detects a projection batch that cannot be proven complete from the cached
 * thread alone. The caller must replace that thread from an authoritative
 * read before acknowledging the batch as projected.
 */
export function threadProjectionNeedsAuthoritativeRepair(
  thread: Thread,
  patches: ThreadProjectionPatchV1[],
): boolean {
  const itemTypesByTurn = new Map<string, Map<string, string>>(
    thread.turns.map((turn) => [
      turn.id,
      new Map<string, string>(turn.items.map((item) => [item.id, item.type] as const)),
    ] as const),
  );
  for (const patch of patches) {
    if (patch.threadId !== thread.id) continue;
    const operation = patch.operation;
    const turn = asObject(operation.turn);
    if (operation.kind === "turnCompleted") return true;
    if (operation.kind === "turnStarted") {
      if (typeof turn?.id !== "string") return true;
      itemTypesByTurn.set(turn.id, new Map<string, string>(
        Array.isArray(turn.items)
          ? turn.items.flatMap((value) => {
            const item = asObject(value);
            return typeof item?.id === "string" && typeof item.type === "string"
              ? [[item.id, item.type] as const]
              : [];
          })
          : [],
      ));
      continue;
    }
    const turnId = operation.turnId;
    if (operation.kind === "itemUpsert") {
      if (typeof turnId !== "string") return true;
      const itemTypes = itemTypesByTurn.get(turnId);
      if (itemTypes === undefined) return true;
      const item = asObject(operation.item);
      if (typeof item?.id !== "string" || typeof item.type !== "string") return true;
      itemTypes.set(item.id, item.type);
      continue;
    }
    const expectedItemType = expectedProjectionItemType(operation);
    if (expectedItemType !== null) {
      if (typeof turnId !== "string" || typeof operation.itemId !== "string") return true;
      const actualItemType = itemTypesByTurn.get(turnId)?.get(operation.itemId);
      if (actualItemType !== expectedItemType) return true;
      continue;
    }
    if (TURN_SCOPED_PROJECTION_KINDS.has(operation.kind)) {
      if (typeof turnId !== "string" || !itemTypesByTurn.has(turnId)) return true;
    }
  }
  return false;
}

const TURN_SCOPED_PROJECTION_KINDS = new Set([
  "modelRerouted",
  "tokenUsage",
  "turnDiff",
  "turnPlan",
]);

function expectedProjectionItemType(operation: ThreadProjectionPatchV1["operation"]): string | null {
  if (operation.kind === "itemTextDelta") {
    return typeof operation.itemType === "string" ? operation.itemType : "";
  }
  if (operation.kind === "fileChanges") return "fileChange";
  if (operation.kind === "mcpProgress") return "mcpToolCall";
  if (operation.kind === "reasoningPart" || operation.kind === "reasoningDelta") return "reasoning";
  return null;
}

/** Reads the companion-owned semantic patch attached to a raw notification. */
export function threadProjectionPatchFromEvent(payload: Record<string, unknown>): ThreadProjectionPatchV1 | null {
  const patch = asObject(payload[THREAD_PROJECTION_PATCH_FIELD]);
  const operation = asObject(patch?.operation);
  const params = asObject(payload.params);
  return patch?.version === 1 && typeof patch.threadId === "string" && typeof operation?.kind === "string"
    ? { version: 1, threadId: patch.threadId, operation: { ...(params ?? {}), ...operation } as ThreadProjectionPatchV1["operation"] }
    : null;
}

export function threadIdFromEvent(payload: Record<string, unknown>): string | null {
  return threadProjectionPatchFromEvent(payload)?.threadId ?? null;
}

/** Applies the App Server notifications that materially change a cached thread. */
export function applyThreadEvent(thread: Thread, payload: Record<string, unknown>): boolean {
  const patch = threadProjectionPatchFromEvent(payload);
  return patch === null ? false : applyThreadProjectionPatch(thread, patch);
}

/** Applies one semantic patch. The client mirrors operations; it does not interpret App Server methods. */
export function applyThreadProjectionPatch(thread: Thread, patch: ThreadProjectionPatchV1): boolean {
  if (patch.threadId !== thread.id) return false;
  const params = patch.operation;
  let changed = true;
  if (params.kind === "threadStatus" && params.status !== undefined) thread.status = params.status as Thread["status"];
  else if (params.kind === "threadName") thread.name = typeof params.threadName === "string" ? params.threadName : null;
  else if (params.kind === "threadSettings") updateThreadSettings(thread, params.threadSettings);
  else if (params.kind === "turnStarted") {
    upsertTurn(thread, params.turn);
    snapshotTurnExecution(thread, asObject(params.turn)?.id);
  }
  else if (params.kind === "turnCompleted") {
    upsertTurn(thread, params.turn);
    updateTurnUsage(thread, asObject(params.turn)?.id, params.usage);
  }
  else if (params.kind === "modelRerouted") updateReroutedModel(thread, params.turnId, params.toModel);
  else if (params.kind === "itemUpsert") {
    upsertItem(thread, params.turnId, itemWithLifecycleMetadata(thread, params.turnId, params.item, params.itemPhase));
  }
  else if (params.kind === "itemTextDelta" && (params.itemType === "agentMessage" || params.itemType === "plan" || params.itemType === "commandExecution")) {
    appendText(thread, params.turnId, params.itemId, params.delta, params.itemType);
  }
  else if (params.kind === "fileChanges") updateFileChanges(thread, params.turnId, params.itemId, params.changes);
  else if (params.kind === "mcpProgress") appendMcpProgress(thread, params.turnId, params.itemId, params.message);
  else if (params.kind === "tokenUsage") updateTurnUsage(thread, params.turnId, params.usage);
  else if (params.kind === "turnDiff") updateTurnDiff(thread, params.turnId, params.diff);
  else if (params.kind === "turnPlan") updateTurnPlan(thread, params.turnId, params.explanation, params.plan);
  else if (params.kind === "reasoningPart" && (params.field === "summary" || params.field === "content")) {
    addReasoningPart(thread, params.turnId, params.itemId, params.summaryIndex ?? params.contentIndex, params.field);
  }
  else if (params.kind === "reasoningDelta" && (params.field === "summary" || params.field === "content")) {
    appendReasoning(thread, params.turnId, params.itemId, params.summaryIndex ?? params.contentIndex, params.delta, params.field);
  }
  else changed = false;
  if (changed) thread.updatedAt = Math.max(thread.updatedAt, Math.floor(Date.now() / 1000));
  return changed;
}

/**
 * Applies a live event batch without cloning the full thread history. Only turns
 * addressed by the batch are copied, which keeps token streaming cheap even
 * when the cached thread contains hundreds of turns.
 */
export function applyThreadEventsImmutable(thread: Thread, payloads: Record<string, unknown>[]): Thread {
  const patches = payloads
    .map((payload) => threadProjectionPatchFromEvent(payload))
    .filter((patch): patch is ThreadProjectionPatchV1 => patch !== null);
  return applyThreadProjectionPatchesImmutable(thread, patches);
}

/** Applies a companion-owned patch batch while cloning only the mutable head. */
export function applyThreadProjectionPatchesImmutable(thread: Thread, patches: ThreadProjectionPatchV1[]): Thread {
  const affectedTurnIds = new Set<string>();
  const affectedItemIdsByTurn = new Map<string, Set<string>>();
  for (const patch of patches) {
    const operation = patch.operation;
    if (patch.threadId !== thread.id) continue;
    if (typeof operation.turnId === "string") {
      affectedTurnIds.add(operation.turnId);
      const item = asObject(operation.item);
      const itemId = typeof operation.itemId === "string" ? operation.itemId : typeof item?.id === "string" ? item.id : null;
      if (itemId !== null) {
        const ids = affectedItemIdsByTurn.get(operation.turnId) ?? new Set<string>();
        ids.add(itemId);
        affectedItemIdsByTurn.set(operation.turnId, ids);
      }
    }
    const turn = asObject(operation.turn);
    if (typeof turn?.id === "string") affectedTurnIds.add(turn.id);
  }
  const sourceIndex = eventIndex(thread);
  const turns = affectedTurnIds.size === 0 ? thread.turns : thread.turns.slice();
  const nextIndex = cloneEventIndex(sourceIndex, turns);
  for (const turnId of affectedTurnIds) {
    const turnIndex = sourceIndex.turnIndexById.get(turnId);
    if (turnIndex === undefined) continue;
    const sourceTurn = thread.turns[turnIndex];
    if (sourceTurn === undefined || sourceTurn.id !== turnId) continue;
    const clonedTurn = cloneTurnForEvents(sourceTurn, affectedItemIdsByTurn.get(turnId), sourceIndex.itemIndexByTurnId.get(turnId));
    turns[turnIndex] = clonedTurn;
    indexTurnItems(nextIndex, clonedTurn);
  }
  const next: Thread = { ...thread, turns };
  threadEventIndexes.set(next, nextIndex);
  const projected = thread as ProjectedThread;
  if (projected.codewide !== undefined) {
    (next as ProjectedThread).codewide = structuredClone(projected.codewide);
  }
  let changed = false;
  for (const patch of patches) changed = applyThreadProjectionPatch(next, patch) || changed;
  return changed ? next : thread;
}

function cloneTurnForEvents(turn: Turn, itemIds: Set<string> | undefined, itemIndexes: Map<string, number> | undefined): Turn {
  const items = turn.items.slice();
  if (itemIds !== undefined) {
    for (const itemId of itemIds) {
      const index = itemIndexes?.get(itemId);
      if (index === undefined || items[index]?.id !== itemId) continue;
      items[index] = structuredClone(items[index]);
    }
  }
  const cloned: ProjectedTurn = { ...turn, items };
  const metadata = (turn as ProjectedTurn).codewide;
  if (metadata !== undefined) cloned.codewide = structuredClone(metadata);
  return cloned;
}

export function projectedTurnMetadata(turn: Turn): ProjectedTurnMetadata | null {
  const metadata = (turn as ProjectedTurn).codewide;
  return metadata === undefined || metadata === null || typeof metadata !== "object" ? null : metadata;
}

export function projectedThreadExecutionSettings(thread: Thread): ProjectedThreadExecutionSettings | null {
  const settings = (thread as ProjectedThread).codewide?.executionSettings;
  return settings === undefined ? null : structuredClone(settings);
}

/**
 * Returns the latest real execution settings that can paint a cached thread.
 * Current thread settings are authoritative; older persisted projections may
 * only have the immutable per-turn snapshot, which is still preferable to a
 * loading placeholder while thread/resume refreshes in the background.
 */
export function latestProjectedThreadExecutionSettings(thread: Thread): ProjectedThreadExecutionSettings | null {
  const settings = projectedThreadExecutionSettings(thread);
  if (settings !== null) return settings;
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const execution = projectedTurnMetadata(thread.turns[index]!)?.execution;
    if (execution === undefined) continue;
    return {
      model: execution.model,
      effort: execution.effort,
      permissions: execution.permissions,
      approvalPolicy: null,
      sandboxPolicy: null,
    };
  }
  return null;
}

/** Seeds the authoritative settings returned by thread/resume for future turns. */
export function seedThreadExecutionSettings(
  thread: Thread,
  settings: {
    model: string;
    effort: string | null;
    permissions: string | null;
    approvalPolicy?: string | null;
    sandboxPolicy?: string | null;
  },
): Thread {
  const projected = thread as ProjectedThread;
  projected.codewide ??= {};
  const previous = projected.codewide.executionSettings;
  projected.codewide.executionSettings = structuredClone({
    ...settings,
    approvalPolicy: settings.approvalPolicy ?? previous?.approvalPolicy ?? null,
    sandboxPolicy: settings.sandboxPolicy ?? previous?.sandboxPolicy ?? null,
  });
  for (const turn of thread.turns) {
    if (turn.status === "inProgress" && projectedTurnMetadata(turn)?.execution === undefined) {
      snapshotTurnExecution(thread, turn.id);
    }
  }
  return thread;
}

/** Keeps live-only metadata when a full thread/read payload refreshes turns. */
export function preserveProjectedTurnMetadata(incoming: Thread, cached: Thread | null | undefined): Thread {
  if (cached === null || cached === undefined) return incoming;
  const cachedThreadMetadata = (cached as ProjectedThread).codewide;
  if (cachedThreadMetadata !== undefined) {
    (incoming as ProjectedThread).codewide = {
      ...structuredClone(cachedThreadMetadata),
      ...structuredClone((incoming as ProjectedThread).codewide ?? {}),
    };
  }
  if (cached.turns.length === 0 || incoming.turns.length === 0) return incoming;
  const cachedTurns = new Map(cached.turns.map((turn) => [turn.id, turn] as const));
  return {
    ...incoming,
    turns: incoming.turns.map((turn) => mergeTurnMetadata(turn, cachedTurns.get(turn.id))),
  };
}

function updateThreadSettings(thread: Thread, value: unknown): void {
  const settings = asObject(value);
  if (settings === null || typeof settings.model !== "string") return;
  const activePermissionProfile = asObject(settings.activePermissionProfile);
  seedThreadExecutionSettings(thread, {
    model: settings.model,
    effort: typeof settings.effort === "string" ? settings.effort : null,
    permissions: typeof activePermissionProfile?.id === "string" ? activePermissionProfile.id : null,
    approvalPolicy: approvalPolicyName(settings.approvalPolicy),
    sandboxPolicy: sandboxPolicyName(settings.sandboxPolicy),
  });
}

function approvalPolicyName(value: unknown): string | null {
  if (typeof value === "string") return value;
  return asObject(value)?.granular === undefined ? null : "granular";
}

function sandboxPolicyName(value: unknown): string | null {
  const policy = asObject(value);
  return typeof policy?.type === "string" ? policy.type : null;
}

function snapshotTurnExecution(thread: Thread, rawTurnId: unknown): void {
  if (typeof rawTurnId !== "string") return;
  const settings = (thread as ProjectedThread).codewide?.executionSettings;
  if (settings === undefined) return;
  metadataForTurn(thread, rawTurnId).execution = {
    model: settings.model,
    effort: settings.effort,
    permissions: settings.permissions,
    modelSource: "settings",
  };
}

function updateReroutedModel(thread: Thread, rawTurnId: unknown, toModel: unknown): void {
  if (typeof rawTurnId !== "string" || typeof toModel !== "string") return;
  const metadata = metadataForTurn(thread, rawTurnId);
  const fallback = (thread as ProjectedThread).codewide?.executionSettings;
  metadata.execution = {
    model: toModel,
    effort: metadata.execution?.effort ?? fallback?.effort ?? null,
    permissions: metadata.execution?.permissions ?? fallback?.permissions ?? null,
    modelSource: "reroute",
  };
}

export function threadContainsClientMessage(thread: Thread, clientId: string): boolean {
  return thread.turns.some((turn) => turn.items.some((item) => item.type === "userMessage" && item.clientId === clientId));
}

function upsertTurn(thread: Thread, value: unknown): void {
  const turn = asObject(value) as Turn | null;
  if (turn === null || typeof turn.id !== "string") return;
  const index = turnIndex(thread, turn.id);
  const nextTurn = mergeTurnMetadata(structuredClone(turn), index === -1 ? undefined : thread.turns[index]);
  const targetIndex = index === -1 ? thread.turns.length : index;
  if (index === -1) thread.turns.push(nextTurn);
  else thread.turns[index] = nextTurn;
  const lookup = eventIndex(thread);
  lookup.turnIndexById.set(nextTurn.id, targetIndex);
  indexTurnItems(lookup, nextTurn);
}

function mergeTurnMetadata(incoming: Turn, cached: Turn | undefined): Turn {
  if (cached !== undefined && cached.items.length > 0) {
    incoming.items = reconcileTurnItems(
      cached.items.map((item) => structuredClone(item)),
      incoming.items,
    );
  }
  const cachedMetadata = cached === undefined ? null : projectedTurnMetadata(cached);
  const incomingMetadata = projectedTurnMetadata(incoming);
  if (cachedMetadata === null) return incoming;
  const projected = incoming as ProjectedTurn;
  projected.codewide = {
    ...structuredClone(cachedMetadata),
    ...(incomingMetadata === null ? {} : structuredClone(incomingMetadata)),
  };
  return projected;
}

function upsertItem(thread: Thread, rawTurnId: unknown, value: unknown): void {
  if (typeof rawTurnId !== "string") return;
  const item = asObject(value) as ThreadItem | null;
  if (item === null || typeof item.id !== "string") return;
  const turn = turnInThread(thread, rawTurnId);
  if (turn === undefined) return;
  const index = itemIndex(thread, rawTurnId, item.id);
  const nextItem = structuredClone(item);
  if (index === -1 && nextItem.type === "userMessage") {
    const placeholderIndex = turn.items.findIndex((candidate) => (
      candidate.type === "userMessage"
      && sameUserBoundary(candidate, nextItem)
    ));
    if (placeholderIndex !== -1) {
      turn.items[placeholderIndex] = preserveProjectedUserClientId(nextItem, turn.items[placeholderIndex]!);
      indexTurnItems(eventIndex(thread), turn);
      return;
    }
  }
  if (index === -1) turn.items.push(nextItem);
  else turn.items[index] = nextItem;
  const lookup = eventIndex(thread);
  removeMatchingAgentPlaceholder(turn, rawTurnId, nextItem.id);
  indexTurnItems(lookup, turn);
}

function itemWithLifecycleMetadata(thread: Thread, rawTurnId: unknown, value: unknown, phase: unknown): unknown {
  const item = asObject(value);
  if (item === null) return value;
  const turn = typeof rawTurnId === "string" ? turnInThread(thread, rawTurnId) : undefined;
  const existing = typeof item.id === "string"
    ? turn?.items.find((candidate) => candidate.id === item.id) as (ThreadItem & { codewidePreTurn?: boolean }) | undefined
    : undefined;
  const preTurn = item.type !== "userMessage" && (
    existing?.codewidePreTurn === true
    || turn?.items.some((candidate) => candidate.type === "userMessage") === false
  );
  return {
    ...item,
    ...(phase === "started" || phase === "completed" ? { codewideLifecyclePhase: phase } : {}),
    ...(preTurn ? { codewidePreTurn: true } : {}),
  };
}

function removeMatchingAgentPlaceholder(turn: Turn, turnId: string, canonicalItemId: string): boolean {
  const placeholderId = `${turnId}:agent`;
  if (canonicalItemId === placeholderId) return false;
  const canonicalItem = turn.items.find((candidate) => candidate.id === canonicalItemId);
  if (canonicalItem?.type !== "agentMessage") return false;
  const placeholderIndex = turn.items.findIndex((candidate) => (
    candidate.type === "agentMessage"
    && candidate.id === placeholderId
    && (candidate.text === canonicalItem.text
      || (candidate.phase === "final_answer" && canonicalItem.phase === "final_answer"))
  ));
  if (placeholderIndex === -1) return false;
  turn.items.splice(placeholderIndex, 1);
  return true;
}

function sameUserBoundary(
  left: Extract<ThreadItem, { type: "userMessage" }>,
  right: Extract<ThreadItem, { type: "userMessage" }>,
): boolean {
  const leftClientId = left.clientId ?? "";
  const rightClientId = right.clientId ?? "";
  return (leftClientId !== "" && leftClientId === rightClientId)
    || userMessageFingerprint(left) === userMessageFingerprint(right);
}

function userMessageFingerprint(item: Extract<ThreadItem, { type: "userMessage" }>): string {
  const text = item.content
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n")
    .trim();
  return text === "" ? JSON.stringify(item.content) : text;
}

function preserveProjectedUserClientId(
  incoming: Extract<ThreadItem, { type: "userMessage" }>,
  cached: ThreadItem,
): Extract<ThreadItem, { type: "userMessage" }> {
  if (cached.type !== "userMessage" || incoming.clientId !== null) return incoming;
  return cached.clientId === null ? incoming : { ...incoming, clientId: cached.clientId };
}

function itemInTurn(thread: Thread, rawTurnId: unknown, rawItemId: unknown): ThreadItem | undefined {
  if (typeof rawTurnId !== "string" || typeof rawItemId !== "string") return undefined;
  const turn = turnInThread(thread, rawTurnId);
  if (turn === undefined) return undefined;
  const index = itemIndex(thread, rawTurnId, rawItemId);
  return index === -1 ? undefined : turn.items[index];
}

function appendText(
  thread: Thread,
  turnId: unknown,
  itemId: unknown,
  delta: unknown,
  kind: "agentMessage" | "plan" | "commandExecution",
): void {
  if (typeof delta !== "string") return;
  const item = itemInTurn(thread, turnId, itemId);
  if (kind === "agentMessage" && item?.type === kind) {
    item.text = appendBoundedText(item.text, delta);
    if (typeof turnId === "string" && typeof itemId === "string") {
      const turn = turnInThread(thread, turnId);
      if (turn !== undefined && removeMatchingAgentPlaceholder(turn, turnId, itemId)) {
        indexTurnItems(eventIndex(thread), turn);
      }
    }
  }
  else if (kind === "plan" && item?.type === kind) item.text = appendBoundedText(item.text, delta);
  else if (kind === "commandExecution" && item?.type === kind) item.aggregatedOutput = appendBoundedText(item.aggregatedOutput ?? "", delta);
}

function updateFileChanges(thread: Thread, turnId: unknown, itemId: unknown, changes: unknown): void {
  const item = itemInTurn(thread, turnId, itemId);
  if (item?.type === "fileChange" && Array.isArray(changes)) item.changes = changes as typeof item.changes;
}

function appendMcpProgress(thread: Thread, turnId: unknown, itemId: unknown, message: unknown): void {
  if (typeof message !== "string" || message.length === 0) return;
  const item = itemInTurn(thread, turnId, itemId);
  if (item?.type !== "mcpToolCall") return;
  const extended = item as typeof item & { progress?: string[] };
  const progress = Array.isArray(extended.progress)
    ? extended.progress.filter((entry): entry is string => typeof entry === "string")
    : [];
  const bounded = message.slice(0, 4_096);
  if (progress.at(-1) !== bounded) progress.push(bounded);
  extended.progress = progress.slice(-100);
}

function updateTurnUsage(thread: Thread, turnId: unknown, usage: unknown): void {
  if (!isTurnUsageProjection(usage)) return;
  metadataForTurn(thread, turnId).usage = structuredClone(usage);
}

function isTurnUsageProjection(value: unknown): value is TurnUsageProjection {
  const projection = asObject(value);
  const turn = asObject(projection?.turn);
  const thread = asObject(projection?.thread);
  return projection?.version === 1
    && (projection.status === "live" || projection.status === "final")
    && asObject(turn?.tokens) !== null
    && asObject(thread?.tokens) !== null;
}

function updateTurnDiff(thread: Thread, turnId: unknown, diff: unknown): void {
  if (typeof diff !== "string") return;
  metadataForTurn(thread, turnId).diff = boundedText(diff);
}

function updateTurnPlan(thread: Thread, turnId: unknown, explanation: unknown, plan: unknown): void {
  if (!Array.isArray(plan)) return;
  const steps = plan.filter((step): step is TurnPlanStep => {
    const value = asObject(step);
    return typeof value?.step === "string" && (value.status === "pending" || value.status === "inProgress" || value.status === "completed");
  });
  metadataForTurn(thread, turnId).plan = {
    explanation: typeof explanation === "string" ? boundedText(explanation) : null,
    steps: structuredClone(steps.map((step) => ({ ...step, step: boundedText(step.step) }))),
  };
}

function metadataForTurn(thread: Thread, rawTurnId: unknown): ProjectedTurnMetadata {
  if (typeof rawTurnId !== "string") return {};
  const turn = turnInThread(thread, rawTurnId) as ProjectedTurn | undefined;
  if (turn === undefined) return {};
  turn.codewide ??= {};
  return turn.codewide;
}

function addReasoningPart(
  thread: Thread,
  turnId: unknown,
  itemId: unknown,
  index: unknown,
  field: "summary" | "content",
): void {
  const item = itemInTurn(thread, turnId, itemId);
  if (item?.type !== "reasoning" || !Number.isSafeInteger(index) || (index as number) < 0) return;
  while (item[field].length <= (index as number)) item[field].push("");
}

function appendReasoning(
  thread: Thread,
  turnId: unknown,
  itemId: unknown,
  index: unknown,
  delta: unknown,
  field: "summary" | "content",
): void {
  if (typeof delta !== "string") return;
  const item = itemInTurn(thread, turnId, itemId);
  if (item?.type !== "reasoning" || !Number.isSafeInteger(index) || (index as number) < 0) return;
  addReasoningPart(thread, turnId, itemId, index, field);
  item[field][index as number] = appendBoundedText(item[field][index as number] ?? "", delta);
}

function appendBoundedText(current: string, delta: string): string {
  return boundedText(`${current}${delta}`);
}

function boundedText(value: string): string {
  if (value.length <= MAX_LIVE_FIELD_CHARS) return value;
  const tailChars = MAX_LIVE_FIELD_CHARS - LIVE_HEAD_CHARS - LIVE_TRUNCATION_MARKER.length;
  return `${value.slice(0, LIVE_HEAD_CHARS)}${LIVE_TRUNCATION_MARKER}${value.slice(-Math.max(0, tailChars))}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function eventIndex(thread: Thread): ThreadEventIndex {
  const existing = threadEventIndexes.get(thread);
  if (existing !== undefined && existing.turns === thread.turns) return existing;
  const created = buildEventIndex(thread.turns);
  threadEventIndexes.set(thread, created);
  return created;
}

function buildEventIndex(turns: Thread["turns"]): ThreadEventIndex {
  const lookup: ThreadEventIndex = {
    turns,
    turnIndexById: new Map(),
    itemIndexByTurnId: new Map(),
    itemArraysByTurnId: new Map(),
  };
  turns.forEach((turn, index) => {
    lookup.turnIndexById.set(turn.id, index);
    indexTurnItems(lookup, turn);
  });
  return lookup;
}

function cloneEventIndex(source: ThreadEventIndex, turns: Thread["turns"]): ThreadEventIndex {
  return {
    turns,
    turnIndexById: new Map(source.turnIndexById),
    itemIndexByTurnId: new Map(source.itemIndexByTurnId),
    itemArraysByTurnId: new Map(source.itemArraysByTurnId),
  };
}

function indexTurnItems(lookup: ThreadEventIndex, turn: Turn): void {
  lookup.itemArraysByTurnId.set(turn.id, turn.items);
  lookup.itemIndexByTurnId.set(turn.id, new Map(turn.items.map((item, index) => [item.id, index])));
}

function turnIndex(thread: Thread, turnId: string): number {
  const lookup = eventIndex(thread);
  const index = lookup.turnIndexById.get(turnId);
  if (index !== undefined && thread.turns[index]?.id === turnId) return index;
  const recovered = thread.turns.findIndex((turn) => turn.id === turnId);
  if (recovered !== -1) lookup.turnIndexById.set(turnId, recovered);
  return recovered;
}

function turnInThread(thread: Thread, turnId: string): Turn | undefined {
  const index = turnIndex(thread, turnId);
  return index === -1 ? undefined : thread.turns[index];
}

function itemIndex(thread: Thread, turnId: string, itemId: string): number {
  const turn = turnInThread(thread, turnId);
  if (turn === undefined) return -1;
  const lookup = eventIndex(thread);
  if (lookup.itemArraysByTurnId.get(turnId) !== turn.items) indexTurnItems(lookup, turn);
  const indexes = lookup.itemIndexByTurnId.get(turnId);
  const index = indexes?.get(itemId);
  if (index !== undefined && turn.items[index]?.id === itemId) return index;
  const recovered = turn.items.findIndex((item) => item.id === itemId);
  if (recovered !== -1) indexes?.set(itemId, recovered);
  return recovered;
}
