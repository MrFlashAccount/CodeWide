import type {
  AccountRateLimitsUpdatedNotification,
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
  RateLimitWindow,
  Thread,
} from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedTurnMetadata, type TurnUsageProjection } from "@codewide/sync-client";
import type { AccountPoolSnapshot } from "./account-pool";

export const ACCOUNT_RATE_LIMITS_REFRESH_MS = 30 * 60 * 1_000;

export type AccountRateLimitsRow = {
  id: string;
  connectionId: string;
  status: "loading" | "ready" | "error";
  snapshot: GetAccountRateLimitsResponse | null;
  accountPool?: AccountPoolSnapshot | null;
  error: string | null;
  updatedAt: number;
};

export type WeeklyRateLimit = {
  snapshot: RateLimitSnapshot;
  window: RateLimitWindow;
  remainingPercent: number;
};

export type ContextUsage = {
  usedTokens: number;
  totalTokens: number;
  remainingTokens: number;
  usedPercent: number;
};

export function mergeAccountRateLimits(
  previous: GetAccountRateLimitsResponse | null,
  update: AccountRateLimitsUpdatedNotification,
): GetAccountRateLimitsResponse {
  const merged = mergeRateLimitSnapshot(previous?.rateLimits ?? null, update.rateLimits);
  const limitId = merged.limitId;
  const previousBuckets = previous?.rateLimitsByLimitId ?? null;
  const nextBuckets = previousBuckets === null ? null : { ...previousBuckets };
  if (limitId !== null) {
    const bucket = previousBuckets?.[limitId] ?? null;
    const mergedBucket = mergeRateLimitSnapshot(bucket, update.rateLimits);
    if (nextBuckets === null) {
      return {
        rateLimits: merged,
        rateLimitsByLimitId: { [limitId]: mergedBucket },
        rateLimitResetCredits: previous?.rateLimitResetCredits ?? null,
      };
    }
    nextBuckets[limitId] = mergedBucket;
  }
  return {
    rateLimits: merged,
    rateLimitsByLimitId: nextBuckets,
    rateLimitResetCredits: previous?.rateLimitResetCredits ?? null,
  };
}

export function selectWeeklyRateLimit(response: GetAccountRateLimitsResponse | null): WeeklyRateLimit | null {
  if (response === null) return null;
  const snapshots = [
    ...Object.values(response.rateLimitsByLimitId ?? {}).filter((value): value is RateLimitSnapshot => value !== undefined),
    response.rateLimits,
  ];
  for (const snapshot of snapshots) {
    for (const window of [snapshot.primary, snapshot.secondary]) {
      if (window === null || window.windowDurationMins === null) continue;
      if (window.windowDurationMins === 7 * 24 * 60) {
        return { snapshot, window, remainingPercent: remainingPercent(window.usedPercent) };
      }
    }
  }
  return null;
}

export function currentThreadContextUsage(thread: Thread | null | undefined): ContextUsage | null {
  const usage = currentThreadUsageProjection(thread);
  const totalTokens = usage?.modelContextWindow ?? 0;
  if (usage === null || totalTokens <= 0) return null;
  const usedTokens = Math.max(0, usage.latestRequest.totalTokens);
  return {
    usedTokens,
    totalTokens,
    remainingTokens: Math.max(0, totalTokens - usedTokens),
    usedPercent: Math.max(0, Math.min(100, usedTokens / totalTokens * 100)),
  };
}

export function currentThreadUsageProjection(thread: Thread | null | undefined): TurnUsageProjection | null {
  if (thread === null || thread === undefined) return null;
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const usage = projectedTurnMetadata(thread.turns[index]!)?.usage ?? null;
    if (usage !== null) return usage;
  }
  return null;
}

export function accountRateLimitsStale(row: AccountRateLimitsRow | null | undefined, now = Date.now()): boolean {
  if (row === null || row === undefined || row.snapshot === null) return true;
  if (row.status === "error") return true;
  if (row.accountPool?.profiles.some((profile) => profile.enabled && profile.rateLimits === null) === true) return true;
  if (now - row.updatedAt >= ACCOUNT_RATE_LIMITS_REFRESH_MS) return true;
  const weekly = selectWeeklyRateLimit(row.snapshot);
  return weekly?.window.resetsAt !== null && weekly?.window.resetsAt !== undefined
    ? weekly.window.resetsAt * 1_000 <= now
    : false;
}

export function relativeResetTime(resetsAt: number | null, now = Date.now()): string | null {
  if (resetsAt === null) return null;
  const remainingMs = resetsAt * 1_000 - now;
  if (remainingMs <= 0) return "reset due";
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor(totalMinutes % (24 * 60) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

function mergeRateLimitSnapshot(previous: RateLimitSnapshot | null, update: RateLimitSnapshot): RateLimitSnapshot {
  if (previous === null) return structuredClone(update);
  return {
    limitId: update.limitId ?? previous.limitId,
    limitName: update.limitName ?? previous.limitName,
    primary: mergeRateLimitWindow(previous.primary, update.primary),
    secondary: mergeRateLimitWindow(previous.secondary, update.secondary),
    credits: update.credits ?? previous.credits,
    individualLimit: update.individualLimit ?? previous.individualLimit,
    spendControlReached: update.spendControlReached ?? previous.spendControlReached,
    planType: update.planType ?? previous.planType,
    rateLimitReachedType: update.rateLimitReachedType ?? previous.rateLimitReachedType,
  };
}

function mergeRateLimitWindow(previous: RateLimitWindow | null, update: RateLimitWindow | null): RateLimitWindow | null {
  if (update === null) return previous;
  if (previous === null) return structuredClone(update);
  return {
    usedPercent: update.usedPercent,
    windowDurationMins: update.windowDurationMins ?? previous.windowDurationMins,
    resetsAt: update.resetsAt ?? previous.resetsAt,
  };
}

function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}
