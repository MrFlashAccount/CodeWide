/**
 * `nativeSession.list` and `nativeSession.read`: Claude's own sessions for
 * the companion's native index, the Claude counterpart of the Codex rollout
 * reader.
 *
 * The listing pages every session (programmatic and interactive) newest
 * first, with the metadata the index needs to detect a change cheaply
 * (`lastModifiedMs`, `fileSize`). A read rebuilds one session and its
 * sub-agents as neutral turns. Ids are derived only from the stored messages
 * and the host's turn index, so reading unchanged input twice yields equal
 * results; the only live input is the snapshot of a turn still running in the
 * session. Nothing read here is kept.
 */

import type {
  AgentTurn,
  NativeSession,
  NativeSessionCodewide,
  NativeSubagent,
} from "../protocol.js";
import { asAppThreadId } from "../protocol.js";
import type { SessionLocation, SessionStore, StoredSession } from "../claude/port.js";
import {
  reconstructSubagentTurns,
  reconstructTurns,
  type HistoryContext,
} from "../history/reconstruct.js";
import { agentIdOf } from "../mapping/subagents.js";
import type { TurnRecord } from "../state/threadState.js";
import { withActiveTurn } from "./history.js";
import type { SessionCatalog } from "./sessionCatalog.js";

/** The host thread a session belongs to, when the host keeps metadata for it. */
export interface SessionOwner {
  /** The live snapshot of a turn running in this session, or `null`. */
  readonly activeTurn: AgentTurn | null;
  readonly appThreadId: string;
  /** The thread's CodeWide metadata for its list row. */
  readonly codewide: NativeSessionCodewide;
  readonly cwd: string;
  readonly turns: readonly TurnRecord[];
}

export interface NativeSessionDeps {
  readonly catalog: SessionCatalog;
  readonly ownerOf: (sessionId: string) => SessionOwner | null;
  readonly store: SessionStore;
}

export interface NativeListQuery {
  readonly cursor: string | null;
  readonly dir: string | null;
  readonly limit: number;
}

export type NativeListResult =
  | {
      readonly nextCursor: string | null;
      readonly sessions: readonly NativeSession[];
      readonly status: "ok";
    }
  | { readonly status: "invalidCursor" };

export interface NativeRead {
  readonly session: NativeSession;
  readonly subagents: readonly NativeSubagent[];
  readonly turns: readonly AgentTurn[];
}

export type NativeReadResult =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly value: NativeRead };

const MAX_PAGE = 500;
const CURSOR = /^v1:(\d+)$/u;

/** Offset cursor over the newest-first listing; a change between pages can shift entries, which the index tolerates. */
function offsetOf(cursor: string | null): number | null {
  if (cursor === null) {
    return 0;
  }
  const [, offset] = CURSOR.exec(cursor) ?? [];
  return offset === undefined ? null : Number(offset);
}

function nativeSession(
  session: StoredSession,
  owner: SessionOwner | null,
  interactive: boolean,
): NativeSession {
  return {
    appThreadId: asAppThreadId(owner?.appThreadId ?? session.sessionId),
    ...(owner === null ? {} : { codewide: owner.codewide }),
    createdAtMs: session.createdAtMs,
    cwd: session.cwd,
    fileSize: session.fileSize,
    firstPrompt: session.firstPrompt,
    interactive,
    lastModifiedMs: session.lastModifiedMs,
    sessionId: session.sessionId,
    summary: session.summary,
    title: session.title,
  };
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A field of the first stored message, for sub-agent links. */
function firstField(messages: readonly unknown[], name: string): string | null {
  const first: unknown = messages[0];
  return typeof first === "object" && first !== null ? str(Reflect.get(first, name)) : null;
}

/** Turns of a session belong to its owning thread when the host has one. */
function historyContext(session: StoredSession, owner: SessionOwner | null): HistoryContext {
  if (owner !== null) {
    return { appThreadId: asAppThreadId(owner.appThreadId), cwd: owner.cwd };
  }
  return { appThreadId: asAppThreadId(session.sessionId), cwd: session.cwd ?? "" };
}

interface SubagentTranscript {
  readonly agentId: string;
  readonly messages: readonly unknown[];
}

/** Agent ids whose spawning item, in any of `turns`, still reports `running`. */
function runningAgents(turns: readonly AgentTurn[], into: Set<string>): void {
  for (const turn of turns) {
    for (const item of turn.items) {
      const agentId =
        item.type === "subagent" && item.status === "running" && item.agentThreadId !== null
          ? agentIdOf(item.agentThreadId)
          : null;
      if (agentId !== null) {
        into.add(agentId);
      }
    }
  }
}

/**
 * Each sub-agent transcript as neutral turns. A sub-agent its spawning item
 * (in the main conversation or in another sub-agent) reports `running` keeps
 * its last turn in progress.
 */
function nativeSubagents(
  transcripts: readonly SubagentTranscript[],
  turns: readonly AgentTurn[],
  context: HistoryContext,
): readonly NativeSubagent[] {
  const settled = transcripts.map((transcript) => ({
    ...transcript,
    turns: reconstructSubagentTurns(transcript.messages, context),
  }));
  const running = new Set<string>();
  runningAgents(turns, running);
  for (const transcript of settled) {
    runningAgents(transcript.turns, running);
  }
  return settled.map(({ agentId, messages, turns: settledTurns }) => ({
    agentId,
    parentAgentId: firstField(messages, "parent_agent_id"),
    parentToolUseId: firstField(messages, "parent_tool_use_id"),
    turns: running.has(agentId) ? reconstructSubagentTurns(messages, context, true) : settledTurns,
  }));
}

export class NativeSessionReader {
  private readonly deps: NativeSessionDeps;

  public constructor(deps: NativeSessionDeps) {
    this.deps = deps;
  }

  public async list(query: NativeListQuery): Promise<NativeListResult> {
    const offset = offsetOf(query.cursor);
    if (offset === null) {
      return { status: "invalidCursor" };
    }
    const limit = Math.max(1, Math.min(query.limit, MAX_PAGE));
    const page = await this.deps.catalog.page({ dir: query.dir, limit, offset });
    return {
      nextCursor: page.more ? `v1:${String(offset + limit)}` : null,
      sessions: page.sessions.map((session) =>
        nativeSession(
          session,
          this.deps.ownerOf(session.sessionId),
          page.interactive.has(session.sessionId),
        ),
      ),
      status: "ok",
    };
  }

  private async isInteractive(session: StoredSession): Promise<boolean> {
    const interactive = await this.deps.store.list({
      dir: session.cwd,
      limit: null,
      offset: 0,
      scope: "interactive",
    });
    return interactive.some((candidate) => candidate.sessionId === session.sessionId);
  }

  private async subagentTranscripts(
    location: SessionLocation,
  ): Promise<readonly SubagentTranscript[]> {
    const agentIds = (await this.deps.store.subagents(location)).toSorted();
    return Promise.all(
      agentIds.map(async (agentId) => ({
        agentId,
        messages: await this.deps.store.subagentMessages({ ...location, agentId }),
      })),
    );
  }

  public async read(sessionId: string): Promise<NativeReadResult> {
    const session = await this.deps.catalog.refresh({ cwd: null, sessionId });
    if (session === null) {
      return { status: "missing" };
    }
    const owner = this.deps.ownerOf(sessionId);
    const location: SessionLocation = { cwd: session.cwd, sessionId };
    const context = historyContext(session, owner);
    const [messages, interactive, transcripts] = await Promise.all([
      this.deps.store.messages(location),
      this.isInteractive(session),
      this.subagentTranscripts(location),
    ]);
    const records = owner?.turns ?? [];
    const turns = withActiveTurn(
      reconstructTurns(messages, records, context),
      owner?.activeTurn ?? null,
      records,
    );
    const subagents = nativeSubagents(transcripts, turns, context);
    return {
      status: "ok",
      value: { session: nativeSession(session, owner, interactive), subagents, turns },
    };
  }
}
