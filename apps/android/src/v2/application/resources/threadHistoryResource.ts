import type {
  SyncV2SessionSnapshot,
  V2Query,
  V2QueryResult,
  V2TurnView,
} from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";

export const THREAD_HISTORY_RESIDENT_LIMIT = 36;

export interface ThreadHistorySnapshot {
  canLoadNewer: boolean;
  canLoadOlder: boolean;
  loading: "newer" | "older" | null;
  turns: V2TurnView[];
}

interface ProjectionSnapshot {
  value: SyncV2SessionSnapshot;
}

interface ThreadHistoryProjectionSource {
  snapshot(): ProjectionSnapshot;
  subscribe(listener: () => void): () => void;
}

interface ThreadHistoryResourceInput {
  execute(query: V2Query): Promise<V2QueryResult>;
  source: ThreadHistoryProjectionSource;
  threadId: string;
}

interface ResidentWindow {
  generationId: string | null;
  newerCursor: string | null;
  olderCursor: string | null;
  turns: V2TurnView[];
}

/** Owns the bounded authoritative turn range rendered by one V2 conversation. */
export class ThreadHistoryResource extends ObservableResource<ThreadHistorySnapshot> {
  readonly #execute: ThreadHistoryResourceInput["execute"];
  readonly #source: ThreadHistoryProjectionSource;
  readonly #threadId: string;
  #resident: ResidentWindow;
  #expandedDirection: "newer" | "older" | null = null;
  #unsubscribe: (() => void) | null = null;
  readonly #inFlight = new Map<"newer" | "older", Promise<void>>();
  #subscriberCount = 0;

  constructor(input: ThreadHistoryResourceInput) {
    const resident =
      projectionWindow(input.source.snapshot().value, input.threadId) ?? emptyWindow();
    super(presentation(resident, null));
    this.#execute = input.execute;
    this.#source = input.source;
    this.#threadId = input.threadId;
    this.#resident = resident;
  }

  start(): void {
    this.#unsubscribe ??= this.#source.subscribe(() => this.#synchronize());
    this.#synchronize();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = this.addListener(listener);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.start();
    return () => {
      unsubscribe();
      this.#subscriberCount -= 1;
      if (this.#subscriberCount === 0) this.stop();
    };
  };

  async loadOlder(): Promise<void> {
    await this.#load("older");
  }

  async loadNewer(): Promise<void> {
    await this.#load("newer");
  }

  settle(direction: "newer" | "older"): void {
    if (this.#expandedDirection !== null && this.#expandedDirection !== direction) return;
    this.#expandedDirection = null;
    if (this.#resident.turns.length <= THREAD_HISTORY_RESIDENT_LIMIT) return;
    this.#resident.turns =
      direction === "older"
        ? this.#resident.turns.slice(0, THREAD_HISTORY_RESIDENT_LIMIT)
        : this.#resident.turns.slice(-THREAD_HISTORY_RESIDENT_LIMIT);
    this.publish({ status: "ready", value: presentation(this.#resident, null) });
  }

  async #load(direction: "newer" | "older"): Promise<void> {
    const existing = this.#inFlight.get(direction);
    if (existing !== undefined) return existing;
    if (this.#expandedDirection !== null) this.settle(this.#expandedDirection);
    const cursor = direction === "older" ? this.#resident.olderCursor : this.#resident.newerCursor;
    if (cursor === null) return;
    const generationId = this.#resident.generationId;
    this.publish({ status: "ready", value: presentation(this.#resident, direction) });
    const operation = this.#execute({
      cursor,
      detail: "summary",
      direction,
      kind: "history.page",
      limit: THREAD_HISTORY_RESIDENT_LIMIT,
      threadId: this.#threadId,
    })
      .then((result) => {
        if (
          result.kind !== "history.page" ||
          result.threadId !== this.#threadId ||
          this.#resident.generationId !== generationId
        ) {
          return;
        }
        this.#resident = {
          generationId,
          newerCursor: result.newerCursor,
          olderCursor: result.olderCursor,
          turns:
            direction === "older"
              ? mergeTurns(result.turns, this.#resident.turns)
              : mergeTurns(this.#resident.turns, result.turns),
        };
        this.#expandedDirection = direction;
        this.publish({ status: "ready", value: presentation(this.#resident, null) });
      })
      .catch((cause: unknown) => {
        this.publish({
          message: cause instanceof Error ? cause.message : "Could not load thread history",
          status: "error",
          value: presentation(this.#resident, null),
        });
      })
      .finally(() => {
        this.#inFlight.delete(direction);
      });
    this.#inFlight.set(direction, operation);
    await operation;
  }

  #synchronize(): void {
    const incoming = projectionWindow(this.#source.snapshot().value, this.#threadId);
    if (incoming === null) return;
    if (incoming.generationId !== this.#resident.generationId) {
      this.#resident = incoming;
      this.#expandedDirection = null;
      this.publish({ status: "ready", value: presentation(this.#resident, null) });
      return;
    }
    if (this.#resident.newerCursor !== null) {
      const incomingById = new Map(incoming.turns.map((turn) => [turn.id, turn]));
      let changed = false;
      const turns = this.#resident.turns.map((turn) => {
        const replacement = incomingById.get(turn.id);
        if (replacement === undefined || replacement === turn) return turn;
        changed = true;
        return replacement;
      });
      if (!changed) return;
      this.#resident.turns = turns;
      this.publish({ status: "ready", value: presentation(this.#resident, null) });
      return;
    }
    this.#resident = {
      generationId: incoming.generationId,
      newerCursor: incoming.newerCursor,
      olderCursor: incoming.olderCursor,
      turns: mergeTurns(this.#resident.turns, incoming.turns).slice(-THREAD_HISTORY_RESIDENT_LIMIT),
    };
    this.publish({ status: "ready", value: presentation(this.#resident, null) });
  }
}

function emptyWindow(): ResidentWindow {
  return {
    generationId: null,
    newerCursor: null,
    olderCursor: null,
    turns: [],
  };
}

function projectionWindow(
  snapshot: SyncV2SessionSnapshot,
  threadId: string,
): ResidentWindow | null {
  const projection = snapshot.projections.live ?? snapshot.projections.retained;
  const window = projection?.currentThread;
  if (projection === null || projection === undefined || window?.thread.id !== threadId)
    return null;
  return {
    generationId: projection.generationId,
    newerCursor: window.newerCursor,
    olderCursor: window.olderCursor,
    turns: window.turns,
  };
}

function presentation(
  window: ResidentWindow,
  loading: ThreadHistorySnapshot["loading"],
): ThreadHistorySnapshot {
  return {
    canLoadNewer: window.newerCursor !== null,
    canLoadOlder: window.olderCursor !== null,
    loading,
    turns: window.turns,
  };
}

function mergeTurns(first: V2TurnView[], second: V2TurnView[]): V2TurnView[] {
  const turns = new Map<string, V2TurnView>();
  for (const turn of first) turns.set(turn.id, turn);
  for (const turn of second) turns.set(turn.id, turn);
  return [...turns.values()];
}
