import type { GetAccountRateLimitsResponse, RateLimitSnapshot, Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_RATE_LIMITS_REFRESH_MS,
  currentThreadContextUsage,
  currentThreadUsageProjection,
  mergeAccountRateLimits,
  mergeAccountPoolRateLimits,
  accountProfileRateLimitsStale,
  accountRateLimitsStale,
  relativeResetTime,
  selectWeeklyRateLimit,
} from "../src/data/account-rate-limits";

const rateLimit = (overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot => ({
  limitId: "codex",
  limitName: "Codex",
  primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000 },
  secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 3_000 },
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: null,
  rateLimitReachedType: null,
  ...overrides,
});

const response = (snapshot = rateLimit()): GetAccountRateLimitsResponse => ({
  rateLimits: snapshot,
  rateLimitsByLimitId: { codex: snapshot },
  rateLimitResetCredits: null,
});

describe("account rate limits", () => {
  it("selects the weekly window instead of assuming the primary window is weekly", () => {
    const weekly = selectWeeklyRateLimit(response());
    expect(weekly?.window.windowDurationMins).toBe(10_080);
    expect(weekly?.remainingPercent).toBe(60);
  });

  it("does not mislabel a non-weekly window as the weekly allowance", () => {
    const snapshot = rateLimit({ secondary: null });
    expect(selectWeeklyRateLimit(response(snapshot))).toBeNull();
  });

  it("merges sparse rolling updates without clearing unavailable metadata", () => {
    const merged = mergeAccountRateLimits(response(), {
      rateLimits: rateLimit({
        limitName: null,
        primary: { usedPercent: 31, windowDurationMins: null, resetsAt: null },
        secondary: null,
      }),
    });
    expect(merged.rateLimits.limitName).toBe("Codex");
    expect(merged.rateLimits.primary).toEqual({ usedPercent: 31, windowDurationMins: 300, resetsAt: 2_000 });
    expect(merged.rateLimits.secondary?.windowDurationMins).toBe(10_080);
  });

  it("merges the rolling update into the active pool profile without refreshing inactive accounts", () => {
    const pool = {
      activeProfileId: "primary",
      profiles: [
        { id: "primary", email: null, planType: "pro", priority: 0, enabled: true, active: true, exhaustedUntil: null, exhaustedIndefinitely: false, rateLimits: response(), rateLimitsUpdatedAt: 10, rateLimitsError: "stale", lastUsedAt: null },
        { id: "backup", email: null, planType: "pro", priority: 1, enabled: true, active: false, exhaustedUntil: null, exhaustedIndefinitely: false, rateLimits: response(rateLimit({ primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 4_000 } })), rateLimitsUpdatedAt: 20, rateLimitsError: null, lastUsedAt: null },
      ],
      nextResetAt: null,
      allExhausted: false,
    };
    const merged = mergeAccountPoolRateLimits(pool, {
      rateLimits: rateLimit({ primary: { usedPercent: 31, windowDurationMins: null, resetsAt: null } }),
    }, 30);
    expect(merged?.profiles[0]?.rateLimits?.rateLimits.primary?.usedPercent).toBe(31);
    expect(merged?.profiles[0]?.rateLimitsUpdatedAt).toBe(30);
    expect(merged?.profiles[0]?.rateLimitsError).toBeNull();
    expect(merged?.profiles[1]).toBe(pool.profiles[1]);
  });

  it("uses the last model request for active context, not cumulative thread usage", () => {
    const thread = {
      id: "thread",
      turns: [{
        id: "turn",
        codewide: {
          usage: {
            version: 1,
            status: "live",
            latestRequest: { totalTokens: 42_000 },
            turn: { tokens: { totalTokens: 42_000 }, cost: null },
            thread: { tokens: { totalTokens: 180_000 }, cost: null },
            modelContextWindow: 200_000,
          },
        },
      }],
    } as unknown as Thread;
    const usage = currentThreadContextUsage(thread);
    expect(usage).toEqual({ usedTokens: 42_000, totalTokens: 200_000, remainingTokens: 158_000, usedPercent: 21 });
    expect(currentThreadUsageProjection(thread)?.thread.tokens.totalTokens).toBe(180_000);
  });

  it("formats a stable relative reset countdown", () => {
    expect(relativeResetTime(10_000, 10_000_000 - (2 * 24 * 60 + 3 * 60) * 60_000)).toBe("in 2d 3h");
    expect(relativeResetTime(10_000, 10_000_001)).toBe("reset due");
  });

  it("retries an errored refresh even while the previous snapshot is fresh", () => {
    expect(accountRateLimitsStale({
      id: "server",
      connectionId: "server",
      status: "error",
      snapshot: response(),
      error: "offline",
      updatedAt: 9_999,
    }, 10_000)).toBe(true);
  });

  it("refreshes when an enabled fallback account has no usage snapshot", () => {
    expect(accountRateLimitsStale({
      id: "server",
      connectionId: "server",
      status: "ready",
      snapshot: response(),
      accountPool: {
        activeProfileId: "primary",
        profiles: [
          { id: "primary", email: "one@example.com", planType: "pro", priority: 0, enabled: true, active: true, exhaustedUntil: null, exhaustedIndefinitely: false, rateLimits: response(), rateLimitsUpdatedAt: 10, rateLimitsError: null, lastUsedAt: null },
          { id: "backup", email: "two@example.com", planType: "prolite", priority: 1, enabled: true, active: false, exhaustedUntil: null, exhaustedIndefinitely: false, rateLimits: null, rateLimitsUpdatedAt: null, rateLimitsError: null, lastUsedAt: null },
        ],
        nextResetAt: null,
        allExhausted: false,
      },
      error: null,
      updatedAt: 9_999,
    }, 10_000)).toBe(true);
  });

  it("does not present an expired inactive-account snapshot as current", () => {
    const profile = {
      id: "backup",
      email: "two@example.com",
      planType: "pro",
      priority: 1,
      enabled: true,
      active: false,
      exhaustedUntil: null,
      exhaustedIndefinitely: false,
      rateLimits: response(),
      rateLimitsUpdatedAt: 1,
      rateLimitsError: null,
      lastUsedAt: null,
    };
    expect(accountProfileRateLimitsStale(profile, ACCOUNT_RATE_LIMITS_REFRESH_MS + 1_001)).toBe(true);
  });

  it("retries a profile whose last isolated refresh failed", () => {
    const profile = {
      id: "backup",
      email: "two@example.com",
      planType: "pro",
      priority: 1,
      enabled: true,
      active: false,
      exhaustedUntil: null,
      exhaustedIndefinitely: false,
      rateLimits: response(),
      rateLimitsUpdatedAt: 10,
      rateLimitsError: "refresh failed",
      lastUsedAt: null,
    };
    expect(accountProfileRateLimitsStale(profile, 10_001)).toBe(true);
  });
});
