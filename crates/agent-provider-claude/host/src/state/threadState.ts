/**
 * The host's own per-thread metadata: only what Claude's session store cannot
 * tell. The conversation itself (messages, tool calls, titles, first prompt,
 * timestamps) is read from Claude's store; nothing here copies it.
 *
 * Kept per thread:
 * - the Claude session chain (a lost session is replaced by a new one);
 * - thread settings and settings waiting for the next turn boundary;
 * - CodeWide-only list state: archived flag and the delete tombstone;
 * - a title override while Claude cannot hold the title (no session yet, or a
 *   cleared title, which Claude cannot express);
 * - a turn index: turn ids, origins, outcomes and the `clientMessageId` echo
 *   of each prompt, keyed by the persisted message uuids ("anchors") that
 *   identify the turn inside Claude's transcript;
 * - cumulative token usage and cost, reported with `usage.updated`, the
 *   per-model totals last seen in the current Claude session (the baseline
 *   a turn's usage is measured against) and each finished turn's usage.
 * The in-flight turn's snapshot is kept separately (`ActiveTurnFile`) until
 * the turn ends, so a host restart can finalize it.
 */

import {
  NEW_SESSION_BASELINE,
  ZERO_USAGE,
  type ThreadCost,
  type UsageBaseline,
} from "../mapping/usage.js";
import type {
  AgentTurn,
  ThreadSettings,
  TokenUsage,
  TurnError,
  TurnOrigin,
  TurnUsageRecord,
} from "../protocol.js";

export { ZERO_USAGE } from "../mapping/usage.js";

export const THREAD_STATE_VERSION = 2;

/**
 * Why a prompt was offered: the turn's first prompt, an explicit steer, or
 * the first prompt resent (with a history prefix) to a replacement session.
 */
export type PromptRole = "first" | "resend" | "steer";

/** One prompt the host offered inside a turn. */
export interface PromptRecord {
  readonly clientMessageId: string | null;
  readonly role: PromptRole;
  /** Uuid of the persisted user message, or `null` when the offer had none. */
  readonly uuid: string | null;
}

/** How a host-driven turn ended. `inProgress` only while the turn runs. */
export type TurnOutcomeRecord =
  | { readonly error: TurnError; readonly status: "failed" }
  | { readonly status: "completed" }
  | { readonly status: "inProgress" }
  | { readonly status: "interrupted" };

/** Index entry of one turn the host drove. Carries ids only, never content. */
export interface TurnRecord {
  /** Persisted message uuids of this turn: its prompt uuids and its first persisted frame uuid. */
  readonly anchors: readonly string[];
  readonly completedAt: number | null;
  readonly origin: TurnOrigin;
  readonly outcome: TurnOutcomeRecord;
  readonly prompts: readonly PromptRecord[];
  readonly startedAt: number;
  readonly turnId: string;
  /** The usage `usage.updated` reported when the turn ended; `null` when none was measured. */
  readonly usage: TurnUsageRecord | null;
}

/** A title Claude's store cannot hold. */
export type TitleOverride =
  /** Claude's own session title is the thread name. */
  | { readonly type: "none" }
  /** Named before Claude created the session; applied with `renameSession` once it exists. */
  | { readonly name: string; readonly type: "pending" }
  /** The user cleared the name; Claude's title equal to `hiddenTitle` is not shown. */
  | { readonly hiddenTitle: string; readonly type: "cleared" };

/** Whether the thread is listed or deleted (tombstone; repeated deletes succeed). */
export type ThreadPresence =
  | { readonly archived: boolean; readonly type: "listed" }
  | { readonly deletedAt: number; readonly type: "deleted" };

/** How the host learned about the thread. */
export type ThreadStateOrigin =
  /** `thread.create` from CodeWide. */
  | "created"
  /** A session Claude already had (for example, started in a terminal). */
  | "discovered";

export interface ThreadState {
  readonly appThreadId: string;
  readonly createdAt: number;
  readonly cwd: string;
  readonly origin: ThreadStateOrigin;
  /** Settings accepted but not applied yet (applied at the next turn boundary). */
  readonly pendingSettings: ThreadSettings | null;
  readonly presence: ThreadPresence;
  readonly recencyAt: number | null;
  /** Claude session ids, oldest first; the last one is the current session. */
  readonly sessionIds: readonly [string, ...string[]];
  /** Whether the current session exists in Claude's store, so the next open must `resume`. */
  readonly sessionStarted: boolean;
  readonly settings: ThreadSettings;
  readonly title: TitleOverride;
  /** Cumulative cost of the thread's turns, while every turn's cost was known. */
  readonly totalCost: ThreadCost;
  readonly totalUsage: TokenUsage;
  readonly turns: readonly TurnRecord[];
  /** Last activity the host itself caused (turn start or end). */
  readonly updatedAt: number;
  /** Per-model totals last seen in the current Claude session; empty for a new session. */
  readonly usageBaseline: UsageBaseline;
  readonly version: typeof THREAD_STATE_VERSION;
}

/** Snapshot of the in-flight turn, rewritten whenever an item starts or completes. */
export interface ActiveTurnFile {
  readonly turn: AgentTurn;
  readonly version: typeof THREAD_STATE_VERSION;
}

/** Usage state of a thread with no turns, whose session the host starts itself. */
export const NEW_THREAD_USAGE: Pick<ThreadState, "totalCost" | "totalUsage" | "usageBaseline"> = {
  totalCost: { type: "known", usd: 0 },
  totalUsage: ZERO_USAGE,
  usageBaseline: NEW_SESSION_BASELINE,
};

/** The Claude session the thread currently talks to. */
export const currentSessionId = (state: ThreadState): string =>
  state.sessionIds.at(-1) ?? state.sessionIds[0];

export const isDeleted = (state: ThreadState): boolean => state.presence.type === "deleted";

export const isArchived = (state: ThreadState): boolean =>
  state.presence.type === "listed" && state.presence.archived;

/** Replaces the turn record with the same id, or appends it. */
export function withTurnRecord(state: ThreadState, record: TurnRecord): ThreadState {
  const index = state.turns.findIndex((turn) => turn.turnId === record.turnId);
  const turns = index === -1 ? [...state.turns, record] : state.turns.with(index, record);
  return { ...state, turns };
}
