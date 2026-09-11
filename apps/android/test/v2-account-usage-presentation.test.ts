import { describe, expect, it } from "vitest";

import { accountUsagePresentation } from "../src/v2/features/accounts/accountUsagePresentation";

describe("V2 account usage presentation", () => {
  it("uses the status dot as the active marker and normalizes the plan label", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const accounts = accountUsagePresentation(
      {
        activeProfileId: "profile-pro",
        allExhausted: false,
        kind: "accounts.list",
        profiles: [
          {
            email: "pro@example.test",
            enabled: true,
            exhaustedIndefinitely: false,
            exhaustedUntil: null,
            id: "profile-pro",
            plan: "pro",
            priority: 0,
            rateLimitsFailed: false,
            rateLimitsUpdatedAt: "2026-09-07T11:55:00.000Z",
            weeklyLimit: {
              remainingPercent: 42,
              resetsAt: "2026-09-13T17:20:00.000Z",
            },
          },
        ],
      },
      now,
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      detail: "Pro",
      remainingPercent: 42,
      resetIn: "in 6d 5h",
      state: "active",
    });
    expect(accounts[0]?.detail).not.toContain("active");
  });

  it("uses a stable fallback for a missing plan", () => {
    const accounts = accountUsagePresentation(
      {
        activeProfileId: null,
        allExhausted: false,
        kind: "accounts.list",
        profiles: [
          {
            email: null,
            enabled: true,
            exhaustedIndefinitely: false,
            exhaustedUntil: null,
            id: "profile-free",
            plan: "  ",
            priority: 0,
            rateLimitsFailed: false,
            rateLimitsUpdatedAt: "2026-09-07T11:55:00.000Z",
            weeklyLimit: null,
          },
        ],
      },
      Date.parse("2026-09-07T12:00:00.000Z"),
    );

    expect(accounts[0]?.detail).toBe("Plan unavailable");
    expect(accounts[0]?.state).toBe("inactive");
  });

  it("shows an exhausted active profile as exhausted", () => {
    const accounts = accountUsagePresentation(
      {
        activeProfileId: "profile-exhausted",
        allExhausted: true,
        kind: "accounts.list",
        profiles: [
          {
            email: null,
            enabled: true,
            exhaustedIndefinitely: true,
            exhaustedUntil: null,
            id: "profile-exhausted",
            plan: "pro",
            priority: 0,
            rateLimitsFailed: false,
            rateLimitsUpdatedAt: "2026-09-07T11:55:00.000Z",
            weeklyLimit: null,
          },
        ],
      },
      Date.parse("2026-09-07T12:00:00.000Z"),
    );

    expect(accounts[0]?.state).toBe("exhausted");
  });
});
