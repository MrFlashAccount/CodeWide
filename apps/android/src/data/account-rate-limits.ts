import type {
  AccountRateLimitsUpdatedNotification,
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
  RateLimitWindow,
  Thread,
} from "@codewide/codex-protocol/v0.155.1/v2";
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

export type AccountRateLimitResetWindow = {
  durationMins: number | null;
  resetsAt: number;
  slot: "availability" | "primary" | "secondary";
  usedPercent: number | null;
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
        accountId: previous?.accountId ?? null,
        ordinaryUsageAllowed: previous?.ordinaryUsageAllowed ?? null,
        rateLimitResetCredits: previous?.rateLimitResetCredits ?? null,
        rateLimits: merged,
        rateLimitsByLimitId: { [limitId]: mergedBucket },
        rateLimitUpsell: previous?.rateLimitUpsell ?? null,
      };
    }
    nextBuckets[limitId] = mergedBucket;
  }
  return {
    accountId: previous?.accountId ?? null,
    ordinaryUsageAllowed: previous?.ordinaryUsageAllowed ?? null,
    rateLimitResetCredits: previous?.rateLimitResetCredits ?? null,
    rateLimits: merged,
    rateLimitsByLimitId: nextBuckets,
    rateLimitUpsell: previous?.rateLimitUpsell ?? null,
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
  for (const snapshot of rateLimitCandidates(response)) {
    const weekly = weeklyRateLimit(snapshot);
    if (weekly !== null) {
      return weekly;
    }
  }
  return null;
}

/** Prefers the metered allowance tier when it is more specific than the account summary. */
export function selectAccountRateLimitPlanType(
  response: GetAccountRateLimitsResponse | null,
): string | null {
  if (response === null) {
    return null;
  }
  let fallback: string | null = null;
  for (const snapshot of rateLimitCandidates(response)) {
    const planType = snapshot.planType;
    if (planType === null || planType === "unknown") {
      continue;
    }
    if (planType.startsWith("pro_x_")) {
      return planType;
    }
    fallback ??= planType;
  }
  return fallback;
}

/** Reset-bearing windows from the canonical Codex allowance plus pool availability. */
export function accountRateLimitResetWindows(
  profile: AccountPoolProfile,
): AccountRateLimitResetWindow[] {
  const windows = profile.rateLimits === null ? [] : canonicalResetWindows(profile.rateLimits);
  const exhaustedUntil = profile.exhaustedUntil;
  if (exhaustedUntil !== null && !windows.some((window) => window.resetsAt === exhaustedUntil)) {
    windows.push({
      durationMins: null,
      resetsAt: exhaustedUntil,
      slot: "availability",
      usedPercent: null,
    });
  }
  windows.sort((left, right) => left.resetsAt - right.resetsAt);
  return windows;
}

function canonicalResetWindows(
  response: GetAccountRateLimitsResponse,
): AccountRateLimitResetWindow[] {
  for (const snapshot of rateLimitCandidates(response)) {
    const windows = resetWindows(snapshot);
    if (windows.length > 0) {
      return windows;
    }
  }
  return [];
}

function resetWindows(snapshot: RateLimitSnapshot): AccountRateLimitResetWindow[] {
  const windows: AccountRateLimitResetWindow[] = [];
  for (const [slot, window] of [
    ["primary", snapshot.primary],
    ["secondary", snapshot.secondary],
  ] as const) {
    if (window?.resetsAt === null || window?.resetsAt === undefined) {
      continue;
    }
    windows.push({
      durationMins: window.windowDurationMins,
      resetsAt: window.resetsAt,
      slot,
      usedPercent: window.usedPercent,
    });
  }
  return windows;
}

function rateLimitCandidates(response: GetAccountRateLimitsResponse): RateLimitSnapshot[] {
  const candidates = [response.rateLimits];
  const canonicalLimitId = response.rateLimits.limitId;
  if (canonicalLimitId !== null) {
    const matching = response.rateLimitsByLimitId?.[canonicalLimitId];
    if (matching !== undefined && matching !== response.rateLimits) {
      candidates.push(matching);
    }
  }
  if (canonicalLimitId !== "codex") {
    const codex = response.rateLimitsByLimitId?.codex;
    if (codex !== undefined && !candidates.includes(codex)) {
      candidates.push(codex);
    }
  }
  return candidates;
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
    normalModelSlug: update.normalModelSlug ?? previous.normalModelSlug ?? null,
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
