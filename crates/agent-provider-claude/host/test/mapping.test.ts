/**
 * Pure mapping contracts: frame classification, result outcomes, tool items,
 * output bounds and thread-list cursors.
 */

import { describe, expect, it } from "vitest";
import { classifyFrame } from "../src/mapping/frames.js";
import { turnOutcome } from "../src/mapping/result.js";
import { keepTail, MAX_COMMAND_OUTPUT_BYTES, splitMcpToolName } from "../src/mapping/tools.js";
import { decodeCursor, encodeCursor, listThreads } from "../src/threads/listing.js";
import { historyPrefix, HISTORY_PREFIX_MAX_BYTES } from "../src/history/prefix.js";
import type { AgentThread } from "../src/protocol.js";
import { asAppThreadId, PROVIDER_ID } from "../src/protocol.js";

const result = (overrides: Record<string, unknown>) => {
  const frame = classifyFrame({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    ...overrides,
  });
  if (frame.kind !== "result") throw new Error("not a result");
  return frame;
};

describe("frames", () => {
  it("never throws on unknown or malformed input", () => {
    for (const value of [
      null,
      1,
      "x",
      [],
      {},
      { type: "assistant" },
      { type: "user", message: 3 },
      { type: "brand_new" },
    ]) {
      expect(() => classifyFrame(value)).not.toThrow();
    }
    expect(classifyFrame({ type: "brand_new" })).toEqual({ kind: "other", type: "brand_new" });
  });
});

describe("result outcomes", () => {
  it("maps aborts, auth failures and provider errors without diagnostics", () => {
    expect(turnOutcome(result({ terminal_reason: "aborted_tools" }), null)).toEqual({
      status: "interrupted",
    });
    expect(
      turnOutcome(
        result({ is_error: true, result: "API Error: 401 Invalid authentication credentials" }),
        null,
      ),
    ).toMatchObject({
      status: "failed",
      error: { kind: "authentication" },
    });
    expect(turnOutcome(result({}), "authentication_failed")).toMatchObject({
      error: { kind: "authentication" },
    });
    const failed = turnOutcome(
      result({
        subtype: "error_max_turns",
        is_error: true,
        errors: ["[ede_diagnostic] internal", "Reached max turns"],
      }),
      null,
    );
    expect(failed).toEqual({
      status: "failed",
      error: { kind: "provider", message: "Reached max turns" },
    });
    expect(turnOutcome(result({}), null)).toEqual({ status: "completed" });
  });
});

describe("tool mapping", () => {
  it("keeps the last 1 MiB of command output with a truncation line", () => {
    const output = `${"a".repeat(10)}${"b".repeat(MAX_COMMAND_OUTPUT_BYTES)}`;
    const kept = keepTail(output, MAX_COMMAND_OUTPUT_BYTES);
    expect(kept.startsWith("[output truncated: first 10 bytes omitted]\n")).toBe(true);
    expect(kept.endsWith("b".repeat(100))).toBe(true);
    expect(keepTail("short", MAX_COMMAND_OUTPUT_BYTES)).toBe("short");
  });

  it("splits MCP names by the longest known server", () => {
    expect(
      splitMcpToolName("mcp__my_server__extra__tool", ["my_server", "my_server__extra"]),
    ).toEqual({ server: "my_server__extra", tool: "tool" });
    expect(splitMcpToolName("mcp__claude_ai_Firecrawl__scrape", [])).toEqual({
      server: "claude.ai Firecrawl",
      tool: "scrape",
    });
    expect(splitMcpToolName("Bash", [])).toBeNull();
  });
});

describe("history prefix", () => {
  it("keeps whole recent lines within 16 KiB", () => {
    const lines = Array.from(
      { length: 400 },
      (_, index) => `User: message ${index} ${"x".repeat(80)}`,
    );
    const prefix = historyPrefix(lines) ?? "";
    expect(Buffer.byteLength(prefix, "utf8")).toBeLessThanOrEqual(HISTORY_PREFIX_MAX_BYTES + 2);
    expect(prefix.startsWith("[Historical conversation from this thread]\n")).toBe(true);
    expect(prefix).toContain("message 399");
    expect(prefix).not.toContain("message 0 ");
    expect(historyPrefix([])).toBeNull();
  });
});

describe("thread list", () => {
  const thread = (
    id: string,
    recencyAt: number | null,
    updatedAt: number,
    extra: Partial<AgentThread> = {},
  ): AgentThread => ({
    appThreadId: asAppThreadId(id),
    provider: PROVIDER_ID,
    cwd: "/w",
    name: null,
    preview: "",
    createdAt: 1,
    updatedAt,
    recencyAt,
    archived: false,
    origin: "interactive",
    status: "idle",
    settings: { model: "m", effort: null, permissionProfile: ":workspace", serviceTier: null },
    ...extra,
  });
  const threads = [
    thread("a", 30, 1),
    thread("b", null, 20),
    thread("c", 20, 1),
    thread("d", 10, 1),
    thread("shell", 40, 1),
  ];
  const rows = (search: (value: AgentThread) => string = () => "") =>
    threads.map((value) => ({
      searchText: search(value),
      shell: value.appThreadId === "shell",
      thread: value,
    }));
  const params = {
    archived: false,
    cwd: null,
    searchTerm: null,
    sortKey: "recencyAt" as const,
    sortDirection: "desc" as const,
    window: null,
    cursor: null,
    limit: 2,
  };

  it("pages strictly after the cursor, ties by id, and hides shells", () => {
    const first = listThreads(rows(), params);
    expect(first.status === "ok" ? first.threads.map((value) => value.appThreadId) : []).toEqual([
      "a",
      "c",
    ]);
    const cursor = first.status === "ok" ? first.nextCursor : null;
    expect(cursor).toBe("v1:recencyAt:desc:20:c");
    const second = listThreads(rows(), { ...params, cursor });
    expect(second.status === "ok" ? second.threads.map((value) => value.appThreadId) : []).toEqual([
      "b",
      "d",
    ]);
    expect(second.status === "ok" ? second.nextCursor : "x").toBeNull();
  });

  it("applies window bounds and search", () => {
    const windowed = listThreads(rows(), {
      ...params,
      limit: 10,
      window: { lower: 20, lowerInclusive: true, upper: 30, upperInclusive: false },
    });
    expect(
      windowed.status === "ok" ? windowed.threads.map((value) => value.appThreadId) : [],
    ).toEqual(["c", "b"]);
    const searched = listThreads(
      rows((value) => (value.appThreadId === "d" ? "fix tests" : "")),
      { ...params, searchTerm: "FIX" },
    );
    expect(
      searched.status === "ok" ? searched.threads.map((value) => value.appThreadId) : [],
    ).toEqual(["d"]);
  });

  it("round-trips and validates cursors", () => {
    const position = {
      sortKey: "createdAt" as const,
      direction: "asc" as const,
      value: 42,
      id: "x:y",
    };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
    expect(decodeCursor("v2:bad")).toBeNull();
    expect(listThreads(rows(), { ...params, cursor: "v1:createdAt:asc:1:a" }).status).toBe("error");
  });
});
