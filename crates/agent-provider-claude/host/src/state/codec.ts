/**
 * Shape checks of the host's own state files. Records are written only by
 * `stateStore.ts`, but they are still read through these checks so that a
 * truncated, foreign or older file is rejected instead of trusted. Pure.
 */

import {
  bool,
  int,
  list,
  nullable,
  objectReader,
  oneOf,
  ShapeError,
  str,
  tagged,
  type Check,
} from "../validation/checks.js";
import { agentTurn, threadSettings, tokenUsage, turnError } from "../validation/modelChecks.js";
import {
  THREAD_STATE_VERSION,
  type ActiveTurnFile,
  type PromptRecord,
  type ThreadPresence,
  type ThreadState,
  type TitleOverride,
  type TurnOutcomeRecord,
  type TurnRecord,
} from "./threadState.js";

const version: Check<typeof THREAD_STATE_VERSION> = (value, path) => {
  if (value !== THREAD_STATE_VERSION) {
    throw new ShapeError(`${path}: expected version ${String(THREAD_STATE_VERSION)}`);
  }
  return THREAD_STATE_VERSION;
};

export const promptRecord: Check<PromptRecord> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    clientMessageId: reader.at("clientMessageId", nullable(str)),
    role: reader.at("role", oneOf(["first", "resend", "steer"])),
    uuid: reader.at("uuid", nullable(str)),
  };
};

const outcomeRecord: Check<TurnOutcomeRecord> = tagged<TurnOutcomeRecord>("status", {
  completed: () => ({ status: "completed" }),
  failed: (reader) => ({ error: reader.at("error", turnError), status: "failed" }),
  inProgress: () => ({ status: "inProgress" }),
  interrupted: () => ({ status: "interrupted" }),
});

const turnRecord: Check<TurnRecord> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    anchors: reader.at("anchors", list(str)),
    completedAt: reader.at("completedAt", nullable(int)),
    origin: reader.at("origin", oneOf(["user", "provider"])),
    outcome: reader.at("outcome", outcomeRecord),
    prompts: reader.at("prompts", list(promptRecord)),
    startedAt: reader.at("startedAt", int),
    turnId: reader.at("turnId", str),
  };
};

const titleOverride: Check<TitleOverride> = tagged<TitleOverride>("type", {
  cleared: (reader) => ({ hiddenTitle: reader.at("hiddenTitle", str), type: "cleared" }),
  none: () => ({ type: "none" }),
  pending: (reader) => ({ name: reader.at("name", str), type: "pending" }),
});

const presence: Check<ThreadPresence> = tagged<ThreadPresence>("type", {
  deleted: (reader) => ({ deletedAt: reader.at("deletedAt", int), type: "deleted" }),
  listed: (reader) => ({ archived: reader.at("archived", bool), type: "listed" }),
});

const sessionChain: Check<readonly [string, ...string[]]> = (value, path) => {
  const [first, ...rest] = list(str)(value, path);
  if (first === undefined) {
    throw new ShapeError(`${path}: expected at least one session id`);
  }
  return [first, ...rest];
};

export const threadState: Check<ThreadState> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    appThreadId: reader.at("appThreadId", str),
    createdAt: reader.at("createdAt", int),
    cwd: reader.at("cwd", str),
    origin: reader.at("origin", oneOf(["created", "discovered"])),
    pendingSettings: reader.at("pendingSettings", nullable(threadSettings)),
    presence: reader.at("presence", presence),
    recencyAt: reader.at("recencyAt", nullable(int)),
    sessionIds: reader.at("sessionIds", sessionChain),
    sessionStarted: reader.at("sessionStarted", bool),
    settings: reader.at("settings", threadSettings),
    title: reader.at("title", titleOverride),
    totalUsage: reader.at("totalUsage", tokenUsage),
    turns: reader.at("turns", list(turnRecord)),
    updatedAt: reader.at("updatedAt", int),
    version: reader.at("version", version),
  };
};

export const activeTurnFile: Check<ActiveTurnFile> = (value, path) => {
  const reader = objectReader(value, path);
  return { turn: reader.at("turn", agentTurn), version: reader.at("version", version) };
};
