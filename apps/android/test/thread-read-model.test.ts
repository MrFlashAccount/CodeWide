import { describe, expect, it } from "vitest";

import { materializeAuthoritativeThreadWindow, materializeResumedThread } from "../src/data/thread-read-model";

describe("companion thread read model", () => {
  it("uses the authoritative companion window without merging stale turns", () => {
    const authoritative = thread("thread", [turn("fresh", 20)]);
    const result = materializeResumedThread({
      thread: authoritative,
      codewideReadModelVersion: 1,
    } as never);

    expect(result).toBe(authoritative);
    expect(result.turns.map(({ id }) => id)).toEqual(["fresh"]);
  });

  it("rejects a contradictory recovery window instead of merging compatibility state", () => {
    const pageTurn = turn("page", 20);
    expect(() => materializeResumedThread({
      thread: thread("thread", []),
      initialTurnsPage: { data: [pageTurn], nextCursor: null },
      codewideReadModelVersion: 1,
    } as never)).toThrow("omitted turn page");
  });

  it("rejects old companion read models", () => {
    expect(() => materializeResumedThread({
      thread: thread("thread", []),
      codewideReadModelVersion: 0,
    } as never)).toThrow("Unsupported companion thread read model");
  });

  it("replaces the mutable head while preserving cached projection metadata", () => {
    const cached = thread("thread", [{
      ...turn("mutable", 20),
      status: "inProgress",
      codewide: { execution: { model: "gpt-test", effort: "high", permissions: "full" } },
    }]);
    (cached as { codewide?: unknown }).codewide = {
      executionSettings: { model: "gpt-test", effort: "high", permissions: "full" },
    };
    const completed = turn("mutable", 20);

    const result = materializeAuthoritativeThreadWindow({
      thread: thread("thread", [completed]),
      initialTurnsPage: { data: [completed], nextCursor: "older" },
      codewideReadModelVersion: 1,
    } as never, cached);

    expect(result.turns[0]?.status).toBe("completed");
    expect((result as { codewide?: unknown }).codewide).toEqual((cached as { codewide?: unknown }).codewide);
    expect((result.turns[0] as { codewide?: unknown }).codewide).toEqual((cached.turns[0] as { codewide?: unknown }).codewide);
  });

  it("keeps authoritative activity items when repairing a mutable head", () => {
    const cached = thread("thread", [{
      ...turn("mutable", 20),
      status: "inProgress",
      completedAt: null,
      itemsView: "summary",
      items: [
        { type: "userMessage", id: "user", content: [] },
        { type: "agentMessage", id: "agent", text: "working", phase: null },
      ],
    } as never]);
    const authoritative = {
      ...cached.turns[0]!,
      itemsView: "full",
      items: [
        { type: "userMessage", id: "user", content: [] },
        { type: "commandExecution", id: "command", command: "pnpm test", status: "completed" },
        { type: "agentMessage", id: "agent", text: "working", phase: null },
      ],
    } as never;

    const result = materializeAuthoritativeThreadWindow({
      thread: thread("thread", [authoritative]),
      initialTurnsPage: { data: [authoritative], nextCursor: "older" },
      codewideReadModelVersion: 1,
    } as never, cached);

    expect(result.turns[0]?.itemsView).toBe("full");
    expect(result.turns[0]?.items.map(({ type }) => type)).toEqual([
      "userMessage",
      "commandExecution",
      "agentMessage",
    ]);
  });
});

function thread(id: string, turns: ReturnType<typeof turn>[]) {
  return {
    id,
    turns,
    status: { type: "notLoaded" },
  } as never;
}

function turn(id: string, startedAt: number) {
  return {
    id,
    status: "completed",
    items: [],
    itemsView: "summary",
    error: null,
    startedAt,
    completedAt: startedAt + 1,
    durationMs: 1,
  } as const;
}
