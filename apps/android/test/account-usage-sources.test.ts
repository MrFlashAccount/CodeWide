import { describe, expect, it } from "vitest";

import type { AccountRateLimitsRow } from "../src/data/account-rate-limits";
import { accountUsageProfiles } from "../src/data/account-usage-presentation";
import { threadListAccountUsageSources } from "../src/data/thread-list-account-usage";

const servers = [
  { id: "mac", name: "Mac" },
  { id: "linux", name: "Linux" },
];

describe("thread list account usage sources", () => {
  it("selects every server for the folded aggregate chat list", () => {
    const mac = rateLimits("mac");
    const sources = threadListAccountUsageSources(servers, null, [mac]);

    expect(sources).toEqual([
      { id: "mac", name: "Mac", rateLimits: mac },
      { id: "linux", name: "Linux", rateLimits: null },
    ]);
  });

  it("keeps only the selected server for the unfolded chat list", () => {
    const mac = rateLimits("mac");
    const linux = rateLimits("linux");

    expect(threadListAccountUsageSources(servers, "linux", [mac, linux])).toEqual([
      { id: "linux", name: "Linux", rateLimits: linux },
    ]);
  });

  it("keeps duplicate profile ids distinct and labels their server", () => {
    const mac = rateLimits("mac", "one@example.com");
    const linux = rateLimits("linux", "two@example.com");
    const profiles = accountUsageProfiles(
      threadListAccountUsageSources(servers, null, [mac, linux]),
    );

    expect(profiles.map((profile) => profile.id)).toEqual([
      '["mac","profile"]',
      '["linux","profile"]',
    ]);
    expect(profiles.map((profile) => [profile.label, profile.detail])).toEqual([
      ["one@example.com · Mac", "Pro"],
      ["two@example.com · Linux", "Pro"],
    ]);
  });

  it.each(["free", "plus", "pro", "pro_x_5", "pro_x_20"])("formats the provided %s plan without adding account status", (planType) => {
    const source = rateLimits("mac", "one@example.com");
    const profile = source.accountPool?.profiles[0];
    if (profile === undefined) throw new Error("Missing test account");
    profile.planType = planType;
    const [account] = accountUsageProfiles([{ id: "mac", name: "Mac", rateLimits: source }]);
    expect(account?.label).toBe("one@example.com");
    expect(account?.detail).toBe(({ free: "Free", plus: "Plus", pro: "Pro", pro_x_5: "Pro X 5", pro_x_20: "Pro X 20" })[planType]);
  });
});

function rateLimits(connectionId: string, email?: string): AccountRateLimitsRow {
  return {
    accountPool: email === undefined ? null : {
      activeProfileId: "profile",
      allExhausted: false,
      nextResetAt: null,
      profiles: [
        {
          active: true,
          email,
          enabled: true,
          exhaustedIndefinitely: false,
          exhaustedUntil: null,
          id: "profile",
          lastUsedAt: null,
          planType: "Pro",
          priority: 0,
          rateLimits: null,
          rateLimitsError: null,
          rateLimitsUpdatedAt: null,
        },
      ],
    },
    connectionId,
    error: null,
    id: connectionId,
    snapshot: null,
    status: "loading",
    updatedAt: 0,
  };
}
