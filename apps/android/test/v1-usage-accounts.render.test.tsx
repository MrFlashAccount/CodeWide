import { describe, expect, it } from "@jest/globals";

import type { AccountPoolProfile } from "../src/data/account-pool";
import type { AccountUsageSource } from "../src/data/account-usage-presentation";
import { parseAgentProvidersResult, type AgentProvidersState } from "../src/data/agentProviders";
import { usageAccountRows } from "../src/features/accounts/usageAccounts";

const servers = [
  { iconId: "desktop", id: "buddy", name: "Buddy" },
  { iconId: "laptop", id: "laptop", name: "Laptop" },
] as const;

function profile(email: string, active: boolean): AccountPoolProfile {
  return {
    active,
    email,
    enabled: true,
    exhaustedIndefinitely: false,
    exhaustedUntil: null,
    id: email,
    lastUsedAt: null,
    planType: "pro",
    priority: 0,
    rateLimits: null,
    rateLimitsError: null,
    rateLimitsUpdatedAt: null,
  };
}

function source(id: string, profiles: readonly AccountPoolProfile[]): AccountUsageSource {
  return {
    id,
    name: id,
    rateLimits: {
      accountPool: {
        activeProfileId: null,
        allExhausted: false,
        nextResetAt: null,
        profiles: [...profiles],
      },
      connectionId: id,
      error: null,
      id,
      snapshot: null,
      status: "ready",
      updatedAt: 0,
    },
  };
}

function providers(claude: Record<string, unknown>): AgentProvidersState {
  const value = parseAgentProvidersResult({
    hostCapabilities: {},
    providers: [
      { auth: "unknown", capabilities: { "accounts.pool": true }, id: "codex", name: "Codex", planLabel: null, primary: true, status: "live" },
      { auth: "authenticated", capabilities: {}, id: "claude", name: "Claude", planLabel: "max", primary: false, status: "live", ...claude },
    ],
  });
  if (value === null) throw new Error("fixture must parse");
  return { status: "ready", value };
}

describe("usage account rows", () => {
  it("shows one row per account, listing every server it is signed in on", () => {
    const rows = usageAccountRows(
      [
        source("buddy", [profile("dev@example.com", true), profile("other@example.com", false)]),
        source("laptop", [profile("DEV@example.com", false)]),
      ],
      servers,
      { buddy: providers({ accountLabel: null, auth: "unauthenticated" }), laptop: providers({ accountLabel: null, auth: "unauthenticated" }) },
    );
    // One row per account; an account on every listed server shows no server icons.
    expect(rows.map((row) => [row.label, row.provider?.id, row.servers.map((server) => server.id)])).toEqual([
      ["dev@example.com", "codex", []],
      ["other@example.com", "codex", ["buddy"]],
      ["Claude account", "claude", ["buddy"]],
      ["Claude account", "claude", ["laptop"]],
    ]);
    // The active server's row represents the account.
    expect(rows[0]?.active).toBe(true);
    // A provider signed out on the server is a problem with that account.
    expect(rows[2]?.value).toEqual({ kind: "note", text: "Signed out", tone: "problem" });
  });

  it("lists a provider's sign-in without an account pool, with its weekly limit", () => {
    const rows = usageAccountRows([], servers, {
      buddy: providers({
        accountLabel: "me@example.com",
        rateLimits: {
          updatedAt: 1,
          windows: [{ id: "seven_day", kind: "weekly", label: "Weekly", resetsAt: 2_000_000_000, status: "allowed", usedPercent: 40, windowDurationMins: 10_080 }],
        },
      }),
      laptop: providers({ accountLabel: "me@example.com", rateLimits: null }),
    });
    const accounts = rows.filter((row) => row.provider?.id === "claude");
    expect(accounts).toEqual([
      expect.objectContaining({
        label: "me@example.com",
        plan: "Max",
        provider: { id: "claude", name: "Claude" },
        servers: [],
        value: { fiveHour: null, kind: "remaining", weekly: 60 },
      }),
    ]);
  });
});
