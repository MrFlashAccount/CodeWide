/**
 * Token and cost accounting of Claude turns. Pure; no I/O.
 *
 * The SDK reports usage as cumulative per-model totals (`modelUsage`) on every
 * result of one query() call; they cover the main loop, Task subagents,
 * sidechains and internal calls such as compaction. A turn's usage is the
 * difference between a result's totals and an earlier snapshot of the same
 * running total (the baseline). The host persists the last few snapshots of
 * the thread's current Claude session (checkpoints, newest first). Rules:
 * - a result whose totals are all zero (crash and startup-error results)
 *   measures nothing and keeps the baseline;
 * - totals that cover the newest checkpoint (every model in it, every counter
 *   at least as high) continue it: the usual case, also for a resumed query()
 *   that restored the totals its transcript saved;
 * - otherwise the running total restarted: a resumed query() restored older
 *   saved totals, or none, or a mid-session `/clear` reset it. The result is
 *   measured from the newest checkpoint it covers, else from zero. A restart
 *   whose fresh totals happen to cover an old checkpoint is under-counted by
 *   that checkpoint (a documented limit: the SDK does not say which happened);
 * - without a baseline (a session CodeWide did not start, or state written
 *   before the baseline existed) the first result's totals may include
 *   earlier usage, so that result counts only its main-loop `usage` (per-turn,
 *   subagents excluded) with an unknown cost, and sets the baseline;
 * - a turn's cost is known only when every model it used was priced from a
 *   known price table (`costBasis` `list` or `managed`).
 */

import type { ProviderCost, ProviderCostBasis, TokenUsage } from "../protocol.js";
import { unreachable } from "../support/unreachable.js";
import type { ModelTotals, RequestFigures } from "./frames.js";

/** One model's cumulative counters, as kept in the persisted baseline. */
export interface ModelCounters {
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly model: string;
  readonly outputTokens: number;
  readonly thinkingTokens: number;
}

/** One snapshot of a session's running total: every model's counters. */
export type UsageSnapshot = readonly ModelCounters[];

/** Snapshots of the thread's current Claude session that results are measured from. */
export type UsageBaseline =
  | {
      /** The latest snapshots, newest first; empty for a session that has used nothing. */
      readonly checkpoints: readonly UsageSnapshot[];
      readonly type: "known";
    }
  /** The session may hold usage the host never measured. */
  | { readonly type: "unknown" };

/** The baseline of a session the host starts itself. */
export const NEW_SESSION_BASELINE: UsageBaseline = { checkpoints: [], type: "known" };

/** How many snapshots a baseline keeps. */
export const MAX_CHECKPOINTS = 8;

/** What a turn (or one result of it) cost. */
export type TurnCost =
  /** No model request happened. */
  | { readonly type: "none" }
  /** A model was priced from no known table; the SDK's figure is a guess. */
  | { readonly type: "unpriced" }
  | {
      readonly basis: ProviderCostBasis;
      /** Priced model ids, without duplicates. */
      readonly models: readonly string[];
      readonly type: "priced";
      readonly usd: number;
    };

/** The thread's cumulative cost: known only while every turn's cost was known. */
export type ThreadCost =
  | { readonly type: "known"; readonly usd: number }
  | { readonly type: "unknown" };

/** Usage measured from one or more results. */
export interface UsageDelta {
  readonly contextWindow: number | null;
  readonly cost: TurnCost;
  readonly usage: TokenUsage;
}

export const ZERO_USAGE: TokenUsage = {
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

const NO_COUNTERS: Omit<ModelCounters, "model"> = {
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
};

const NANO_USD_PER_USD = 1e9;

/** Rounds a USD amount to whole nano-dollars, so float noise from differencing never shows. */
const roundUsd = (value: number): number => Math.round(value * NANO_USD_PER_USD) / NANO_USD_PER_USD;

const counters = (totals: ModelTotals): ModelCounters => ({
  cacheCreationInputTokens: totals.cacheCreationInputTokens,
  cacheReadInputTokens: totals.cacheReadInputTokens,
  costUsd: totals.costUsd,
  inputTokens: totals.inputTokens,
  model: totals.model,
  outputTokens: totals.outputTokens,
  thinkingTokens: totals.thinkingTokens,
});

const COUNTER_FIELDS = [
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "thinkingTokens",
] as const;

const isZero = (entry: ModelCounters): boolean =>
  COUNTER_FIELDS.every((field) => entry[field] === 0);

/** Whether `current` continues `snapshot`: it holds every model of it with no counter lower. */
function covers(current: ReadonlyMap<string, ModelCounters>, snapshot: UsageSnapshot): boolean {
  return snapshot.every((entry) => {
    const now = current.get(entry.model);
    return now !== undefined && COUNTER_FIELDS.every((field) => now[field] >= entry[field]);
  });
}

const difference = (current: ModelCounters, previous: ModelCounters): ModelCounters => ({
  cacheCreationInputTokens: Math.max(
    0,
    current.cacheCreationInputTokens - previous.cacheCreationInputTokens,
  ),
  cacheReadInputTokens: Math.max(0, current.cacheReadInputTokens - previous.cacheReadInputTokens),
  costUsd: Math.max(0, roundUsd(current.costUsd - previous.costUsd)),
  inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
  model: current.model,
  outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
  thinkingTokens: Math.max(0, current.thinkingTokens - previous.thinkingTokens),
});

/** Neutral counters of SDK figures: `inputTokens` includes cache reads and writes. */
function tokenUsage(figures: {
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly thinkingTokens: number;
}): TokenUsage {
  const input =
    figures.inputTokens + figures.cacheReadInputTokens + figures.cacheCreationInputTokens;
  return {
    cachedInputTokens: figures.cacheReadInputTokens,
    cacheWriteInputTokens: figures.cacheCreationInputTokens,
    inputTokens: input,
    outputTokens: figures.outputTokens,
    reasoningOutputTokens: figures.thinkingTokens,
    totalTokens: input + figures.outputTokens,
  };
}

/** The context size of one model request (`last`). */
export const requestUsage = (figures: RequestFigures): TokenUsage =>
  tokenUsage({ ...figures, thinkingTokens: 0 });

export const addUsage = (left: TokenUsage, right: TokenUsage): TokenUsage => ({
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  cacheWriteInputTokens: (left.cacheWriteInputTokens ?? 0) + (right.cacheWriteInputTokens ?? 0),
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

export function addCost(left: TurnCost, right: TurnCost): TurnCost {
  if (left.type === "none") {
    return right;
  }
  if (right.type === "none") {
    return left;
  }
  if (left.type === "unpriced" || right.type === "unpriced") {
    return { type: "unpriced" };
  }
  return {
    basis: left.basis === "managed" || right.basis === "managed" ? "managed" : "list",
    models: [...new Set([...left.models, ...right.models])],
    type: "priced",
    usd: roundUsd(left.usd + right.usd),
  };
}

/** The cost of the models a result used, from their per-model deltas. */
function resultCost(
  used: readonly { readonly delta: ModelCounters; readonly totals: ModelTotals }[],
): TurnCost {
  let cost: TurnCost = { type: "none" };
  for (const { delta, totals } of used) {
    cost = addCost(
      cost,
      totals.costBasis === "unknown"
        ? { type: "unpriced" }
        : {
            basis: totals.costBasis,
            models: [totals.canonicalModel ?? totals.model],
            type: "priced",
            usd: delta.costUsd,
          },
    );
  }
  return cost;
}

function contextWindowOf(totals: readonly ModelTotals[]): number | null {
  let best: number | null = null;
  for (const entry of totals) {
    if (entry.contextWindow !== null && (best === null || entry.contextWindow > best)) {
      best = entry.contextWindow;
    }
  }
  return best;
}

/** The figures of one result that usage accounting reads. */
export interface ResultFigures {
  /** The result's own main-loop usage (per turn; subagents excluded). */
  readonly mainLoop: RequestFigures | null;
  /** Cumulative per-model totals of the query. */
  readonly totals: readonly ModelTotals[];
}

/**
 * Measures one result's cumulative totals against the baseline. Returns the
 * new baseline and the usage the result adds, or `delta: null` (baseline
 * kept) for a result with zeroed totals.
 */
export function meterResult(
  baseline: UsageBaseline,
  result: ResultFigures,
): { readonly baseline: UsageBaseline; readonly delta: UsageDelta | null } {
  const { totals } = result;
  const current = totals.map(counters);
  if (current.every(isZero)) {
    return { baseline, delta: null };
  }
  if (baseline.type === "unknown") {
    return {
      baseline: { checkpoints: [current], type: "known" },
      delta: {
        contextWindow: contextWindowOf(totals),
        cost: { type: "unpriced" },
        usage: result.mainLoop === null ? ZERO_USAGE : requestUsage(result.mainLoop),
      },
    };
  }
  const byModel = new Map(current.map((entry) => [entry.model, entry] as const));
  const base = baseline.checkpoints.find((snapshot) => covers(byModel, snapshot)) ?? [];
  const previous = new Map(base.map((entry) => [entry.model, entry] as const));
  const used: { readonly delta: ModelCounters; readonly totals: ModelTotals }[] = [];
  let usage = ZERO_USAGE;
  for (const entry of totals) {
    const delta = difference(
      counters(entry),
      previous.get(entry.model) ?? { ...NO_COUNTERS, model: entry.model },
    );
    if (isZero(delta)) {
      continue;
    }
    used.push({ delta, totals: entry });
    usage = addUsage(usage, tokenUsage(delta));
  }
  return {
    baseline: {
      checkpoints: [current, ...baseline.checkpoints].slice(0, MAX_CHECKPOINTS),
      type: "known",
    },
    delta: { contextWindow: contextWindowOf(totals), cost: resultCost(used), usage },
  };
}

/** Usage of two consecutive measurements of one turn. */
export const addDelta = (left: UsageDelta | null, right: UsageDelta): UsageDelta =>
  left === null
    ? right
    : {
        contextWindow: right.contextWindow ?? left.contextWindow,
        cost: addCost(left.cost, right.cost),
        usage: addUsage(left.usage, right.usage),
      };

/** The thread's cost after a turn that cost `turn`. */
export function threadCostAfter(thread: ThreadCost, turn: TurnCost): ThreadCost {
  switch (turn.type) {
    case "none":
      return thread;
    case "unpriced":
      return { type: "unknown" };
    case "priced":
      return thread.type === "known"
        ? { type: "known", usd: roundUsd(thread.usd + turn.usd) }
        : thread;
    default:
      return unreachable(turn);
  }
}

/** The cost `usage.updated` reports for a turn, or `null` when it is not known. */
export function providerCost(turn: TurnCost, thread: ThreadCost): ProviderCost | null {
  if (turn.type !== "priced") {
    return null;
  }
  const [only, ...others] = turn.models;
  return {
    basis: turn.basis,
    model: only === undefined || others.length > 0 ? "mixed" : only,
    threadUsd: thread.type === "known" ? thread.usd : null,
    turnUsd: turn.usd,
  };
}

/** The cost of a thread whose state predates cost tracking. */
export const initialThreadCost = (total: TokenUsage): ThreadCost =>
  total.totalTokens === 0 ? { type: "known", usd: 0 } : { type: "unknown" };
