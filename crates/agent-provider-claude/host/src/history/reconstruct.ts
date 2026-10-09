/**
 * Thread history from Claude's own session store, mapped to the same
 * neutral turns and items the live path emits.
 *
 * Each derived turn segment is replayed through the live `TurnBuilder`, so
 * item ids (`{message.id}:{block}`, `tool_use.id`, `{turnId}:user:{n}`),
 * item types, ordering and the final-answer rule are identical to live. The
 * turn index adds what the store lacks: turn ids and origins of host-driven
 * turns, their outcomes (failed, interrupted) and the `clientMessageId` of
 * each prompt. A turn the host did not drive (for example, typed in a
 * terminal) gets the uuid of its first message as id.
 *
 * Known losses compared with live: reasoning text (the store keeps only
 * thinking signatures), Bash stdout/stderr split and exit details (the
 * tool_result text is used), file diffs (rebuilt from Edit/Write input
 * instead of the applied patch), sub-agent internals and tool durations
 * other than tool_use → tool_result timestamps. Pure; no I/O.
 */

import type {
  AgentTurn,
  AppThreadId,
  ClientMessageId,
  TurnId,
  TurnOrigin,
  UserContent,
} from "../protocol.js";
import { asClientMessageId, asTurnId } from "../protocol.js";
import { isRecord, type ClaudeFrame } from "../mapping/frames.js";
import type { TurnOutcome } from "../mapping/result.js";
import {
  CANCEL_MESSAGE,
  DECLINE_MESSAGE,
  READ_ONLY_DENY_PREFIX,
} from "../permissions/approvals.js";
import type { PromptRecord, TurnRecord } from "../state/threadState.js";
import { TurnBuilder } from "../threads/turnBuilder.js";
import { unreachable } from "../support/unreachable.js";
import { historyEntries, type HistoryEntry } from "./entries.js";
import { historySegments, type HistorySegment, type SegmentHints } from "./segments.js";

export interface HistoryContext {
  readonly appThreadId: AppThreadId;
  readonly cwd: string;
}

/** Tool results Claude or the host wrote for a call the user or a profile refused. */
const DECLINED_RESULT_PREFIXES: readonly string[] = [
  "The user doesn't want to proceed with this tool use",
  DECLINE_MESSAGE,
  CANCEL_MESSAGE,
  READ_ONLY_DENY_PREFIX,
];

/** The uuid of the first message Claude persisted for a host-driven turn. */
function startAnchor(record: TurnRecord): string | null {
  const promptUuids = new Set(record.prompts.map((prompt) => prompt.uuid));
  if (record.origin === "user") {
    return record.prompts.find((prompt) => prompt.role === "first")?.uuid ?? null;
  }
  return record.anchors.find((anchor) => !promptUuids.has(anchor)) ?? null;
}

function segmentHints(records: readonly TurnRecord[]): SegmentHints {
  const starts = new Map<string, TurnRecord["origin"]>();
  const continuations = new Set<string>();
  for (const record of records) {
    const start = startAnchor(record);
    if (start !== null) {
      starts.set(start, record.origin);
    }
    for (const prompt of record.prompts) {
      if (prompt.role !== "first" && prompt.uuid !== null) {
        continuations.add(prompt.uuid);
      }
    }
  }
  return { continuations, starts };
}

function recordOf(segment: HistorySegment, records: readonly TurnRecord[]): TurnRecord | null {
  const uuids = new Set(segment.entries.map((entry) => entry.uuid));
  return records.find((record) => record.anchors.some((anchor) => uuids.has(anchor))) ?? null;
}

function outcomeOf(segment: HistorySegment, record: TurnRecord | null): TurnOutcome {
  const outcome = record?.outcome ?? null;
  if (outcome === null || outcome.status === "inProgress") {
    return segment.interrupted || outcome !== null
      ? { status: "interrupted" }
      : { status: "completed" };
  }
  return outcome;
}

function declinedToolUses(frame: ClaudeFrame): readonly string[] {
  if (frame.kind !== "user") {
    return [];
  }
  return frame.toolResults.flatMap((result) =>
    result.isError && DECLINED_RESULT_PREFIXES.some((prefix) => result.text.startsWith(prefix))
      ? [result.toolUseId]
      : [],
  );
}

/** What the turn index says about the prompts of one turn. */
interface PromptIndex {
  /** `clientMessageId` by persisted prompt uuid; a resent prompt carries the first prompt's id. */
  readonly clientMessageIds: ReadonlyMap<string, ClientMessageId>;
  /** Uuids of the first prompt resent to a replacement session: not a new user message. */
  readonly resent: ReadonlySet<string>;
}

/** The `clientMessageId` a persisted prompt echoes; a resent prompt echoes the first prompt's. */
function clientMessageIds(prompts: readonly PromptRecord[]): ReadonlyMap<string, ClientMessageId> {
  const firstClientId = prompts.find((prompt) => prompt.role === "first")?.clientMessageId ?? null;
  const ids = new Map<string, ClientMessageId>();
  for (const prompt of prompts) {
    const clientMessageId = prompt.role === "resend" ? firstClientId : prompt.clientMessageId;
    if (prompt.uuid !== null && clientMessageId !== null) {
      ids.set(prompt.uuid, asClientMessageId(clientMessageId));
    }
  }
  return ids;
}

function promptIndex(record: TurnRecord | null): PromptIndex {
  const prompts = record?.prompts ?? [];
  return {
    clientMessageIds: clientMessageIds(prompts),
    resent: new Set(
      prompts.flatMap((prompt) =>
        prompt.role === "resend" && prompt.uuid !== null ? [prompt.uuid] : [],
      ),
    ),
  };
}

/** Identity of a rebuilt turn: from the index, else derived from its first message. */
interface TurnIdentity {
  readonly origin: TurnOrigin;
  readonly turnId: TurnId;
}

function turnIdentity(segment: HistorySegment, record: TurnRecord | null): TurnIdentity {
  if (record !== null) {
    return { origin: record.origin, turnId: asTurnId(record.turnId) };
  }
  return { origin: segment.origin, turnId: asTurnId(segment.entries[0]?.uuid ?? "") };
}

/** Replays one segment through a turn builder whose clock reads entry timestamps. */
class SegmentReplay {
  private readonly builder: TurnBuilder;
  private readonly clock: { ms: number };
  private readonly prompts: PromptIndex;

  public constructor(
    identity: TurnIdentity,
    prompts: PromptIndex,
    context: HistoryContext & { readonly startMs: number },
  ) {
    this.clock = { ms: context.startMs };
    this.prompts = prompts;
    this.builder = new TurnBuilder({
      appThreadId: context.appThreadId,
      cwd: context.cwd,
      nowMs: () => this.clock.ms,
      origin: identity.origin,
      turnId: identity.turnId,
    });
  }

  private userMessage(entry: Extract<HistoryEntry, { readonly kind: "prompt" }>): {
    readonly clientMessageId: ClientMessageId | null;
    readonly content: readonly UserContent[];
  } {
    return {
      clientMessageId: this.prompts.clientMessageIds.get(entry.uuid) ?? null,
      content: entry.content,
    };
  }

  /** Begins the turn; returns whether `first` became its first user message. */
  public begin(first: HistoryEntry | undefined): boolean {
    const opening =
      first?.kind === "prompt" && this.builder.origin === "user" ? this.userMessage(first) : null;
    this.builder.begin(opening);
    return opening !== null;
  }

  public apply(entry: HistoryEntry): void {
    this.clock.ms = entry.timestampMs;
    switch (entry.kind) {
      case "prompt": {
        if (!this.prompts.resent.has(entry.uuid)) {
          const message = this.userMessage(entry);
          this.builder.addUserMessage(message.clientMessageId, message.content);
        }
        return;
      }
      case "frame":
        for (const toolUseId of declinedToolUses(entry.frame)) {
          this.builder.markDeclined(toolUseId);
        }
        this.builder.onFrame(entry.frame);
        return;
      case "compaction":
        this.builder.onFrame({ kind: "compactBoundary", uuid: entry.uuid });
        return;
      case "interrupt":
      case "wake":
        return;
      default:
        unreachable(entry);
    }
  }

  public finish(outcome: TurnOutcome): AgentTurn {
    return this.builder.finish(outcome, null).turn;
  }
}

/** Index timestamps win over the ones read from the store; the index adds the turn's usage. */
function withRecord(turn: AgentTurn, record: TurnRecord | null): AgentTurn {
  if (record === null) {
    return turn;
  }
  return {
    ...turn,
    completedAt: record.completedAt ?? turn.completedAt,
    startedAt: record.startedAt,
    ...(record.usage === null ? {} : { usage: record.usage }),
  };
}

function replaySegment(
  segment: HistorySegment,
  records: readonly TurnRecord[],
  context: HistoryContext,
): AgentTurn {
  const record = recordOf(segment, records);
  const [first, ...rest] = segment.entries;
  const replay = new SegmentReplay(turnIdentity(segment, record), promptIndex(record), {
    ...context,
    startMs: first?.timestampMs ?? 0,
  });
  const consumedFirst = replay.begin(first);
  for (const entry of consumedFirst ? rest : segment.entries) {
    replay.apply(entry);
  }
  return withRecord(replay.finish(outcomeOf(segment, record)), record);
}

/**
 * Rebuilds the turns of a thread from the stored messages of its session
 * chain (oldest first) and the host's turn index.
 */
export function reconstructTurns(
  messages: readonly unknown[],
  records: readonly TurnRecord[],
  context: HistoryContext,
): readonly AgentTurn[] {
  return historySegments(historyEntries(messages, null), segmentHints(records)).map((segment) =>
    replaySegment(segment, records, context),
  );
}

/** The tool call that spawned a sub-agent, read from its first stored message. */
export function subagentParent(messages: readonly unknown[]): string | null {
  const first: unknown = messages[0];
  const parent = isRecord(first) ? first["parent_tool_use_id"] : null;
  return typeof parent === "string" ? parent : null;
}

/**
 * Rebuilds the turns of one sub-agent transcript. Sub-agents are never
 * host-driven, so their turn ids come from their messages alone.
 */
export function reconstructSubagentTurns(
  messages: readonly unknown[],
  context: HistoryContext,
): readonly AgentTurn[] {
  const hints = { continuations: new Set<string>(), starts: new Map<string, TurnOrigin>() };
  return historySegments(historyEntries(messages, subagentParent(messages)), hints).map((segment) =>
    replaySegment(segment, [], context),
  );
}
