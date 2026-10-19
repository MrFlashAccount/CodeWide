import { appLogger } from "../observability/logger";
import { recordOperationalTelemetryEvent } from "./telemetry";
import {
  isListStreamGeneration,
  parseThreadListRowsFrame,
  type ListRowThreadId,
  type ListStreamGeneration,
  type ThreadListRowsFrame,
} from "./threadListRow";

/**
 * The single device entry of Companion `threadListRows` frames and the owner of
 * the session cursor map that orders them against `thread/list` pages
 * (docs/companion-thread-list-stream.md). State is process memory scoped to one
 * `(connectionId, generation)`: a new socket generation forgets it, and rows
 * already in SQLite then count as rows without a cursor.
 */

const MAX_TOMBSTONES = 1024;

/**
 * Race rule shared by pushed rows and page rows. Every method is called inside
 * the summary database write queue, so the decision order equals the
 * application order.
 */
export type ThreadListRace = {
  /** Rule 1 (and the tombstone part of rule 2): admits a row and records its cursor. */
  readonly admitRow: (connectionId: string, threadId: ListRowThreadId, cursor: number) => boolean;
  /** Rule 2: admits a removal and remembers it against older page rows. */
  readonly admitTombstone: (
    connectionId: string,
    threadId: ListRowThreadId,
    cursor: number,
  ) => boolean;
  /** Generation of the connection's current socket; `null` before its first state. */
  readonly generation: (connectionId: string) => ListStreamGeneration | null;
  /** Whether rows read or pushed under `generation` still belong to the current socket. */
  readonly isCurrent: (connectionId: string, generation: ListStreamGeneration | null) => boolean;
  /** A row with a recorded cursor above `cursor` survives a snapshot that omits it. */
  readonly newerThan: (connectionId: string, threadId: string, cursor: number) => boolean;
};

/** A validated native list-stream signal of one connection. */
export type ThreadListStreamSignal =
  | { readonly generation: number; readonly kind: "generation" }
  | { readonly frame: unknown; readonly generation: number; readonly kind: "rows" };

/** Whether the frame was taken; `invalid` asks the native owner to reset the transport closed. */
export type ThreadListStreamAcceptance = "accepted" | "invalid";

type SessionState = {
  readonly cursors: Map<string, number>;
  readonly generation: ListStreamGeneration | null;
  readonly tombstones: Map<string, number>;
};

type StreamPorts = {
  /** Writes one admitted frame; called synchronously so frames keep their order. */
  readonly applyRows: (
    connectionId: string,
    generation: ListStreamGeneration,
    frame: ThreadListRowsFrame,
  ) => Promise<void>;
};

function emptySession(generation: ListStreamGeneration | null): SessionState {
  return { cursors: new Map(), generation, tombstones: new Map() };
}

function rejectFrame(connectionId: string, reason: string): ThreadListStreamAcceptance {
  recordOperationalTelemetryEvent(connectionId, {
    name: "sync.list_rows_invalid",
    tags: { reason: "invalid_list_rows", violation: reason },
  });
  return "invalid";
}

/** The list-stream ingress, its race owner and connection cleanup. */
export type ThreadListStream = {
  /** Takes one native signal; frames are applied in their arrival order. */
  readonly accept: (
    connectionId: string,
    signal: ThreadListStreamSignal,
  ) => ThreadListStreamAcceptance;
  /** Drops a removed connection's session; its next socket starts a new one. */
  readonly forgetConnection: (connectionId: string) => void;
  readonly race: ThreadListRace;
};

/** Creates the list-stream ingress and the race owner it shares with catalog pages. */
export function createThreadListStream({ applyRows }: StreamPorts): ThreadListStream {
  const sessions = new Map<string, SessionState>();
  const sessionOf = (connectionId: string): SessionState => {
    const existing = sessions.get(connectionId);
    if (existing !== undefined) {
      return existing;
    }
    const created = emptySession(null);
    sessions.set(connectionId, created);
    return created;
  };

  const rememberTombstone = (session: SessionState, threadId: string, cursor: number): void => {
    session.tombstones.delete(threadId);
    session.tombstones.set(threadId, cursor);
    if (session.tombstones.size > MAX_TOMBSTONES) {
      const oldest = session.tombstones.keys().next();
      if (oldest.done !== true) {
        session.tombstones.delete(oldest.value);
      }
    }
  };

  const race: ThreadListRace = {
    admitRow(connectionId, threadId, cursor) {
      const session = sessionOf(connectionId);
      const removedAt = session.tombstones.get(threadId);
      if (removedAt !== undefined) {
        if (cursor < removedAt) {
          return false;
        }
        session.tombstones.delete(threadId);
      }
      const entry = session.cursors.get(threadId);
      if (entry !== undefined && cursor < entry) {
        return false;
      }
      session.cursors.set(threadId, cursor);
      return true;
    },
    admitTombstone(connectionId, threadId, cursor) {
      const session = sessionOf(connectionId);
      const entry = session.cursors.get(threadId);
      if (entry !== undefined && cursor < entry) {
        return false;
      }
      session.cursors.set(threadId, cursor);
      rememberTombstone(session, threadId, cursor);
      return true;
    },
    generation: (connectionId) => sessions.get(connectionId)?.generation ?? null,
    isCurrent: (connectionId, generation) =>
      (sessions.get(connectionId)?.generation ?? null) === generation,
    newerThan(connectionId, threadId, cursor) {
      const entry = sessions.get(connectionId)?.cursors.get(threadId);
      return entry !== undefined && entry > cursor;
    },
  };

  const observeGeneration = (connectionId: string, generation: ListStreamGeneration): void => {
    if (sessions.get(connectionId)?.generation !== generation) {
      sessions.set(connectionId, emptySession(generation));
    }
  };

  const accept = (
    connectionId: string,
    signal: ThreadListStreamSignal,
  ): ThreadListStreamAcceptance => {
    if (!isListStreamGeneration(signal.generation)) {
      return rejectFrame(connectionId, "invalid generation");
    }
    if (signal.kind === "generation") {
      observeGeneration(connectionId, signal.generation);
      return "accepted";
    }
    if (sessions.get(connectionId)?.generation !== signal.generation) {
      // A frame of a replaced socket; its rows are re-read under the new generation.
      return "accepted";
    }
    const frame = parseThreadListRowsFrame(signal.frame);
    if (frame.status === "error") {
      return rejectFrame(connectionId, frame.error);
    }
    applyRows(connectionId, signal.generation, frame.value).catch((error: unknown) => {
      appLogger.warnCaught({
        error,
        event: "thread_list_stream.apply.failed",
        fields: { connectionId },
      });
    });
    return "accepted";
  };

  return {
    accept,
    forgetConnection(connectionId: string): void {
      sessions.delete(connectionId);
    },
    race,
  };
}
