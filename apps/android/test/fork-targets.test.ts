import { describe, expect, it } from "vitest";

import { parseAgentProviderId, type AgentProviderId } from "../src/data/threadAgent";
import type { TurnControlsValue } from "../src/data/turn-controls-types";
import { threadAgentActions } from "../src/features/conversation/threadAgentActions";
import { forkTargetChoices } from "../src/features/turnActions/forkTargets";

function provider(id: string): AgentProviderId {
  const parsed = parseAgentProviderId(id);
  if (parsed === null) throw new Error(`Invalid provider fixture ${id}`);
  return parsed;
}

function model(id: string, label: string, owner: string | null): TurnControlsValue["models"][number] {
  return {
    defaultEffort: "medium",
    efforts: [],
    id,
    isDefault: false,
    label,
    provider: owner === null ? null : provider(owner),
    supportsPersonality: false,
  };
}

const catalog = [
  model("gpt-5.5", "GPT-5.5", "codex"),
  model("claude-sonnet-4-5", "Sonnet 4.5", "claude"),
  model("claude-opus-4-1", "Opus 4.1", "claude"),
];

function thread(owner: string, providerName: string, capabilities: Record<string, unknown>) {
  return { codewideAgent: { capabilities, primary: owner === "codex", provider: owner, providerName } };
}

describe("fork targets", () => {
  it("offers no picker without the cross-provider capability or for a legacy thread", () => {
    expect(forkTargetChoices(thread("codex", "Codex", { "threads.fork": true }), catalog)).toBeNull();
    expect(forkTargetChoices({}, catalog)).toBeNull();
  });

  it("puts the same-agent fork first and offers every catalog model of every provider", () => {
    const choices = forkTargetChoices(
      thread("codex", "Codex", { "threads.fork": true, "threads.crossProviderFork": true }),
      catalog,
    );
    expect(choices?.map((choice) => [choice.title, choice.subtitle, choice.target])).toEqual([
      ["Same agent", "Codex with the current settings", null],
      ["GPT-5.5", "Codex", { model: "gpt-5.5", provider: "codex" }],
      ["Sonnet 4.5", "Claude", { model: "claude-sonnet-4-5", provider: "claude" }],
      ["Opus 4.1", "Claude", { model: "claude-opus-4-1", provider: "claude" }],
    ]);
  });

  it("offers only other agents when the thread cannot fork into its own agent", () => {
    const choices = forkTargetChoices(
      thread("claude", "Claude", { "threads.fork": false, "threads.crossProviderFork": true }),
      [...catalog, model("legacy", "Unannotated", null)],
    );
    expect(choices?.map((choice) => choice.target)).toEqual([{ model: "gpt-5.5", provider: "codex" }]);
  });

  it("keeps the fork action for a cross-provider-only agent and hides it otherwise", () => {
    const fork = async () => undefined;
    // WHY: the gate reads only the action members it filters; the remaining scope bindings are irrelevant here.
    const scope = {} as unknown as Parameters<typeof threadAgentActions>[1];
    expect(
      threadAgentActions(thread("claude", "Claude", { "threads.crossProviderFork": true }), scope, fork)
        .onFork,
    ).toBe(fork);
    expect(threadAgentActions(thread("claude", "Claude", { "threads.compact": true }), scope, fork).onFork).toBeUndefined();
    expect(threadAgentActions({}, scope, fork).onFork).toBe(fork);
  });
});
