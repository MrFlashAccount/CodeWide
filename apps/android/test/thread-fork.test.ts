import { describe, expect, it } from "vitest";

import { buildThreadForkParams } from "../src/data/thread-fork";
import { parseAgentProviderId } from "../src/data/threadAgent";

describe("buildThreadForkParams", () => {
  it("forks the complete history durably", () => {
    expect(buildThreadForkParams("thread-1", { boundary: { kind: "all" }, ephemeral: false, target: null })).toEqual({
      threadId: "thread-1",
      excludeTurns: true,
      ephemeral: false,
    });
  });

  it("forks through a selected completed turn inclusively", () => {
    expect(buildThreadForkParams("thread-1", { boundary: { kind: "through", turnId: "turn-7" }, ephemeral: false, target: null })).toEqual({
      threadId: "thread-1",
      lastTurnId: "turn-7",
      excludeTurns: true,
      ephemeral: false,
    });
  });

  it("forks before a selected turn as an ephemeral preview", () => {
    expect(buildThreadForkParams("thread-1", { boundary: { kind: "before", turnId: "turn-7" }, ephemeral: true, target: null })).toEqual({
      threadId: "thread-1",
      beforeTurnId: "turn-7",
      excludeTurns: true,
      ephemeral: true,
    });
  });

  it("rejects blank identifiers", () => {
    expect(() => buildThreadForkParams(" ", { boundary: { kind: "all" }, ephemeral: false, target: null })).toThrow("Thread id is required");
    expect(() => buildThreadForkParams("thread-1", { boundary: { kind: "through", turnId: " " }, ephemeral: false, target: null })).toThrow("Last turn id is required");
  });

  it("binds the fork to another agent only when a target is chosen", () => {
    const provider = parseAgentProviderId("claude");
    if (provider === null) throw new Error("invalid provider fixture");
    expect(
      buildThreadForkParams("thread-1", {
        boundary: { kind: "all" },
        ephemeral: false,
        target: { effort: null, model: "claude-sonnet-4-5", provider, serviceTier: null },
      }),
    ).toEqual({
      threadId: "thread-1",
      excludeTurns: true,
      ephemeral: false,
      codewideAgentProvider: "claude",
      model: "claude-sonnet-4-5",
    });
    const plain = buildThreadForkParams("thread-1", { boundary: { kind: "all" }, ephemeral: false, target: null });
    expect(JSON.stringify(plain)).toBe('{"ephemeral":false,"excludeTurns":true,"threadId":"thread-1"}');
  });

  it("carries the chosen thinking level and service tier like thread/start", () => {
    const provider = parseAgentProviderId("codex");
    if (provider === null) throw new Error("invalid provider fixture");
    expect(
      buildThreadForkParams("thread-1", {
        boundary: { kind: "through", turnId: "turn-7" },
        ephemeral: false,
        target: { effort: "xhigh", model: "gpt-5.5", provider, serviceTier: "priority" },
      }),
    ).toEqual({
      threadId: "thread-1",
      lastTurnId: "turn-7",
      excludeTurns: true,
      ephemeral: false,
      codewideAgentProvider: "codex",
      model: "gpt-5.5",
      config: { model_reasoning_effort: "xhigh" },
      serviceTier: "priority",
    });
  });
});
