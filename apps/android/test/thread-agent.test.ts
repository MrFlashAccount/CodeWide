import { describe, expect, it, vi } from "vitest";

import {
  normalizeStoredThreadSummary,
  type StoredThreadSummary,
} from "../src/data/thread-summary-types";
import { projectThreadSummarySnapshot } from "../src/data/thread-summary-projection";
import {
  parseAgentProviderId,
  readThreadAgent,
  threadAgentSupports,
  type AgentProviderId,
} from "../src/data/threadAgent";
import type { TurnControlsValue } from "../src/data/turn-controls-types";
import {
  permissionRowWithProviders,
  primaryProviderModels,
} from "../src/data/turnControlsAgentProviders";
import {
  decodeVoiceAssistantBackgroundModelPreference,
  resolveVoiceAssistantBackgroundModel,
} from "../src/data/voiceAssistantBackgroundModel";
import { storedThreadToListItem } from "../src/features/threadList/threadListProjection";
import { providerScopedControls } from "../src/features/composer/settings/providerScopedControls";
import {
  threadAgentAccounts,
  threadAgentActions,
} from "../src/features/conversation/threadAgentActions";
import { summary } from "./fixtures/thread-summary";
import { createV1TestThread } from "./fixtures/v1Thread";

function provider(id: string): AgentProviderId {
  const parsed = parseAgentProviderId(id);
  if (parsed === null) {
    throw new Error(`Invalid provider fixture ${id}`);
  }
  return parsed;
}

const claudeThread = {
  codewideAgent: {
    capabilities: {
      review: false,
      "threads.compact": true,
      "turns.startWhileActive": "busy",
      "turns.steer": true,
    },
    primary: false,
    provider: "claude",
    providerName: "Claude",
  },
};

describe("thread agent descriptor", () => {
  it("reads declared capabilities from either wire form and treats a missing descriptor as legacy Codex", () => {
    expect(readThreadAgent(claudeThread)).toEqual({
      capabilities: ["threads.compact", "turns.startWhileActive", "turns.steer"],
      primary: false,
      provider: "claude",
      providerName: "Claude",
    });
    expect(
      readThreadAgent({
        codewideAgent: { capabilities: ["goals", "review", 3], provider: "codex" },
      }),
    ).toEqual({ capabilities: ["goals", "review"], primary: true, provider: "codex", providerName: "codex" });
    expect(
      readThreadAgent({
        codewideAgent: { capabilities: { review: false, fork: null }, provider: "x", providerName: " " },
      }),
    ).toEqual({ capabilities: [], primary: true, provider: "x", providerName: "x" });
    expect(readThreadAgent({})).toBeNull();
    expect(readThreadAgent({ codewideAgent: null })).toBeNull();
    expect(threadAgentSupports(null, "review")).toBe(true);
    expect(threadAgentSupports(readThreadAgent(claudeThread), "review")).toBe(false);
    expect(threadAgentSupports(readThreadAgent(claudeThread), "threads.compact")).toBe(true);
  });

  it("reads a malformed descriptor as an agent without capabilities, not as legacy Codex", () => {
    expect(readThreadAgent({ codewideAgent: { capabilities: [], provider: "" } })).toEqual({
      capabilities: [],
      primary: true,
      provider: null,
      providerName: "Agent",
    });
    const missingCapabilities = readThreadAgent({
      codewideAgent: { primary: false, provider: "claude", providerName: "Claude" },
    });
    expect(missingCapabilities).toEqual({
      capabilities: [],
      primary: false,
      provider: "claude",
      providerName: "Claude",
    });
    expect(threadAgentSupports(missingCapabilities, "review")).toBe(false);
    expect(threadAgentSupports(readThreadAgent({ codewideAgent: "codex" }), "goals")).toBe(false);
    const scoped = providerScopedControls(mixedControls, false, {
      codewideAgent: { provider: 7 },
    });
    expect(scoped.models.map((row) => row.id)).toEqual(["unannotated"]);
    expect(scoped.permissions).toEqual([]);
  });

  it("persists the descriptor with the summary and keeps older rows legacy", () => {
    const thread = { ...createV1TestThread("thread", null, 1, []), ...claudeThread };
    const projected = projectThreadSummarySnapshot("server", thread, false);
    expect(projected.codewideAgent?.provider).toBe("claude");
    const restored = normalizeStoredThreadSummary(
      // WHY: simulates the JSON payload round trip of the SQLite cache owner.
      JSON.parse(JSON.stringify(projected)) as StoredThreadSummary,
    );
    expect(restored.codewideAgent).toEqual(projected.codewideAgent);
    expect(normalizeStoredThreadSummary(summary("old")).codewideAgent).toBeNull();
    const refreshedWithoutDescriptor = projectThreadSummarySnapshot(
      "server",
      createV1TestThread("thread", null, 2, []),
      false,
      projected,
    );
    expect(refreshedWithoutDescriptor.codewideAgent).toEqual(projected.codewideAgent);
  });
});

function model(id: string, providerId: string | null, isDefault = false) {
  return {
    defaultEffort: "high",
    efforts: ["high"],
    id,
    isDefault,
    label: id,
    provider: providerId === null ? null : provider(providerId),
    supportsPersonality: false,
  };
}

const mixedControls: TurnControlsValue = {
  defaults: { effort: null, model: null, permissions: null, serviceTier: null },
  models: [model("gpt", "codex", true), model("sonnet", "claude"), model("unannotated", null)],
  permissions: [
    permissionRowWithProviders({
      allowed: true,
      description: null,
      id: ":workspace",
      // WHY: the extension field is outside the generated App Server summary type.
      ...({ codewideAgentProviders: ["codex", "claude"] } as object),
    }),
    permissionRowWithProviders({
      allowed: true,
      description: null,
      id: ":custom",
      ...({ codewideAgentProviders: ["codex"] } as object),
    }),
  ],
  skills: [{ catalog: "user", description: "", name: "skill", path: "/skill" }] as TurnControlsValue["skills"],
};

describe("provider-scoped catalogs", () => {
  it("offers only the bound provider's models and profiles in an existing thread", () => {
    const scoped = providerScopedControls(mixedControls, false, claudeThread);
    expect(scoped.models.map((row) => row.id)).toEqual(["sonnet", "unannotated"]);
    expect(scoped.permissions.map((row) => row.id)).toEqual([":workspace"]);
    expect(scoped.skills).toEqual([]);
  });

  it("keeps the full catalog for a new chat and a legacy thread", () => {
    expect(providerScopedControls(mixedControls, true, claudeThread)).toBe(mixedControls);
    expect(providerScopedControls(mixedControls, false, createV1TestThread("t", null, 1, []))).toBe(
      mixedControls,
    );
  });

  it("restricts the hidden supervisor thread to the primary provider's models", () => {
    expect(primaryProviderModels(mixedControls.models).map((row) => row.id)).toEqual([
      "gpt",
      "unannotated",
    ]);
    const preference = decodeVoiceAssistantBackgroundModelPreference(
      '{"schemaVersion":2,"status":"selected","model":"sonnet","effort":"high"}',
    );
    expect(resolveVoiceAssistantBackgroundModel(preference, mixedControls.models)).toEqual({
      effort: "high",
      model: "gpt",
      status: "fallback",
    });
  });
});

describe("capability-gated thread actions", () => {
  const actions = {
    captureGoalLifecycle: vi.fn(),
    onClearGoal: vi.fn(),
    onCompact: vi.fn(),
    onGetGoal: vi.fn(),
    onListTerminals: vi.fn(),
    onLoadThreadChangeDiff: vi.fn(),
    onLoadThreadResources: vi.fn(),
    onSetGoal: vi.fn(),
    onSetGoalStatus: vi.fn(),
    onStartReview: vi.fn(),
    onTerminateTerminal: vi.fn(),
  };
  const fork = vi.fn();

  it("removes goal, review, fork, terminal and resource actions the agent does not declare", () => {
    // WHY: the gate reads only the action members it filters; the remaining scope bindings are irrelevant here.
    const scope = actions as unknown as Parameters<typeof threadAgentActions>[1];
    const gated = threadAgentActions(claudeThread, scope, fork);
    expect(gated.onCompact).toBe(actions.onCompact);
    const unavailable = Object.entries(gated)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name)
      .toSorted();
    expect(unavailable).toEqual(
      [
        "captureGoalLifecycle",
        "onClearGoal",
        "onFork",
        "onGetGoal",
        "onListTerminals",
        "onLoadThreadChangeDiff",
        "onLoadThreadResources",
        "onSetGoal",
        "onSetGoalStatus",
        "onStartReview",
        "onTerminateTerminal",
      ].toSorted(),
    );
    const legacy = threadAgentActions(createV1TestThread("t", null, 1, []), scope, fork);
    expect(Object.values(legacy).every((value) => value !== undefined)).toBe(true);
  });
});

describe("thread list provider badge", () => {
  it("labels only threads bound to a provider other than the host's primary provider", () => {
    const claude = summary("claude-thread", {
      codewideAgent: { capabilities: [], primary: false, provider: provider("claude"), providerName: "Claude" },
    });
    const codex = summary("codex-thread", {
      codewideAgent: { capabilities: ["review"], primary: true, provider: provider("codex"), providerName: "Codex" },
    });
    expect(storedThreadToListItem(claude).agentBadge).toBe("Claude");
    expect(storedThreadToListItem(codex).agentBadge).toBeNull();
    expect(storedThreadToListItem(summary("legacy-thread")).agentBadge).toBeNull();
  });
});

describe("account limits in the conversation header", () => {
  const accounts = {
    // WHY: the gate passes the database through untouched; its contents are irrelevant here.
    accountRateLimitsDatabase: {} as never,
    onRefreshAccountRateLimits: vi.fn(async () => undefined),
  };
  // WHY: the gate passes the provider list through untouched; its contents are irrelevant here.
  const scope = { agentProviders: {} as never, connectionId: "server" };

  it("drops the account pool for a thread whose agent has no account rate limits", () => {
    expect(threadAgentAccounts(claudeThread, accounts, null)).toEqual({
      accountRateLimitsDatabase: null,
      onRefreshAccountRateLimits: undefined,
      providerLimits: null,
    });
    expect(accounts.onRefreshAccountRateLimits).not.toHaveBeenCalled();
  });

  it("reads such a thread's own provider limits from the server's provider list", () => {
    expect(threadAgentAccounts(claudeThread, accounts, scope)).toEqual({
      accountRateLimitsDatabase: null,
      onRefreshAccountRateLimits: undefined,
      providerLimits: { agentProviders: scope.agentProviders, connectionId: "server", provider: "claude" },
    });
  });

  it("keeps it for a thread declaring accounts.rateLimits and for a legacy thread", () => {
    const codexThread = {
      codewideAgent: {
        capabilities: { "accounts.rateLimits": true },
        primary: true,
        provider: "codex",
        providerName: "Codex",
      },
    };
    const kept = { ...accounts, providerLimits: null };
    expect(threadAgentAccounts(codexThread, accounts, scope)).toEqual(kept);
    expect(threadAgentAccounts(createV1TestThread("t", null, 1, []), accounts, scope)).toEqual(kept);
  });
});
