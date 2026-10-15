import { describe, expect, it } from "vitest";

import { threadAgentActions } from "../src/features/conversation/threadAgentActions";

function thread(owner: string, capabilities: Record<string, unknown>) {
  return { codewideAgent: { capabilities, primary: owner === "codex", provider: owner, providerName: owner } };
}

describe("fork availability", () => {
  it("offers a fork for either fork capability or a legacy thread and hides it otherwise", () => {
    const fork = async () => undefined;
    // WHY: the gate reads only the action members it filters; the remaining scope bindings are irrelevant here.
    const scope = {} as unknown as Parameters<typeof threadAgentActions>[1];
    const onFork = (value: unknown) => threadAgentActions(value, scope, fork).onFork;
    expect(onFork(thread("claude", { "threads.crossProviderFork": true }))).toBe(fork);
    expect(onFork(thread("claude", { "threads.fork": true }))).toBe(fork);
    expect(onFork(thread("claude", { "threads.compact": true }))).toBeUndefined();
    expect(onFork({})).toBe(fork);
  });
});
