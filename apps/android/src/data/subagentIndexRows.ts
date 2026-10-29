/**
 * Validates the Companion's indexed-subagent rows and maps them to catalog snapshots.
 *
 * `companion/threadSubagents/read` and the `subagents` field of `companion/thread/sync` carry the
 * same `threads` row array; this module is the single wire adapter for both, so the descendant
 * catalog receives one shape regardless of which read supplied it.
 */
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { SyncSnapshotThread } from "@codewide/sync-client";
import { unknownRecord } from "./unknownRecord";

/** One validated descendant row of a root thread's subagent index. */
export type IndexedSubagent = {
  readonly agentNickname: string | null;
  readonly agentRole: string | null;
  readonly archived: boolean;
  readonly cliVersion: string;
  readonly createdAt: number;
  readonly cwd: string;
  readonly id: string;
  readonly modelProvider: string;
  readonly parentThreadId: string | null;
  /**
   * Whether the sub-agent runs now, when the Companion knows it: Claude from its own index, Codex
   * from the child's rollout, CodeWide orchestration agents from the child's current turn.
   */
  readonly running: boolean | undefined;
  readonly source: Thread["source"];
  readonly updatedAt: number;
};

/** Parses one `{ threads: [...] }` index answer; rejects any malformed row. */
export function parseIndexedSubagents(value: unknown): readonly IndexedSubagent[] {
  const threads = unknownRecord(value)?.threads;
  if (!Array.isArray(threads)) {
    throw new Error("Companion returned an invalid subagent index");
  }
  return threads.map(parseIndexedSubagent);
}

/**
 * The `subagents` field of a `companion/thread/sync` answer: `null` when the Companion could not
 * read the index or predates the field, so the caller keeps its cached rows and falls back to
 * `companion/threadSubagents/read`.
 */
export function parseThreadSyncSubagents(response: unknown): readonly IndexedSubagent[] | null {
  const subagents = unknownRecord(response)?.subagents;
  return subagents === undefined || subagents === null ? null : parseIndexedSubagents(subagents);
}

/** The catalog snapshots of `rootThreadId`'s indexed descendants. */
export function subagentSnapshotThreads(
  rows: readonly IndexedSubagent[],
  rootThreadId: string,
): SyncSnapshotThread[] {
  return rows.map((row) => ({
    archived: row.archived,
    thread: indexedSubagentThread(row, rootThreadId),
  }));
}

function parseIndexedSubagent(value: unknown): IndexedSubagent {
  const row = unknownRecord(value);
  if (row === null || !hasRowIdentity(row) || !hasRowAgent(row) || !hasRowFacts(row)) {
    throw new Error("Companion returned an invalid subagent index row");
  }
  return {
    agentNickname: row.agentNickname,
    agentRole: row.agentRole,
    archived: row.archived,
    cliVersion: row.cliVersion,
    createdAt: row.createdAt,
    cwd: row.cwd,
    id: row.id,
    modelProvider: row.modelProvider,
    parentThreadId: row.parentThreadId,
    running: row.running,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

type RowIdentity = Pick<IndexedSubagent, "cwd" | "id" | "parentThreadId" | "source">;
type RowAgent = Pick<IndexedSubagent, "agentNickname" | "agentRole" | "archived" | "running">;
type RowFacts = Omit<IndexedSubagent, keyof RowIdentity | keyof RowAgent>;

function hasRowIdentity(
  row: Record<string, unknown>,
): row is Record<string, unknown> & RowIdentity {
  return (
    typeof row.id === "string" &&
    typeof row.cwd === "string" &&
    isNullableString(row.parentThreadId) &&
    isRelayedSessionSource(row.source)
  );
}

function hasRowAgent(row: Record<string, unknown>): row is Record<string, unknown> & RowAgent {
  return (
    typeof row.archived === "boolean" &&
    isNullableString(row.agentNickname) &&
    isNullableString(row.agentRole) &&
    (row.running === undefined || typeof row.running === "boolean")
  );
}

function hasRowFacts(row: Record<string, unknown>): row is Record<string, unknown> & RowFacts {
  return (
    typeof row.modelProvider === "string" &&
    typeof row.cliVersion === "string" &&
    typeof row.createdAt === "number" &&
    typeof row.updatedAt === "number"
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * WHY: the Companion relays each provider's own source value (Codex and CodeWide orchestration
 * send the upstream `{ subagent: ... }` spawn shape, not the v2 union), and the client only stores
 * it on the summary row. Requiring a string or an object keeps a missing or scalar-garbage source
 * out without rejecting a provider shape the client never interprets.
 */
function isRelayedSessionSource(value: unknown): value is Thread["source"] {
  return typeof value === "string" || unknownRecord(value) !== null;
}

/**
 * The Companion says whether a sub-agent runs (Claude from its own index, Codex from the child's
 * rollout, orchestration agents from the child's current turn). An explicit `false` is `idle` and
 * replaces a stale `active`. A row without it (an older Companion, or a child whose state is
 * unreadable) is `notLoaded`, which never replaces `active`, until a live event arrives.
 */
function indexedSubagentStatus(running: boolean | undefined): Thread["status"] {
  if (running === undefined) {
    return { type: "notLoaded" };
  }
  return running ? { activeFlags: [], type: "active" } : { type: "idle" };
}

function indexedSubagentThread(row: IndexedSubagent, rootThreadId: string): Thread {
  return {
    agentNickname: row.agentNickname,
    agentRole: row.agentRole,
    canAcceptDirectInput: null,
    cliVersion: row.cliVersion,
    createdAt: row.createdAt,
    cwd: row.cwd,
    daybreakEnabled: null,
    environments: null,
    ephemeral: false,
    extra: null,
    forkedFromId: null,
    gitInfo: null,
    historyMode: "paginated",
    id: row.id,
    model: null,
    modelProvider: row.modelProvider,
    name: null,
    originator: null,
    parentThreadId: row.parentThreadId,
    path: null,
    preview: "",
    projectId: null,
    reasoningEffort: null,
    recencyAt: row.updatedAt,
    section: null,
    sectionEnteredAt: null,
    sessionId: rootThreadId,
    source: row.source,
    status: indexedSubagentStatus(row.running),
    threadSource: null,
    turns: [],
    updatedAt: row.updatedAt,
  };
}
