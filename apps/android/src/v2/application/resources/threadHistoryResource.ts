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
  restoreCursor: ThreadHistoryRestoreCursor | null;
  turns: V2TurnView[];
}

export interface ThreadHistoryRestoreCursor {
  cursor: string;
  direction: "newer" | "older";
  generationId: string;
}

export interface ThreadHistorySearchSeed {
  generationId: string | null;
  newerCursor: string | null;
  olderCursor: string | null;
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
  restoreCursor?: ThreadHistoryRestoreCursor | null;
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
  #restoreCursor: ThreadHistoryRestoreCursor | null = null;
  readonly #restoreCursorsByTurnId = new Map<string, ThreadHistoryRestoreCursor>();
  #restoreRequest: ThreadHistoryRestoreCursor | null;
  #unsubscribe: (() => void) | null = null;
  readonly #inFlight = new Map<"newer" | "older", Promise<void>>();
  #subscriberCount = 0;

  constructor(input: ThreadHistoryResourceInput) {
    const resident =
      projectionWindow(input.source.snapshot().value, input.threadId) ?? emptyWindow();
    super(presentation(resident, null));
    this.#execute = input.execute;
    this.#restoreRequest = input.restoreCursor ?? null;
    this.#source = input.source;
    this.#threadId = input.threadId;
    this.#resident = resident;
  }

  start(): void {
    this.#unsubscribe ??= this.#source.subscribe(() => this.#synchronize());
    this.#synchronize();
    this.#restore().catch(() => undefined);
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  override subscribe = (listener: () => void): (() => void) => {
    const subscription = (): void => listener();
    const unsubscribe = this.addListener(subscription);
    let subscribed = true;
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.start();
    return () => {
      if (!subscribed) return;
      subscribed = false;
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

  /** Exposes the current bounded range and its server cursors to independent readers such as search. */
  searchSeed(): ThreadHistorySearchSeed {
    return {
      generationId: this.#resident.generationId,
      newerCursor: this.#resident.newerCursor,
      olderCursor: this.#resident.olderCursor,
      turns: this.#resident.turns,
    };
  }

  /** Returns the opaque bounded-page cursor that can restore a specific resident turn. */
  restoreCursorFor(turnId: string): ThreadHistoryRestoreCursor | null {
    return this.#restoreCursorsByTurnId.get(turnId) ?? null;
  }

  /** Replaces any historical range with the already-materialized authoritative tail. */
  jumpToLatest(): string | null {
    const incoming = projectionWindow(this.#source.snapshot().value, this.#threadId);
    if (incoming === null) throw new Error("Authoritative thread tail is unavailable");
    this.#resident = incoming;
    this.#expandedDirection = null;
    this.#restoreCursor = null;
    this.#restoreCursorsByTurnId.clear();
    this.#inFlight.clear();
    this.#publishReady();
    return incoming.turns.at(-1)?.id ?? null;
  }

  settle(direction: "newer" | "older"): void {
    if (this.#expandedDirection !== null && this.#expandedDirection !== direction) return;
    this.#expandedDirection = null;
    if (this.#resident.turns.length <= THREAD_HISTORY_RESIDENT_LIMIT) return;
    this.#resident.turns =
      direction === "older"
        ? this.#resident.turns.slice(0, THREAD_HISTORY_RESIDENT_LIMIT)
        : this.#resident.turns.slice(-THREAD_HISTORY_RESIDENT_LIMIT);
    this.#retainResidentRestoreCursors();
    this.#publishReady();
  }

  async #load(direction: "newer" | "older"): Promise<void> {
    const existing = this.#inFlight.get(direction);
    if (existing !== undefined) return existing;
    if (this.#expandedDirection !== null) this.settle(this.#expandedDirection);
    const cursor = direction === "older" ? this.#resident.olderCursor : this.#resident.newerCursor;
    if (cursor === null) return;
    const residentAtStart = this.#resident;
    const generationId = residentAtStart.generationId;
    this.publish({ status: "ready", value: this.#presentation(direction) });
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
          this.#resident !== residentAtStart ||
          residentAtStart.generationId !== generationId
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
        this.#recordRestoreCursors({
          cursor,
          direction,
          generationId,
          previous: residentAtStart,
          result,
        });
        this.#expandedDirection = direction;
        this.#publishReady();
      })
      .catch((cause: unknown) => {
        if (this.#resident !== residentAtStart) return;
        this.publish({
          message: cause instanceof Error ? cause.message : "Could not load thread history",
          status: "error",
          value: this.#presentation(null),
        });
        throw cause;
      })
      .finally(() => {
        if (this.#inFlight.get(direction) === operation) this.#inFlight.delete(direction);
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
      this.#restoreCursor = null;
      this.#restoreCursorsByTurnId.clear();
      this.#restoreRequest = null;
      this.#inFlight.clear();
      this.#publishReady();
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
      this.#publishReady();
      return;
    }
    this.#resident.generationId = incoming.generationId;
    this.#resident.newerCursor = incoming.newerCursor;
    this.#resident.olderCursor = incoming.olderCursor;
    this.#resident.turns = mergeTurns(this.#resident.turns, incoming.turns).slice(
      -THREAD_HISTORY_RESIDENT_LIMIT,
    );
    this.#restoreCursor = null;
    this.#restoreCursorsByTurnId.clear();
    this.#publishReady();
  }

  async #restore(): Promise<void> {
    const request = this.#restoreRequest;
    this.#restoreRequest = null;
    if (
      request === null ||
      request.generationId !== this.#resident.generationId ||
      this.#inFlight.size > 0
    ) {
      return;
    }
    this.publish({ status: "ready", value: this.#presentation(request.direction) });
    try {
      const result = await this.#execute({
        cursor: request.cursor,
        detail: "summary",
        direction: request.direction,
        kind: "history.page",
        limit: THREAD_HISTORY_RESIDENT_LIMIT,
        threadId: this.#threadId,
      });
      if (
        result.kind !== "history.page" ||
        result.threadId !== this.#threadId ||
        request.generationId !== this.#resident.generationId
      ) {
        return;
      }
      this.#resident = {
        generationId: request.generationId,
        newerCursor: result.newerCursor,
        olderCursor: result.olderCursor,
        turns: result.turns,
      };
      this.#restoreCursor = request;
      this.#restoreCursorsByTurnId.clear();
      for (const turn of result.turns) this.#restoreCursorsByTurnId.set(turn.id, request);
      this.#publishReady();
    } catch (cause: unknown) {
      this.publish({
        message: cause instanceof Error ? cause.message : "Could not restore thread history",
        status: "error",
        value: this.#presentation(null),
      });
    }
  }

  #presentation(loading: ThreadHistorySnapshot["loading"]): ThreadHistorySnapshot {
    return presentation(this.#resident, loading, this.#restoreCursor);
  }

  #publishReady(): void {
    this.publish({ status: "ready", value: this.#presentation(null) });
  }

  #recordRestoreCursors(input: RecordRestoreCursorsInput): void {
    if (input.generationId === null) {
      this.#restoreCursor = null;
      this.#restoreCursorsByTurnId.clear();
      return;
    }
    const fetched = {
      cursor: input.cursor,
      direction: input.direction,
      generationId: input.generationId,
    };
    const previousCursor = previousPageCursor(input);
    if (previousCursor !== null) {
      for (const turn of input.previous.turns) {
        if (!this.#restoreCursorsByTurnId.has(turn.id)) {
          this.#restoreCursorsByTurnId.set(turn.id, previousCursor);
        }
      }
    }
    for (const turn of input.result.turns) this.#restoreCursorsByTurnId.set(turn.id, fetched);
    this.#restoreCursor = fetched;
  }

  #retainResidentRestoreCursors(): void {
    const residentIds = new Set(this.#resident.turns.map((turn) => turn.id));
    for (const turnId of this.#restoreCursorsByTurnId.keys()) {
      if (!residentIds.has(turnId)) this.#restoreCursorsByTurnId.delete(turnId);
    }
  }
}

interface RecordRestoreCursorsInput {
  cursor: string;
  direction: "newer" | "older";
  generationId: string | null;
  previous: ResidentWindow;
  result: Extract<V2QueryResult, { kind: "history.page" }>;
}

function previousPageCursor(input: RecordRestoreCursorsInput): ThreadHistoryRestoreCursor | null {
  if (input.generationId === null) return null;
  const cursor = input.direction === "older" ? input.result.newerCursor : input.result.olderCursor;
  if (cursor === null) return null;
  return {
    cursor,
    direction: input.direction === "older" ? "newer" : "older",
    generationId: input.generationId,
  };
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
  restoreCursor: ThreadHistoryRestoreCursor | null = null,
): ThreadHistorySnapshot {
  return {
    canLoadNewer: window.newerCursor !== null,
    canLoadOlder: window.olderCursor !== null,
    loading,
    restoreCursor,
    turns: window.turns,
  };
}

function mergeTurns(first: V2TurnView[], second: V2TurnView[]): V2TurnView[] {
  const turns = new Map<string, V2TurnView>();
  for (const turn of first) turns.set(turn.id, turn);
  for (const turn of second) turns.set(turn.id, turn);
  return [...turns.values()];
}
