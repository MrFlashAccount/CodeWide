import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

export type ThreadSyncHistory = {
  kind: "current" | "delta" | "reset";
  headTurnId: string | null;
  turns: Turn[];
  hasMore: boolean;
  olderCursor: string | null;
};

export type ThreadSyncResponse = {
  readModelVersion: 2;
  thread: Thread;
  history: ThreadSyncHistory;
  activeTurn: Turn | null;
};

export type MaterializedThreadSync = {
  thread: Thread;
  historyCursor: string | null;
};

// Recovery and bounded projections can retain turn metadata after the item
// payload was evicted. This compatibility shape is valid only inside
// Conversation synchronization.
type MetadataOnlyTurnEnvelope = Omit<Turn, "items" | "itemsView"> & {
  items?: undefined;
  itemsView?: Turn["itemsView"];
  codewideContent?: unknown;
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
    response?.readModelVersion !== 2
    || !isThread(thread)
    || (kind !== "current" && kind !== "delta" && kind !== "reset")
    || turns === null
    || typeof history.hasMore !== "boolean"
    || (history.headTurnId !== null && typeof history.headTurnId !== "string")
    || (history.olderCursor !== null && typeof history.olderCursor !== "string")
    || activeTurn === undefined
  ) {
    throw new Error("Companion thread sync returned an invalid response");
  }
  return {
    readModelVersion: 2,
    thread,
    history: {
      kind,
      headTurnId: history.headTurnId,
      turns,
      hasMore: history.hasMore,
      olderCursor: history.olderCursor,
    },
    activeTurn,
  };
}

type ThreadSyncLaneState<Result> = {
  dirty: boolean;
  promise: Promise<Result> | null;
};

export class ThreadSyncLane<Result> {
  readonly #states = new Map<string, ThreadSyncLaneState<Result>>();

  run(key: string, synchronize: () => Promise<Result>): Promise<Result> {
    const existing = this.#states.get(key);
    if (existing?.promise !== null && existing?.promise !== undefined) {
      return existing.promise;
    }
    const state: ThreadSyncLaneState<Result> = {
      dirty: false,
      promise: null,
    };
    const operation = (async (): Promise<Result> => {
      let result: Result;
      do {
        state.dirty = false;
        result = await synchronize();
      } while (state.dirty);
      return result;
    })().finally(() => {
      if (this.#states.get(key) === state) this.#states.delete(key);
    });
    state.promise = operation;
    this.#states.set(key, state);
    return operation;
  }

  markDirty(key: string): boolean {
    const state = this.#states.get(key);
    if (state === undefined) return false;
    state.dirty = true;
    return true;
  }
}

export function materializeThreadSync(
  cached: Thread | null,
  response: ThreadSyncResponse,
  currentHistoryCursor: string | null,
): MaterializedThreadSync {
  if (response.readModelVersion !== 2) {
    throw new Error(`Unsupported companion thread read model: ${String(response.readModelVersion)}`);
  }
  if (!Array.isArray(response.thread.turns) || !Array.isArray(response.history.turns)) {
    throw new Error("Companion thread sync returned an invalid turn collection");
  }
  const sealed = response.history.kind === "reset"
    ? []
    : (cached?.turns ?? []).filter(({ status }) => status !== "inProgress");
  const byId = new Map<string, Turn>();
  for (const turn of sealed) byId.set(turn.id, turn);
  for (const turn of response.history.turns) byId.set(turn.id, turn);
  const turns = [...byId.values()];
  if (response.activeTurn !== null) turns.push(response.activeTurn);
  return {
    thread: { ...response.thread, turns },
    historyCursor: response.history.kind === "reset"
      ? response.history.olderCursor
      : currentHistoryCursor,
  };
}

export function assertThreadSyncReachedHead(
  response: ThreadSyncResponse,
  requestedAfterTurnId: string | null,
): void {
  if (response.history.hasMore) return;
  const lastTurnId = response.history.turns.at(-1)?.id;
  const reachedTurnId = response.history.kind === "reset"
    ? lastTurnId ?? null
    : lastTurnId ?? requestedAfterTurnId;
  if (reachedTurnId !== response.history.headTurnId) {
    throw new Error("Companion thread sync ended before its advertised history head");
  }
}

export function latestSealedTurnId(turns: readonly Turn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn !== undefined && isStableThreadCursorTurn(turn)) return turn.id;
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
export function isStableThreadCursorTurn(turn: Turn): boolean {
  if (turn.status === "inProgress") return false;
  if (turn.status !== "completed") return true;
  return turn.items.some((item) => item.type === "agentMessage"
    && item.phase === "final_answer"
    && item.text.trim() !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isThread(value: unknown): value is Thread {
  const thread = isRecord(value) ? value : null;
  return thread !== null
    && typeof thread.id === "string"
    && typeof thread.cwd === "string"
    && Array.isArray(thread.turns)
    && thread.turns.every(isTurn)
    && isRecord(thread.status);
}

function isTurn(value: unknown): value is Turn {
  const turn = isRecord(value) ? value : null;
  return turn !== null
    && typeof turn.id === "string"
    && typeof turn.status === "string"
    && Array.isArray(turn.items);
}

function isMetadataOnlyTurnEnvelope(value: unknown): value is MetadataOnlyTurnEnvelope {
  const turn = isRecord(value) ? value : null;
  return turn !== null
    && typeof turn.id === "string"
    && typeof turn.status === "string"
    && turn.items === undefined;
}

function isContentBackedMetadataOnlyTurnEnvelope(
  value: unknown,
): value is MetadataOnlyTurnEnvelope & {
  codewideContent: {
    version: 1;
    fields: Record<string, unknown>;
    whole: {
      id: string;
      byteLength: number;
      contentType: string;
    };
  };
} {
  if (!isMetadataOnlyTurnEnvelope(value)) return false;
  const content = isRecord(value.codewideContent) ? value.codewideContent : null;
  const whole = isRecord(content?.whole) ? content.whole : null;
  return content?.version === 1
    && isRecord(content.fields)
    && whole !== null
    && typeof whole.id === "string"
    && typeof whole.byteLength === "number"
    && Number.isSafeInteger(whole.byteLength)
    && whole.byteLength >= 0
    && typeof whole.contentType === "string";
}

function parseActiveTurn(value: unknown): Turn | null | undefined {
  if (value === null) return null;
  if (isTurn(value)) return value;
  if (isContentBackedMetadataOnlyTurnEnvelope(value)) {
    return { ...value, items: [], itemsView: "notLoaded" };
  }
  return undefined;
}

function parseHistoryTurns(value: unknown): Turn[] | null {
  if (!Array.isArray(value)) return null;
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
