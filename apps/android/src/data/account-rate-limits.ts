import type {
  AccountRateLimitsUpdatedNotification,
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
  RateLimitWindow,
  Thread,
} from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedTurnMetadata, type TurnUsageProjection } from "@codewide/sync-client";
import { cloneProtocolValue } from "./clone-protocol-value";
import type { AccountPoolProfile, AccountPoolSnapshot } from "./account-pool";

export const ACCOUNT_RATE_LIMITS_REFRESH_MS = 30 * 60 * 1000;

export type AccountRateLimitsRow = {
  accountPool?: AccountPoolSnapshot | null;
  connectionId: string;
  error: string | null;
  id: string;
  snapshot: GetAccountRateLimitsResponse | null;
  status: "loading" | "ready" | "error";
  updatedAt: number;
};

export type WeeklyRateLimit = {
  remainingPercent: number;
  snapshot: RateLimitSnapshot;
  window: RateLimitWindow;
};

export type ContextUsage = {
  remainingTokens: number;
  totalTokens: number;
  usedPercent: number;
  usedTokens: number;
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
        rateLimitResetCredits: previous?.rateLimitResetCredits ?? null,
        rateLimits: merged,
        rateLimitsByLimitId: { [limitId]: mergedBucket },
      };
    }
    nextBuckets[limitId] = mergedBucket;
  }
  return {
    rateLimitResetCredits: previous?.rateLimitResetCredits ?? null,
    rateLimits: merged,
    rateLimitsByLimitId: nextBuckets,
  };
}

export function mergeAccountPoolRateLimits(
  previous: AccountPoolSnapshot | null | undefined,
  update: AccountRateLimitsUpdatedNotification,
  updatedAtSeconds = Math.floor(Date.now() / 1000),
): AccountPoolSnapshot | null {
  if (previous === null || previous === undefined || previous.activeProfileId === null) {
    return previous ?? null;
  }
  let changed = false;
  const profiles = previous.profiles.map((profile) => {
    if (profile.id !== previous.activeProfileId) {
      return profile;
    }
    changed = true;
    return {
      ...profile,
      rateLimits: mergeAccountRateLimits(profile.rateLimits, update),
      rateLimitsError: null,
      rateLimitsUpdatedAt: updatedAtSeconds,
    };
  });
  // WHY: The active profile match is discovered inside Array.map; TypeScript does not propagate that callback mutation to this scope.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return changed ? { ...previous, profiles } : previous;
}

export function selectWeeklyRateLimit(
  response: GetAccountRateLimitsResponse | null,
): WeeklyRateLimit | null {
  if (response === null) {
    return null;
  }
  const canonical = weeklyRateLimit(response.rateLimits);
  if (canonical !== null) {
    return canonical;
  }

  const canonicalLimitId = response.rateLimits.limitId;
  if (canonicalLimitId !== null) {
    const canonicalBucket = response.rateLimitsByLimitId?.[canonicalLimitId];
    if (canonicalBucket !== undefined) {
      const matching = weeklyRateLimit(canonicalBucket);
      if (matching !== null) {
        return matching;
      }
    }
  }

  if (canonicalLimitId !== "codex") {
    const codexBucket = response.rateLimitsByLimitId?.codex;
    if (codexBucket !== undefined) {
      return weeklyRateLimit(codexBucket);
    }
  }
  return null;
}

function weeklyRateLimit(snapshot: RateLimitSnapshot): WeeklyRateLimit | null {
  for (const window of [snapshot.primary, snapshot.secondary]) {
    if (window === null || window.windowDurationMins === null) {
      continue;
    }
    if (window.windowDurationMins === 7 * 24 * 60) {
      return { remainingPercent: remainingPercent(window.usedPercent), snapshot, window };
    }
  }
  return null;
}

export function currentThreadContextUsage(thread: Thread | null | undefined): ContextUsage | null {
  return contextUsageFromProjection(currentThreadUsageProjection(thread));
}

export function contextUsageFromProjection(usage: TurnUsageProjection | null): ContextUsage | null {
  const totalTokens = usage?.modelContextWindow ?? 0;
  if (usage === null || totalTokens <= 0) {
    return null;
  }
  const usedTokens = Math.max(0, usage.latestRequest.totalTokens);
  return {
    remainingTokens: Math.max(0, totalTokens - usedTokens),
    totalTokens,
    usedPercent: Math.max(0, Math.min(100, (usedTokens / totalTokens) * 100)),
    usedTokens,
  };
}

export function currentThreadUsageProjection(
  thread: Thread | null | undefined,
): TurnUsageProjection | null {
  if (thread === null || thread === undefined) {
    return null;
  }
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn === undefined) {
      continue;
    }
    const usage = projectedTurnMetadata(turn)?.usage ?? null;
    if (usage !== null) {
      return usage;
    }
  }
  return null;
}

export function accountRateLimitsStale(
  row: AccountRateLimitsRow | null | undefined,
  now = Date.now(),
): boolean {
  if (row === null || row === undefined || row.snapshot === null) {
    return true;
  }
  if (row.status === "error") {
    return true;
  }
  if (
    row.accountPool === null ||
    row.accountPool === undefined ||
    row.accountPool.profiles.length === 0
  ) {
    return true;
  }
  if (
    row.accountPool.profiles.some(
      (profile) => profile.enabled && accountProfileRateLimitsStale(profile, now),
    )
  ) {
    return true;
  }
  if (now - row.updatedAt >= ACCOUNT_RATE_LIMITS_REFRESH_MS) {
    return true;
  }
  const weekly = selectWeeklyRateLimit(row.snapshot);
  return weekly?.window.resetsAt !== null && weekly?.window.resetsAt !== undefined
    ? weekly.window.resetsAt * 1000 <= now
    : false;
}

export function accountProfileRateLimitsStale(
  profile: AccountPoolProfile,
  now = Date.now(),
): boolean {
  if (
    profile.rateLimits === null ||
    profile.rateLimitsUpdatedAt === null ||
    profile.rateLimitsError !== null
  ) {
    return true;
  }
  if (now - profile.rateLimitsUpdatedAt * 1000 >= ACCOUNT_RATE_LIMITS_REFRESH_MS) {
    return true;
  }
  const weekly = selectWeeklyRateLimit(profile.rateLimits);
  return weekly?.window.resetsAt !== null && weekly?.window.resetsAt !== undefined
    ? weekly.window.resetsAt * 1000 <= now
    : false;
}

export function relativeResetTime(resetsAt: number | null, now = Date.now()): string | null {
  if (resetsAt === null) {
    return null;
  }
  const remainingMs = resetsAt * 1000 - now;
  if (remainingMs <= 0) {
    return "reset due";
  }
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `in ${String(days)}d${hours > 0 ? ` ${String(hours)}h` : ""}`;
  }
  if (hours > 0) {
    return `in ${String(hours)}h${minutes > 0 ? ` ${String(minutes)}m` : ""}`;
  }
  return `in ${String(minutes)}m`;
}

function mergeRateLimitSnapshot(
  previous: RateLimitSnapshot | null,
  update: RateLimitSnapshot,
): RateLimitSnapshot {
  if (previous === null) {
    return cloneProtocolValue(update);
  }
  return {
    credits: update.credits ?? previous.credits,
    individualLimit: update.individualLimit ?? previous.individualLimit,
    limitId: update.limitId ?? previous.limitId,
    limitName: update.limitName ?? previous.limitName,
    planType: update.planType ?? previous.planType,
    primary: mergeRateLimitWindow(previous.primary, update.primary),
    rateLimitReachedType: update.rateLimitReachedType ?? previous.rateLimitReachedType,
    secondary: mergeRateLimitWindow(previous.secondary, update.secondary),
    spendControlReached: update.spendControlReached ?? previous.spendControlReached,
  };
}

function mergeRateLimitWindow(
  previous: RateLimitWindow | null,
  update: RateLimitWindow | null,
): RateLimitWindow | null {
  if (update === null) {
    return previous;
  }
  if (previous === null) {
    return cloneProtocolValue(update);
  }
  return {
    resetsAt: update.resetsAt ?? previous.resetsAt,
    usedPercent: update.usedPercent,
    windowDurationMins: update.windowDurationMins ?? previous.windowDurationMins,
  };
}

function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}
