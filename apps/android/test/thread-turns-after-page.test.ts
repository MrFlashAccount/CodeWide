import { describe, expect, it } from "vitest";

import { parseHistoryTurns } from "../src/data/thread-cursor-sync";
import { parseThreadTurnsAfterPage } from "../src/data/thread-turns-after-page";

const completed = {
  id: "newer",
  status: "completed",
  items: [],
};

describe("thread turns after page", () => {
  it("accepts a bounded immutable forward page", () => {
    expect(parseThreadTurnsAfterPage({ data: [completed], hasMore: true, sourceWitness: "source" }, "anchor", 5))
      .toEqual({ turns: [completed], hasMore: true, sourceWitness: "source" });
  });

  it("accepts every item kind the Companion summary view keeps", () => {
    const turn = {
      ...completed,
      items: [
        { type: "userMessage", id: "prompt", content: [] },
        { type: "collabAgentToolCall", id: "spawn", tool: "spawnAgent", receiverThreadIds: ["parent:agent:a1"] },
        { type: "codewideTaskNotification", id: "report", taskId: "a1" },
        {
          type: "commandExecution",
          id: "launch",
          command: "sleep 6",
          codewideBackgroundTaskId: "b1",
          codewideBackgroundTask: { taskId: "b1", state: "running" },
        },
        { type: "contextCompaction", id: "compaction" },
        { type: "agentMessage", id: "answer", text: "Done", phase: "final_answer" },
      ],
    };
    expect(parseThreadTurnsAfterPage({ data: [turn], hasMore: false, sourceWitness: "source" }, "anchor", 5).turns)
      .toEqual([turn]);
  });

  it("reads turns as the thread snapshot does, so a later page never refuses what it shows", () => {
    const turns = [
      {
        ...completed,
        id: "commands",
        items: [{ type: "commandExecution", id: "ls", command: "ls", status: "completed" }],
      },
      { ...completed, id: "failed", status: "failed", error: { message: "boom" }, items: [] },
    ];
    expect(parseThreadTurnsAfterPage({ data: turns, hasMore: false, sourceWitness: "source" }, "anchor", 5).turns)
      .toEqual(parseHistoryTurns(turns));
  });

  it.each([
    null,
    {},
    { data: [], hasMore: "yes" },
    { data: [], hasMore: true },
    { data: [{ ...completed, id: "anchor" }], hasMore: false },
    { data: [{ ...completed, status: "inProgress" }], hasMore: false },
    { data: [{ ...completed, status: "unknown" }], hasMore: false },
    { data: [{ ...completed, id: "" }], hasMore: false },
    { data: [completed, completed], hasMore: false },
    { data: [{ ...completed, items: "none" }], hasMore: false },
  ])("rejects a malformed or non-advancing page %#", (value) => {
    const response = value === null ? value : { sourceWitness: "source", ...value };
    expect(() => parseThreadTurnsAfterPage(response, "anchor", 5))
      .toThrow("invalid history summary page");
  });

  it("rejects responses larger than the requested page", () => {
    expect(() => parseThreadTurnsAfterPage({ data: [completed], hasMore: false, sourceWitness: "source" }, "anchor", 0))
      .toThrow("invalid history summary page");
  });

  it("retains valid whole-content references as repairable metadata-only turns", () => {
    const { items: _items, ...metadata } = completed;
    const raw = {
      ...metadata,
      codewideContent: { version: 1, fields: {}, whole: { id: "a".repeat(64), byteLength: 100_000, contentType: "application/json" } },
    };
    expect(parseThreadTurnsAfterPage({ data: [raw], hasMore: false, sourceWitness: "source" }, "anchor", 5).turns)
      .toEqual([{ ...raw, items: [], itemsView: "notLoaded" }]);
  });

  it("requires a source witness for semantic traversal", () => {
    expect(() => parseThreadTurnsAfterPage({ data: [completed], hasMore: false }, "anchor", 5))
      .toThrow("invalid history summary page");
  });

  it("rejects an oversized source witness before it reaches persistence", () => {
    expect(() => parseThreadTurnsAfterPage({
      data: [completed], hasMore: false, sourceWitness: "x".repeat(8192),
    }, "anchor", 5)).toThrow("invalid history summary page");
  });
});
