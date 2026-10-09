/**
 * The threads the host keeps metadata for: one entry per thread with its
 * `ThreadState` and live `ClaudeSession`. Owns state persistence, the
 * session-id → thread index of every session chain, and the restart rule
 * that finalizes a turn a previous process left in progress.
 */

import type { AgentEvent, AgentThread, AgentTurn } from "../protocol.js";
import { asAppThreadId } from "../protocol.js";
import type { Logger } from "../log.js";
import { failOpenItem } from "../mapping/tools.js";
import type { ThreadStateStore } from "../state/stateStore.js";
import { withTurnRecord, type ThreadState, type TurnOutcomeRecord } from "../state/threadState.js";
import { ClaudeSession, type SessionDeps } from "./session.js";

export interface ThreadEntry {
  readonly session: ClaudeSession;
  state: ThreadState;
}

/** What the registry needs from the thread service for each session. */
export interface EntryHooks {
  readonly historyLines: (entry: ThreadEntry) => Promise<readonly string[]>;
  readonly project: (entry: ThreadEntry) => AgentThread;
  readonly sessionReady: (entry: ThreadEntry) => void;
}

export interface RegistryDeps extends Omit<SessionDeps, "liveSessions"> {
  readonly logger: Logger;
  readonly stateStore: ThreadStateStore;
}

const MS_PER_SECOND = 1000;

const isOpen = (item: AgentTurn["items"][number]): boolean =>
  "status" in item && item.status === "inProgress";

export class ThreadRegistry {
  private readonly entries = new Map<string, ThreadEntry>();
  private readonly sessionOwners = new Map<string, string>();
  private readonly liveSessions = { count: 0 };
  private readonly deps: RegistryDeps;
  private readonly hooks: EntryHooks;

  public constructor(deps: RegistryDeps, hooks: EntryHooks) {
    this.deps = deps;
    this.hooks = hooks;
  }

  public get(appThreadId: string): ThreadEntry | null {
    return this.entries.get(appThreadId) ?? null;
  }

  public all(): IterableIterator<ThreadEntry> {
    return this.entries.values();
  }

  /** The thread whose session chain contains `sessionId`, if any. */
  public ownerOf(sessionId: string): ThreadEntry | null {
    const owner = this.sessionOwners.get(sessionId);
    return owner === undefined ? null : this.get(owner);
  }

  /** Persists and applies a state change. */
  public commit(entry: ThreadEntry, next: ThreadState): void {
    this.deps.stateStore.write(next);
    entry.state = next;
    for (const sessionId of next.sessionIds) {
      this.sessionOwners.set(sessionId, next.appThreadId);
    }
  }

  /** Persists a new thread state and registers its entry. */
  public add(state: ThreadState): ThreadEntry {
    this.deps.stateStore.write(state);
    return this.register(state);
  }

  private register(state: ThreadState): ThreadEntry {
    const appThreadId = asAppThreadId(state.appThreadId);
    const holder: { entry: ThreadEntry | null } = { entry: null };
    const entryOf = (): ThreadEntry => {
      if (holder.entry === null) {
        throw new Error("thread entry is not registered yet");
      }
      return holder.entry;
    };
    const session = new ClaudeSession(
      {
        appThreadId,
        emitThreadUpdated: () => {
          this.deps.emit({ thread: this.hooks.project(entryOf()), type: "thread.updated" });
        },
        historyLines: async () => this.hooks.historyLines(entryOf()),
        sessionReady: () => {
          this.hooks.sessionReady(entryOf());
        },
        state: () => entryOf().state,
        update: (change) => {
          const entry = entryOf();
          this.commit(entry, change(entry.state));
        },
        writeActiveTurn: (turn) => {
          if (turn === null) {
            this.deps.stateStore.clearActiveTurn(state.appThreadId);
          } else {
            this.deps.stateStore.writeActiveTurn(state.appThreadId, turn);
          }
        },
      },
      { ...this.deps, liveSessions: this.liveSessions },
    );
    const entry: ThreadEntry = { session, state };
    holder.entry = entry;
    this.entries.set(state.appThreadId, entry);
    for (const sessionId of state.sessionIds) {
      this.sessionOwners.set(sessionId, state.appThreadId);
    }
    return entry;
  }

  /**
   * Loads every stored thread and finalizes turns a previous process left in
   * progress as interrupted; returns their `turn.completed` events.
   */
  public load(): readonly AgentEvent[] {
    const events: AgentEvent[] = [];
    const stored = this.deps.stateStore.load((appThreadId, error) => {
      this.deps.logger.log("error", "thread state is unreadable", { appThreadId, err: error });
    });
    for (const { activeTurn, state } of stored) {
      const entry = this.register(state);
      if (activeTurn !== null) {
        events.push(this.finalizeInterrupted(entry, activeTurn));
      }
    }
    return events;
  }

  private finalizeInterrupted(entry: ThreadEntry, snapshot: AgentTurn): AgentEvent {
    const completedAt = Math.floor(this.deps.nowMs() / MS_PER_SECOND);
    const turn: AgentTurn = {
      ...snapshot,
      completedAt,
      items: snapshot.items.map((item) => (isOpen(item) ? failOpenItem(item) : item)),
      status: "interrupted",
    };
    const interrupted: TurnOutcomeRecord = { status: "interrupted" };
    const record = entry.state.turns.find((candidate) => candidate.turnId === turn.turnId);
    if (record !== undefined) {
      this.commit(
        entry,
        withTurnRecord(entry.state, { ...record, completedAt, outcome: interrupted }),
      );
    }
    this.deps.stateStore.clearActiveTurn(entry.state.appThreadId);
    this.deps.logger.log("info", "finalized a turn left in progress by a previous host process", {
      appThreadId: entry.state.appThreadId,
      turnId: turn.turnId,
    });
    return { appThreadId: asAppThreadId(entry.state.appThreadId), turn, type: "turn.completed" };
  }

  public get liveSessionCount(): number {
    return this.liveSessions.count;
  }

  /** Ends every live session (host shutdown). */
  public shutdown(): void {
    for (const entry of this.entries.values()) {
      entry.session.dispose();
    }
  }
}
