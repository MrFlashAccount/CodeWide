import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { projectedTurnMetadata, reconcileActiveTurnItems } from "@codewide/sync-client";

import { isThreadHistorySourceWitness } from "./thread-history-source-witness";

type ThreadSyncHistory = {
  hasMore: boolean;
  headTurnId: string | null;
  kind: "current" | "delta" | "reset";
  olderCursor: string | null;
  sourceWitness?: string;
  turns: Turn[];
};

export type ThreadSyncResponse = {
  activeTurn: Turn | null;
  history: ThreadSyncHistory;
  readModelVersion: 3;
  thread: Thread;
  throughCursor: number;
};

export type MaterializedThreadSync = {
  historyCursor: string | null | undefined;
  thread: Thread;
};

/** Carries source reset and cursor state across all pages of one catch-up. */
export class ThreadSyncCatchUp {
  #thread: Thread | null;
  #historyCursor: string | null | undefined;
  #reset = false;
  sourceWitness: string | undefined;

  constructor(
    cached: Thread | null,
    historyCursor: string | null | undefined,
    sourceWitness: string | undefined,
  ) {
    this.#thread = cached;
    this.#historyCursor = historyCursor;
    this.sourceWitness = sourceWitness;
  }

  get mode(): "reset" | "merge" {
    return this.#reset ? "reset" : "merge";
  }

  accept(response: ThreadSyncResponse): MaterializedThreadSync {
    const next = materializeThreadSync(this.#thread, response, this.#historyCursor);
    this.#thread = next.thread;
    this.#historyCursor = next.historyCursor;
    this.#reset ||= response.history.kind === "reset";
    this.sourceWitness = response.history.sourceWitness;
    return next;
  }
}

export type ThreadContentReference = {
  readonly byteLength: number;
  readonly contentType: string;
  readonly id: string;
};

// Recovery and bounded projections can retain turn metadata after the item
// payload was evicted. This compatibility shape is valid only inside
// Conversation synchronization.
type MetadataOnlyTurnEnvelope = Omit<Turn, "items" | "itemsView"> & {
  codewideContent?: unknown;
  items?: undefined;
  itemsView?: Turn["itemsView"];
};

export function parseThreadSyncResponse(value: unknown): ThreadSyncResponse {
  const response = isRecord(value) ? value : null;
  const thread = isRecord(response?.thread) ? response.thread : null;
  const history = isRecord(response?.history) ? response.history : null;
  if (response === null || history === null) {
    throw new Error("Companion thread sync returned an invalid response");
  }
  const kind = history.kind;
  const turns = parseHistoryTurns(history.turns);
  const activeTurn = parseActiveTurn(response.activeTurn);
  if (
    response.readModelVersion !== 3 ||
    typeof response.throughCursor !== "number" ||
    !Number.isSafeInteger(response.throughCursor) ||
    response.throughCursor < 0 ||
    !isThread(thread) ||
    (kind !== "current" && kind !== "delta" && kind !== "reset") ||
    turns === null ||
    typeof history.hasMore !== "boolean" ||
    (history.headTurnId !== null && typeof history.headTurnId !== "string") ||
    (history.olderCursor !== null && typeof history.olderCursor !== "string") ||
    (history.sourceWitness !== undefined && !isThreadHistorySourceWitness(history.sourceWitness)) ||
    activeTurn === undefined
  ) {
    throw new Error("Companion thread sync returned an invalid response");
  }
  return {
    activeTurn,
    history: {
      hasMore: history.hasMore,
      headTurnId: history.headTurnId,
      kind,
      olderCursor: history.olderCursor,
      turns,
      ...(history.sourceWitness === undefined ? {} : { sourceWitness: history.sourceWitness }),
    },
    readModelVersion: 3,
    thread,
    throughCursor: response.throughCursor,
  };
}

type ThreadSyncLaneState<Result> = {
  followUp: Promise<Result> | null;
  readonly promise: Promise<Result>;
};

/** Serializes per-thread snapshots without extending a reader's completion to later updates. */
export class ThreadSyncLane<Result> {
  readonly #states = new Map<string, ThreadSyncLaneState<Result>>();

  /** Invalidation/foreground callers need a new read; ordinary readers can share the current one. */
  // WHY: Coalesced readers must receive the exact same Promise; async would wrap the lane Promise.
  // oxlint-disable-next-line typescript/promise-function-async
  run(
    key: string,
    synchronize: () => Promise<Result>,
    freshness: "inFlight" | "afterCurrent" = "inFlight",
  ): Promise<Result> {
    const existing = this.#states.get(key);
    if (existing !== undefined) {
      if (freshness === "inFlight") {
        return existing.promise;
      }
      if (existing.followUp === null) {
        // WHY: Both settlement branches must return the next lane Promise without wrapping it.
        // oxlint-disable-next-line typescript/promise-function-async
        const startNext = (): Promise<Result> => this.run(key, synchronize);
        // Both outcomes release this lane. A failed old connection must not
        // suppress a fresh read requested after foregrounding/reconnection.
        existing.followUp = existing.promise.then(startNext, startNext);
      }
      return existing.followUp;
    }
    const operation = (async (): Promise<Result> => synchronize())().finally(() => {
      if (this.#states.get(key) === state) {
        this.#states.delete(key);
      }
    });
    const state: ThreadSyncLaneState<Result> = { followUp: null, promise: operation };
    this.#states.set(key, state);
    return operation;
  }
}

export function materializeThreadSync(
  cached: Thread | null,
  response: ThreadSyncResponse,
  currentHistoryCursor: string | null | undefined,
): MaterializedThreadSync {
  const sealed =
    response.history.kind === "reset"
      ? []
      : (cached?.turns ?? []).filter(({ status }) => status !== "inProgress");
  const byId = new Map<string, Turn>();
  for (const turn of sealed) {
    byId.set(turn.id, turn);
  }
  for (const turn of response.history.turns) {
    byId.set(turn.id, turn);
  }
  const turns = [...byId.values()];
  const activeTurn = mergeActiveTurnCheckpoint(
    response.history.kind === "reset" ? null : cached,
    response.activeTurn,
  );
  if (activeTurn !== null) {
    turns.push(activeTurn);
  }
  return {
    historyCursor:
      response.history.kind === "reset" ? response.history.olderCursor : currentHistoryCursor,
    thread: { ...response.thread, turns },
  };
}

/** Resolves only the active agent text externalized by the bounded wire view. */
export async function hydrateThreadSyncActiveText(
  response: ThreadSyncResponse,
  read: (reference: ThreadContentReference) => Promise<string>,
): Promise<ThreadSyncResponse> {
  const activeTurn = response.activeTurn;
  if (activeTurn === null) {
    return response;
  }
  let changed = false;
  const items = await Promise.all(
    activeTurn.items.map(async (item) => {
      if (item.type !== "agentMessage") {
        return item;
      }
      const reference = projectedContentField(item, "/text");
      if (reference === null) {
        return item;
      }
      const text = await read(reference);
      changed = changed || text !== item.text;
      return text === item.text ? item : { ...item, text };
    }),
  );
  // WHY: Each async item projection may flip this flag after an awaited content read; TypeScript keeps its pre-callback literal narrowing.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return changed ? { ...response, activeTurn: { ...activeTurn, items } } : response;
}

/**
 * The server's active-turn summary is a recovery checkpoint, not a replacement
 * for richer item patches already committed from the durable live stream.
 */
function mergeActiveTurnCheckpoint(cached: Thread | null, checkpoint: Turn | null): Turn | null {
  if (checkpoint === null) {
    return null;
  }
  const previous = cached?.turns.find(
    (turn) => turn.id === checkpoint.id && turn.status === "inProgress",
  );
  if (previous === undefined || previous.itemsView === "notLoaded") {
    return checkpoint;
  }

  const items = reconcileActiveTurnItems(previous.items, checkpoint.items);

  const previousMetadata = projectedTurnMetadata(previous);
  const checkpointMetadata = projectedTurnMetadata(checkpoint);
  const codewide =
    previousMetadata === null && checkpointMetadata === null
      ? {}
      : {
          codewide: {
            ...previousMetadata,
            ...checkpointMetadata,
          },
        };

  return {
    ...previous,
    ...checkpoint,
    ...codewide,
    items,
    itemsView:
      previous.itemsView === "full" || checkpoint.itemsView === "notLoaded"
        ? previous.itemsView
        : checkpoint.itemsView,
  };
}

export function assertThreadSyncReachedHead(
  response: ThreadSyncResponse,
  requestedAfterTurnId: string | null,
): void {
  if (response.history.hasMore) {
    return;
  }
  const lastTurnId = response.history.turns.at(-1)?.id;
  const reachedTurnId =
    response.history.kind === "reset" ? (lastTurnId ?? null) : (lastTurnId ?? requestedAfterTurnId);
  if (reachedTurnId !== response.history.headTurnId) {
    throw new Error("Companion thread sync ended before its advertised history head");
  }
}

export function latestSealedTurnId(turns: readonly Turn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn !== undefined && isStableThreadCursorTurn(turn)) {
      return turn.id;
    }
  }
  return null;
}

/**
 * A cursor is a promise that every earlier immutable row is complete. Failed
 * and interrupted turns are terminal by definition. A nominally completed turn
 * is safe from a live projection only after it contains an explicit final
 * answer. Authoritative history pages may seal unphased responses at
 * the storage boundary; an unwitnessed live completion must still be repaired.
 */
function isStableThreadCursorTurn(turn: Turn): boolean {
  if (turn.status === "inProgress") {
    return false;
  }
  if (turn.status !== "completed") {
    return true;
  }
  return turn.items.some(
    (item) =>
      item.type === "agentMessage" && item.phase === "final_answer" && item.text.trim() !== "",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectedContentField(value: unknown, pointer: string): ThreadContentReference | null {
  const object = isRecord(value) ? value : null;
  const content = isRecord(object?.codewideContent) ? object.codewideContent : null;
  const fields = isRecord(content?.fields) ? content.fields : null;
  const reference = isRecord(fields?.[pointer]) ? fields[pointer] : null;
  return typeof reference?.id === "string" &&
    /^[a-f0-9]{64}$/u.test(reference.id) &&
    typeof reference.byteLength === "number" &&
    Number.isSafeInteger(reference.byteLength) &&
    reference.byteLength >= 0 &&
    typeof reference.contentType === "string"
    ? {
        byteLength: reference.byteLength,
        contentType: reference.contentType,
        id: reference.id,
      }
    : null;
}

export function isThread(value: unknown): value is Thread {
  const thread = isRecord(value) ? value : null;
  return (
    thread !== null &&
    typeof thread.id === "string" &&
    typeof thread.cwd === "string" &&
    Array.isArray(thread.turns) &&
    thread.turns.every(isTurn) &&
    isRecord(thread.status)
  );
}

function isTurn(value: unknown): value is Turn {
  const turn = isRecord(value) ? value : null;
  return (
    turn !== null &&
    typeof turn.id === "string" &&
    typeof turn.status === "string" &&
    Array.isArray(turn.items)
  );
}

function isMetadataOnlyTurnEnvelope(value: unknown): value is MetadataOnlyTurnEnvelope {
  const turn = isRecord(value) ? value : null;
  return (
    turn !== null &&
    typeof turn.id === "string" &&
    typeof turn.status === "string" &&
    turn.items === undefined
  );
}

function isContentBackedMetadataOnlyTurnEnvelope(
  value: unknown,
): value is MetadataOnlyTurnEnvelope & {
  codewideContent: {
    fields: Record<string, unknown>;
    version: 1;
    whole: {
      byteLength: number;
      contentType: string;
      id: string;
    };
  };
} {
  if (!isMetadataOnlyTurnEnvelope(value)) {
    return false;
  }
  const content = isRecord(value.codewideContent) ? value.codewideContent : null;
  const whole = isRecord(content?.whole) ? content.whole : null;
  return (
    content?.version === 1 &&
    isRecord(content.fields) &&
    whole !== null &&
    typeof whole.id === "string" &&
    typeof whole.byteLength === "number" &&
    Number.isSafeInteger(whole.byteLength) &&
    whole.byteLength >= 0 &&
    typeof whole.contentType === "string"
  );
}

function parseActiveTurn(value: unknown): Turn | null | undefined {
  if (value === null) {
    return null;
  }
  if (isTurn(value)) {
    return value;
  }
  if (isContentBackedMetadataOnlyTurnEnvelope(value)) {
    return { ...value, items: [], itemsView: "notLoaded" };
  }
  return undefined;
}

/** Validates summary/full turn envelopes shared by cursor sync and historical search. */
export function parseHistoryTurns(value: unknown): Turn[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const turns: Turn[] = [];
  for (const turn of value) {
    if (isTurn(turn)) {
      turns.push(turn);
    } else if (isMetadataOnlyTurnEnvelope(turn)) {
      turns.push({ ...turn, items: [], itemsView: "notLoaded" });
    } else {
      return null;
    }
  }
  return turns;
}
