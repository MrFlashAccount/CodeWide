/**
 * Projection of one thread onto the neutral `AgentThread`: Claude's session
 * metadata (title, first prompt, timestamps, cwd) combined with the host's
 * own metadata (settings, archive flag, title override, live status). Pure.
 */

import type {
  AgentThread,
  NativeSessionCodewide,
  ThreadSettings,
  ThreadStatus,
} from "../protocol.js";
import { asAppThreadId, PROVIDER_ID } from "../protocol.js";
import type { StoredSession } from "../claude/port.js";
import { HISTORY_HEADER } from "../history/prefix.js";
import { isArchived, type ThreadState } from "../state/threadState.js";
import { unreachable } from "../support/unreachable.js";

/** Settings of a thread CodeWide has never configured (for example, started in a terminal). */
export const DISCOVERED_SETTINGS: ThreadSettings = {
  effort: null,
  model: "default",
  permissionProfile: ":read-only",
  serviceTier: null,
};

const PREVIEW_MAX_CHARACTERS = 200;
const MS_PER_SECOND = 1000;
const seconds = (ms: number): number => Math.floor(ms / MS_PER_SECOND);

/** Everything known about one thread. */
export interface ThreadView {
  readonly appThreadId: string;
  /**
   * The first prompt of a live turn Claude has not persisted yet, so a new
   * thread shows its preview at once; `null` otherwise. Never stored.
   */
  readonly livePrompt: string | null;
  /**
   * Catalog id of the model a session CodeWide never touched last answered
   * with, when read; its settings report it instead of `default`.
   */
  readonly recordedModel: string | null;
  /** Sessions of the thread's chain that exist in Claude's store, oldest first. */
  readonly sessions: readonly StoredSession[];
  /** Host metadata, or `null` for a session CodeWide never touched. */
  readonly state: ThreadState | null;
  readonly status: ThreadStatus;
}

/** Settings of a session CodeWide never configured, with its recorded model when known. */
export function discoveredSettings(recordedModel: string | null): ThreadSettings {
  return recordedModel === null
    ? DISCOVERED_SETTINGS
    : { ...DISCOVERED_SETTINGS, model: recordedModel };
}

/** The person's first prompt (a replacement session's history prefix is not one). */
function firstPrompt(view: ThreadView): string | null {
  for (const session of view.sessions) {
    if (session.firstPrompt !== null && !session.firstPrompt.startsWith(HISTORY_HEADER)) {
      return session.firstPrompt;
    }
  }
  return view.livePrompt;
}

function threadName(view: ThreadView): string | null {
  const title = view.sessions.findLast((session) => session.title !== null)?.title ?? null;
  const override = view.state?.title ?? { type: "none" };
  switch (override.type) {
    case "pending":
      return override.name;
    case "cleared":
      return title === override.hiddenTitle ? null : title;
    case "none":
      return title;
    default:
      return unreachable(override);
  }
}

function createdAt(view: ThreadView): number {
  const first = view.sessions[0];
  if (view.state !== null) {
    return view.state.createdAt;
  }
  return first === undefined ? 0 : seconds(first.createdAtMs ?? first.lastModifiedMs);
}

function updatedAt(view: ThreadView): number {
  const modified = view.sessions.map((session) => seconds(session.lastModifiedMs));
  return Math.max(createdAt(view), view.state?.updatedAt ?? 0, ...modified);
}

/** Facts only the host's metadata holds, with the defaults of a session CodeWide never touched. */
function hostFacts(
  view: ThreadView,
): Pick<AgentThread, "archived" | "origin" | "recencyAt" | "settings"> {
  const state = view.state;
  if (state === null) {
    return {
      archived: false,
      origin: "external",
      recencyAt: null,
      settings: discoveredSettings(view.recordedModel),
    };
  }
  return {
    archived: isArchived(state),
    origin: state.origin === "created" ? "interactive" : "external",
    recencyAt: state.recencyAt,
    settings: state.pendingSettings ?? state.settings,
  };
}

/**
 * The CodeWide metadata a native index needs to build the thread's list row
 * without the host (`NativeSession.codewide`): the same facts `projectThread`
 * merges in.
 */
export function codewideMetadata(state: ThreadState): NativeSessionCodewide {
  return {
    createdAt: state.createdAt,
    cwd: state.cwd,
    origin: state.origin === "created" ? "interactive" : "external",
    presence: state.presence,
    recencyAt: state.recencyAt,
    settings: state.pendingSettings ?? state.settings,
    title: state.title,
    updatedAt: state.updatedAt,
  };
}

const cwdOf = (view: ThreadView): string => view.state?.cwd ?? view.sessions[0]?.cwd ?? "";

export function projectThread(view: ThreadView): AgentThread {
  return {
    appThreadId: asAppThreadId(view.appThreadId),
    createdAt: createdAt(view),
    cwd: cwdOf(view),
    name: threadName(view),
    preview: firstPrompt(view)?.slice(0, PREVIEW_MAX_CHARACTERS) ?? "",
    provider: PROVIDER_ID,
    status: view.status,
    updatedAt: updatedAt(view),
    ...hostFacts(view),
  };
}

/** A thread without a user message yet; shells are hidden from the non-archived list. */
export function isShell(view: ThreadView): boolean {
  const hasUserTurn = view.state?.turns.some((turn) => turn.origin === "user") ?? false;
  return !hasUserTurn && firstPrompt(view) === null;
}

/** Text a `thread.list` search term is matched against: the name, else the first prompt. */
export function searchText(view: ThreadView): string {
  return threadName(view) ?? firstPrompt(view) ?? "";
}
