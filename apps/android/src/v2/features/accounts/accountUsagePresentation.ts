import type { V2QueryResult } from "@codewide/sync-client/v2";

import type { UsageAccountViewModel } from "../../presentation/usage/UsagePopoverView";

export function accountUsagePresentation(
  result: V2QueryResult | null,
  now: number,
): UsageAccountViewModel[] {
  if (result?.kind !== "accounts.list") return [];
  return result.profiles.map((profile) => {
    const resetTimestamp = profile.exhaustedUntil ?? profile.weeklyLimit?.resetsAt ?? null;
    const stale = rateLimitStale(
      profile.rateLimitsUpdatedAt,
      profile.rateLimitsFailed,
      resetTimestamp,
      now,
    );
    const limitState = accountLimitState(
      profile.enabled,
      profile.exhaustedIndefinitely,
      profile.weeklyLimit !== null,
      stale,
    );
    const exhausted = profile.exhaustedUntil !== null || profile.exhaustedIndefinitely;
    return {
      detail: formatPlan(profile.plan),
      enabled: profile.enabled,
      id: profile.id,
      label: profile.email ?? "Account",
      limitState,
      remainingPercent:
        limitState === "ready" ? (profile.weeklyLimit?.remainingPercent ?? null) : null,
      resetAt:
        limitState === "ready" && resetTimestamp !== null ? formatReset(resetTimestamp) : null,
      resetIn:
        limitState === "ready" && resetTimestamp !== null
          ? relativeReset(resetTimestamp, now)
          : null,
      state: exhausted
        ? "exhausted"
        : profile.id === result.activeProfileId
          ? "active"
          : "inactive",
    };
  });
}

function formatPlan(plan: string | null): string {
  const normalized = plan?.trim();
  if (normalized === undefined || normalized.length === 0) return "Plan unavailable";
  return `${normalized.charAt(0).toLocaleUpperCase()}${normalized.slice(1)}`;
}

function accountLimitState(
  enabled: boolean,
  exhaustedIndefinitely: boolean,
  hasWeeklyLimit: boolean,
  stale: boolean,
): UsageAccountViewModel["limitState"] {
  if (!enabled) return "disabled";
  if (stale) return "refreshRequired";
  if (!hasWeeklyLimit) return exhaustedIndefinitely ? "limitReached" : "unavailable";
  return "ready";
}

function rateLimitStale(
  updatedAt: string | null,
  failed: boolean,
  resetsAt: string | null,
  now: number,
): boolean {
  if (updatedAt === null || failed) return true;
  const observed = Date.parse(updatedAt);
  if (!Number.isFinite(observed) || now - observed >= 30 * 60 * 1000) return true;
  if (resetsAt === null) return false;
  const reset = Date.parse(resetsAt);
  return Number.isFinite(reset) && reset <= now;
}

function formatReset(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function relativeReset(value: string, now: number): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const remainingMs = timestamp - now;
  if (remainingMs <= 0) return "reset due";
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}
