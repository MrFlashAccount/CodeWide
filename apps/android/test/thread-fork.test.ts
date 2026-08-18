import { describe, expect, it } from "vitest";

import { buildThreadForkParams } from "../src/data/thread-fork";

describe("buildThreadForkParams", () => {
  it("forks the complete history durably", () => {
    expect(buildThreadForkParams("thread-1", { boundary: { kind: "all" }, ephemeral: false })).toEqual({
      threadId: "thread-1",
      excludeTurns: false,
      ephemeral: false,
    });
  });

  it("forks through a selected completed turn inclusively", () => {
    expect(buildThreadForkParams("thread-1", { boundary: { kind: "through", turnId: "turn-7" }, ephemeral: false })).toEqual({
      threadId: "thread-1",
      lastTurnId: "turn-7",
      excludeTurns: false,
      ephemeral: false,
    });
  });

  it("forks before a selected turn as an ephemeral preview", () => {
    expect(buildThreadForkParams("thread-1", { boundary: { kind: "before", turnId: "turn-7" }, ephemeral: true })).toEqual({
      threadId: "thread-1",
      beforeTurnId: "turn-7",
      excludeTurns: false,
      ephemeral: true,
    });
  });

  it("rejects blank identifiers", () => {
    expect(() => buildThreadForkParams(" ", { boundary: { kind: "all" }, ephemeral: false })).toThrow("Thread id is required");
    expect(() => buildThreadForkParams("thread-1", { boundary: { kind: "through", turnId: " " }, ephemeral: false })).toThrow("Last turn id is required");
  });
});
