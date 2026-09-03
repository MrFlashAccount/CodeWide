import type { V2TurnUsage, V2TurnView } from "@codewide/sync-client/v2";

import type {
  UsageBreakdownViewModel,
  UsageContextViewModel,
  UsageSessionViewModel,
} from "../../presentation/usage/usageTypes";

export interface UsagePresentationInput {
  turns: readonly V2TurnView[];
}

export interface UsagePresentation {
  breakdown: UsageBreakdownViewModel | null;
  context: UsageContextViewModel | null;
  session: UsageSessionViewModel | null;
}

interface UsageBreakdownInput {
  usage: V2TurnUsage;
}

/**
 * Adapts the latest authoritative V2 usage snapshot without inventing a
 * per-category cost split that the protocol does not provide.
 */
export function usagePresentation(input: UsagePresentationInput): UsagePresentation {
  const usage = latestTurnUsage(input.turns);
  if (usage === null) return { breakdown: null, context: null, session: null };
  const breakdown = usageBreakdownPresentation({ usage });
  return {
    breakdown,
    context: breakdown.context,
    session: breakdown.session,
  };
}

function usageBreakdownPresentation(input: UsageBreakdownInput): UsageBreakdownViewModel {
  const { usage } = input;
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const threadUncachedInputTokens = Math.max(
    0,
    usage.threadInputTokens - usage.threadCachedInputTokens,
  );
  return {
    cacheHit: usage.cacheHit,
    compactions: usage.threadCompactionCount,
    context: contextUsagePresentation(usage),
    model: usage.model,
    session: {
      cachedInputTokens: usage.threadCachedInputTokens,
      cacheWriteInputTokens: usage.threadCacheWriteInputTokens,
      compactions: usage.threadCompactionCount,
      costUsd: usage.threadTotalCostUsd,
      inputTokens: usage.threadInputTokens,
      outputTokens: usage.threadOutputTokens,
      reasoningOutputTokens: usage.threadReasoningOutputTokens,
      totalTokens: usage.threadTotalTokens,
      uncachedInputTokens: threadUncachedInputTokens,
    },
    status: usage.status,
    turn: {
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      costUsd: usage.totalCostUsd,
      inputTokens: usage.inputTokens,
      latestRequestTokens: usage.latestRequestTokens,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: usage.reasoningOutputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      uncachedInputTokens,
    },
  };
}

export function latestTurnUsage(turns: readonly V2TurnView[]): V2TurnUsage | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const usage = turns[index]?.usage;
    if (usage !== null && usage !== undefined) return usage;
  }
  return null;
}

function contextUsagePresentation(usage: V2TurnUsage): UsageContextViewModel | null {
  if (usage.modelContextWindow === null || usage.modelContextWindow <= 0) return null;
  const totalTokens = usage.modelContextWindow;
  const usedTokens = Math.min(totalTokens, Math.max(0, usage.latestRequestTokens));
  return {
    availableTokens: totalTokens - usedTokens,
    model: usage.model,
    percent: (usedTokens / totalTokens) * 100,
    totalTokens,
    usedTokens,
  };
}
