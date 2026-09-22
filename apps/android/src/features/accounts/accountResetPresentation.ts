import type { RateLimitResetCredit } from "@codewide/codex-protocol/v0.155.1/v2";
import type { AccountPoolProfile } from "../../data/account-pool";
import {
  relativeResetTime,
  type AccountRateLimitResetWindow,
} from "../../data/account-rate-limits";
import { colors } from "../../theme";

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY;
const NO_CREDITS = 0n;
const PERCENT_MAX = 100;
const PERCENT_MIN = 0;
const LOW_REMAINING_PERCENT = 15;

export type AccountBankedResets = {
  availableCount: bigint;
  credits: RateLimitResetCredit[];
  undisclosedCount: bigint;
};

export function accountResetWindowLabel(window: AccountRateLimitResetWindow): string {
  if (window.slot === "availability") {
    return "Availability";
  }
  return durationWindowLabel(window.durationMins, window.slot);
}

export function accountResetWindowRemainingPercent(
  window: AccountRateLimitResetWindow,
): number | null {
  return window.usedPercent === null
    ? null
    : Math.max(PERCENT_MIN, Math.min(PERCENT_MAX, PERCENT_MAX - window.usedPercent));
}

export function accountLimitProgressColor(remainingPercent: number | null): string {
  return remainingPercent !== null && remainingPercent < LOW_REMAINING_PERCENT
    ? colors.amber
    : colors.text;
}

export function accountBankedResets(profile: AccountPoolProfile): AccountBankedResets {
  const summary = profile.rateLimits?.rateLimitResetCredits;
  if (summary === null || summary === undefined) {
    return emptyBankedResets();
  }
  const availableCount = nonNegativeCount(summary.availableCount);
  const credits = (summary.credits ?? [])
    .filter((credit) => credit.status !== "redeemed")
    .sort(compareResetCreditExpiry);
  const disclosedCount = BigInt(credits.length);
  return {
    availableCount,
    credits,
    undisclosedCount:
      availableCount > disclosedCount ? availableCount - disclosedCount : NO_CREDITS,
  };
}

export function accountBankedResetSummary(profile: AccountPoolProfile): string | null {
  const { availableCount } = accountBankedResets(profile);
  return availableCount > NO_CREDITS ? `Reset ×${String(availableCount)}` : null;
}

export function accountResetCreditTitle(credit: RateLimitResetCredit): string {
  const title = credit.title?.trim();
  if (title !== undefined && title.length > 0) {
    return title;
  }
  return credit.resetType === "codexRateLimits" ? "Codex rate-limit reset" : "Banked reset";
}

export function accountResetCreditExpiry(expiresAt: number | null, now: number): string {
  if (expiresAt === null) {
    return "Does not expire";
  }
  const relative = relativeResetTime(expiresAt, now);
  return relative === "reset due" ? "Expired" : `Expires ${relative ?? "soon"}`;
}

function compareResetCreditExpiry(left: RateLimitResetCredit, right: RateLimitResetCredit): number {
  const expiryDifference = expirySortValue(left.expiresAt) - expirySortValue(right.expiresAt);
  if (expiryDifference !== 0) {
    return expiryDifference;
  }
  const grantDifference = left.grantedAt - right.grantedAt;
  return grantDifference === 0 ? left.id.localeCompare(right.id) : grantDifference;
}

function expirySortValue(expiresAt: number | null): number {
  return expiresAt ?? Number.POSITIVE_INFINITY;
}

function emptyBankedResets(): AccountBankedResets {
  return { availableCount: NO_CREDITS, credits: [], undisclosedCount: NO_CREDITS };
}

function nonNegativeCount(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value > NO_CREDITS ? value : NO_CREDITS;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value);
  }
  return NO_CREDITS;
}

function durationWindowLabel(durationMins: number | null, slot: "primary" | "secondary"): string {
  if (durationMins === null) {
    return slot === "primary" ? "Primary" : "Secondary";
  }
  if (durationMins === MINUTES_PER_WEEK) {
    return "Weekly";
  }
  if (durationMins === MINUTES_PER_DAY) {
    return "Daily";
  }
  return scaledDurationWindowLabel(durationMins);
}

function scaledDurationWindowLabel(durationMins: number): string {
  if (durationMins % MINUTES_PER_DAY === 0) {
    return `${String(durationMins / MINUTES_PER_DAY)}-day`;
  }
  if (durationMins % MINUTES_PER_HOUR === 0) {
    return durationMins === MINUTES_PER_HOUR
      ? "Hourly"
      : `${String(durationMins / MINUTES_PER_HOUR)}-hour`;
  }
  return `${String(durationMins)}-minute`;
}
