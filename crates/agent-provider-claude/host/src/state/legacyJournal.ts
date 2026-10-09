/**
 * One-way reader of the version-1 journal written by the former Claude
 * sidecar (`threads/<id>/thread.json` plus `turns/<seq>.json`, which copied
 * every turn). It converts a v1 thread into the v2 metadata record: the
 * session chain, settings, archive/tombstone state, a pending title for a
 * CodeWide-only name, and the turn index (prompt uuids become anchors, so
 * history read from Claude's store keeps the old turn ids and
 * `clientMessageId` echoes). The copied conversation is not carried over.
 * Pure apart from reading the given files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTurn } from "../protocol.js";
import {
  bool,
  int,
  list,
  nullable,
  objectReader,
  ShapeError,
  str,
  type Check,
} from "../validation/checks.js";
import { initialThreadCost } from "../mapping/usage.js";
import { agentTurn, threadSettings, tokenUsage } from "../validation/modelChecks.js";
import {
  THREAD_STATE_VERSION,
  type PromptRecord,
  type ThreadState,
  type TurnOutcomeRecord,
  type TurnRecord,
} from "./threadState.js";

const LEGACY_VERSION = 1;
const TURN_FILE = /^\d{8}\.json$/u;

export const LEGACY_THREAD_FILE = "thread.json";

const legacyVersion: Check<typeof LEGACY_VERSION> = (value, path) => {
  if (value !== LEGACY_VERSION) {
    throw new ShapeError(`${path}: expected version ${String(LEGACY_VERSION)}`);
  }
  return LEGACY_VERSION;
};

interface LegacyThread {
  readonly appThreadId: string;
  readonly archived: boolean;
  readonly claudeSessionId: string;
  readonly createdAt: number;
  readonly cwd: string;
  readonly deletedAt: number | null;
  readonly name: string | null;
  readonly pendingSettings: ThreadState["pendingSettings"];
  readonly recencyAt: number | null;
  readonly sessionStarted: boolean;
  readonly settings: ThreadState["settings"];
  readonly totalUsage: ThreadState["totalUsage"];
  readonly updatedAt: number;
}

interface LegacyPrompt {
  readonly clientMessageId: string | null;
  readonly uuid: string | null;
}

interface LegacyTurn {
  readonly prompts: readonly LegacyPrompt[];
  readonly turn: AgentTurn;
}

const legacyPrompt: Check<LegacyPrompt> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    clientMessageId: reader.at("clientMessageId", nullable(str)),
    uuid: reader.at("uuid", nullable(str)),
  };
};

/** v1 did not record why a prompt was offered; later prompts are taken as steers. */
const promptRecord = (prompt: LegacyPrompt, index: number): PromptRecord => ({
  ...prompt,
  role: index === 0 ? "first" : "steer",
});

const legacyThread: Check<LegacyThread> = (value, path) => {
  const reader = objectReader(value, path);
  reader.at("version", legacyVersion);
  return {
    appThreadId: reader.at("appThreadId", str),
    archived: reader.at("archived", bool),
    claudeSessionId: reader.at("claudeSessionId", str),
    createdAt: reader.at("createdAt", int),
    cwd: reader.at("cwd", str),
    deletedAt: reader.at("deletedAt", nullable(int)),
    name: reader.at("name", nullable(str)),
    pendingSettings: reader.at("pendingSettings", nullable(threadSettings)),
    recencyAt: reader.at("recencyAt", nullable(int)),
    sessionStarted: reader.at("sessionStarted", bool),
    settings: reader.at("settings", threadSettings),
    totalUsage: reader.at("totalUsage", tokenUsage),
    updatedAt: reader.at("updatedAt", int),
  };
};

const legacyTurn: Check<LegacyTurn> = (value, path) => {
  const reader = objectReader(value, path);
  reader.at("version", legacyVersion);
  return { prompts: reader.at("prompts", list(legacyPrompt)), turn: reader.at("turn", agentTurn) };
};

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function outcomeOf(turn: AgentTurn): TurnOutcomeRecord {
  if (turn.status === "failed") {
    return {
      error: turn.error ?? { kind: "unknown", message: "Claude turn failed" },
      status: "failed",
    };
  }
  return { status: turn.status };
}

function turnRecord(legacy: LegacyTurn): TurnRecord {
  return {
    anchors: legacy.prompts.flatMap((prompt) => (prompt.uuid === null ? [] : [prompt.uuid])),
    completedAt: legacy.turn.completedAt,
    origin: legacy.turn.origin,
    outcome: outcomeOf(legacy.turn),
    prompts: legacy.prompts.map(promptRecord),
    startedAt: legacy.turn.startedAt,
    turnId: legacy.turn.turnId,
    usage: null,
  };
}

function legacyTurns(directory: string): readonly LegacyTurn[] {
  const turnsDirectory = join(directory, "turns");
  if (!existsSync(turnsDirectory)) {
    return [];
  }
  return readdirSync(turnsDirectory)
    .filter((name) => TURN_FILE.test(name))
    .toSorted()
    .map((name) => legacyTurn(readJson(join(turnsDirectory, name)), name));
}

function sessionChain(thread: LegacyThread): readonly [string, ...string[]] {
  return thread.claudeSessionId === thread.appThreadId
    ? [thread.appThreadId]
    : [thread.appThreadId, thread.claudeSessionId];
}

/** The converted thread and the turn a previous process left in progress, if any. */
export interface LegacyConversion {
  readonly activeTurn: AgentTurn | null;
  readonly state: ThreadState;
}

/** Reads and converts one v1 thread directory. Throws `ShapeError` for a foreign record. */
export function convertLegacyThread(directory: string, appThreadId: string): LegacyConversion {
  const thread = legacyThread(readJson(join(directory, LEGACY_THREAD_FILE)), LEGACY_THREAD_FILE);
  if (thread.appThreadId !== appThreadId) {
    throw new ShapeError("legacy journal thread id does not match its directory");
  }
  const turns = legacyTurns(directory);
  const active = turns.find((legacy) => legacy.turn.status === "inProgress")?.turn ?? null;
  const state: ThreadState = {
    appThreadId,
    createdAt: thread.createdAt,
    cwd: thread.cwd,
    origin: "created",
    pendingSettings: thread.pendingSettings,
    presence:
      thread.deletedAt === null
        ? { archived: thread.archived, type: "listed" }
        : { deletedAt: thread.deletedAt, type: "deleted" },
    recencyAt: thread.recencyAt,
    sessionIds: sessionChain(thread),
    sessionStarted: thread.sessionStarted,
    settings: thread.settings,
    title: thread.name === null ? { type: "none" } : { name: thread.name, type: "pending" },
    totalCost: initialThreadCost(thread.totalUsage),
    totalUsage: thread.totalUsage,
    turns: turns.map(turnRecord),
    updatedAt: thread.updatedAt,
    // The former sidecar kept no per-model totals.
    usageBaseline: { type: "unknown" },
    version: THREAD_STATE_VERSION,
  };
  return { activeTurn: active, state };
}
