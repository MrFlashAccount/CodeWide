import {
  projectedTurnMetadata,
  type TurnUsageProjection,
  type UsageCostProjection,
  type UsageTokenCounts,
} from "@codewide/sync-client";
import type { TimelineItem } from "../timeline/timelineTypes";

type TimelineTurnItem = Extract<TimelineItem, { kind: "turn" }>;

/**
 * Turns drawn as one agent bubble: everything from one user message to the
 * next, i.e. a turn and the turns without a user message that continued it. Each turn keeps its
 * own rows and identity; only the bubble chrome is shared.
 */
export type TurnBubbleGroup = {
  /** The position of this row's turn in `members`. */
  readonly memberIndex: number;
  /** Every turn of the bubble in timeline order; the first is the head. */
  readonly members: readonly TimelineTurnItem[];
};

/**
 * Whether a turn's own answer belongs in the bubble's collapsed history:
 * once the bubble's latest turn has finished, every earlier answer reads as an
 * intermediate update and only the latest answer stays outside, like the
 * commentary of a single turn. While the latest turn runs, earlier answers
 * stay visible.
 */
export function foldsAnswerIntoHistory(
  members: readonly TimelineTurnItem[],
  turn: TimelineTurnItem,
): boolean {
  const tail = members.at(-1);
  return tail !== undefined && tail !== turn && tail.turn.status !== "inProgress";
}

/** The turn whose actions and footer represent the whole bubble. */
export function groupTailTurn(group: TurnBubbleGroup): TimelineTurnItem | undefined {
  return group.members.at(-1);
}

/** Footer facts of a bubble: the time the latest turn ran to and the duration of all of them. */
export function groupFooterFacts(group: TurnBubbleGroup): {
  readonly completedAt: number | null;
  readonly durationMs: number | null;
  readonly usage: TurnUsageProjection | null;
} | null {
  const tail = groupTailTurn(group);
  if (tail === undefined) {
    return null;
  }
  const durations = group.members.flatMap((member) =>
    member.turn.durationMs === null ? [] : [member.turn.durationMs],
  );
  return {
    completedAt: tail.turn.completedAt,
    durationMs: durations.length === 0 ? null : durations.reduce((sum, value) => sum + value, 0),
    usage: combinedTurnUsage(
      group.members.map((member) => projectedTurnMetadata(member.turn)?.usage ?? null),
    ),
  };
}

/**
 * The usage of several turns as one: summed turn tokens and, when every turn
 * was priced the same way, summed cost. The thread scope and context are the
 * latest turn's. Unknown usage of any turn leaves the bubble without usage.
 */
export function combinedTurnUsage(
  usages: readonly (TurnUsageProjection | null)[],
): TurnUsageProjection | null {
  const known = usages.flatMap((usage) => (usage === null ? [] : [usage]));
  const tail = known.at(-1);
  if (tail === undefined || known.length !== usages.length) {
    return null;
  }
  return {
    ...tail,
    turn: {
      cost: combinedCost(known.map((usage) => usage.turn.cost)),
      tokens: known.map((usage) => usage.turn.tokens).reduce(addTokens),
    },
  };
}

function addTokens(left: UsageTokenCounts, right: UsageTokenCounts): UsageTokenCounts {
  return {
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function combinedCost(costs: readonly (UsageCostProjection | null)[]): UsageCostProjection | null {
  const [first, ...rest] = costs;
  if (first === undefined || first === null) {
    return null;
  }
  let total: UsageCostProjection = first;
  for (const cost of rest) {
    const next = cost === null ? null : addCost(total, cost);
    if (next === null) {
      return null;
    }
    total = next;
  }
  return total;
}

const PERCENT = 100;

/** Two costs of the same basis; costs priced differently cannot be summed honestly. */
function addCost(
  left: UsageCostProjection,
  right: UsageCostProjection,
): UsageCostProjection | null {
  const tokens = addCostTokens(left, right);
  if (left.basis === "providerReported" && right.basis === "providerReported") {
    return left.pricingVersion === right.pricingVersion
      ? { ...tokens, basis: "providerReported", pricingVersion: left.pricingVersion }
      : null;
  }
  if (left.basis === "apiEquivalent" && right.basis === "apiEquivalent") {
    return {
      ...tokens,
      basis: "apiEquivalent",
      cachedInputCostUsd: left.cachedInputCostUsd + right.cachedInputCostUsd,
      cacheWriteInputCostUsd: left.cacheWriteInputCostUsd + right.cacheWriteInputCostUsd,
      outputCostUsd: left.outputCostUsd + right.outputCostUsd,
      price: tokens.model === "mixed" ? { cachedInput: 0, input: 0, output: 0 } : left.price,
      pricingVersion: left.pricingVersion,
      uncachedInputCostUsd: left.uncachedInputCostUsd + right.uncachedInputCostUsd,
    };
  }
  return null;
}

/** The token counts and total of two costs; different models read as `mixed`. */
function addCostTokens(left: UsageCostProjection, right: UsageCostProjection) {
  const uncachedInputTokens = left.uncachedInputTokens + right.uncachedInputTokens;
  const cachedInputTokens = left.cachedInputTokens + right.cachedInputTokens;
  const cacheWriteInputTokens = left.cacheWriteInputTokens + right.cacheWriteInputTokens;
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheWriteInputTokens;
  return {
    cachedInputTokens,
    cacheHitPercent: inputTokens === 0 ? 0 : (cachedInputTokens / inputTokens) * PERCENT,
    cacheWriteInputTokens,
    currency: left.currency,
    model: left.model === right.model ? left.model : "mixed",
    outputTokens: left.outputTokens + right.outputTokens,
    totalCostUsd: left.totalCostUsd + right.totalCostUsd,
    uncachedInputTokens,
  };
}
