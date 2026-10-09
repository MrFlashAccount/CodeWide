/**
 * History contracts over real-shaped stored sessions (`test/fixtures/sessions`,
 * `getSessionMessages` output of local probe sessions with paths and
 * signatures removed): derived turn boundaries, outcomes, item mapping, and
 * what the host's turn index adds (turn ids, steers, `clientMessageId`
 * echoes, failed outcomes).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentItem, AgentTurn } from "../src/protocol.js";
import { asAppThreadId } from "../src/protocol.js";
import { reconstructTurns } from "../src/history/reconstruct.js";
import type { TurnRecord } from "../src/state/threadState.js";

interface SessionFixture {
  readonly messages: readonly unknown[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fixture(name: string): readonly unknown[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "sessions", `${name}.json`), "utf8"),
  );
  if (!isRecord(parsed) || !Array.isArray(parsed["messages"]))
    throw new Error(`${name} is not a session fixture`);
  const session: SessionFixture = { messages: parsed["messages"] };
  return session.messages;
}

/** Uuid of the stored user message whose text starts with `prefix`. */
function promptUuid(messages: readonly unknown[], prefix: string): string {
  for (const message of messages) {
    if (!isRecord(message) || message["type"] !== "user" || !isRecord(message["message"])) continue;
    const content = message["message"]["content"];
    const text = typeof content === "string" ? content : JSON.stringify(content);
    if (text.includes(prefix) && typeof message["uuid"] === "string") return message["uuid"];
  }
  throw new Error(`no prompt starting with ${prefix}`);
}

const context = {
  appThreadId: asAppThreadId("0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e"),
  cwd: "/workspace",
};
const types = (turn: AgentTurn | undefined): readonly string[] =>
  (turn?.items ?? []).map((item) => item.type);
const nonReasoning = (turn: AgentTurn | undefined): readonly AgentItem[] =>
  (turn?.items ?? []).filter((item) => item.type !== "reasoning");

/** Neutral ordering rules that hold for every rebuilt turn. */
function orderingViolations(turns: readonly AgentTurn[]): readonly string[] {
  return turns.flatMap((turn) => {
    const violations: string[] = [];
    if (turn.origin === "user" && turn.items[0]?.type !== "userMessage")
      violations.push(`${turn.turnId}: user turn without a first userMessage`);
    if (
      turn.items.filter((item) => item.type === "agentMessage" && item.phase === "final").length > 1
    )
      violations.push(`${turn.turnId}: two final answers`);
    if (turn.items.some((item) => "status" in item && item.status === "inProgress"))
      violations.push(`${turn.turnId}: open item`);
    if (turn.status === "inProgress") violations.push(`${turn.turnId}: open turn`);
    return violations;
  });
}

describe("history from Claude's session store", () => {
  it("rebuilds a prompt, a tool call and the final answer as one completed turn", () => {
    const messages = fixture("bash_then_answer");
    const turns = reconstructTurns(messages, [], context);
    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn).toMatchObject({
      origin: "user",
      status: "completed",
      turnId: promptUuid(messages, "Run the shell command"),
    });
    expect(nonReasoning(turn).map((item) => item.type)).toEqual([
      "userMessage",
      "command",
      "agentMessage",
    ]);
    expect(nonReasoning(turn)[1]).toMatchObject({
      command: "echo hi && touch b2-marker.txt",
      cwd: "/workspace",
      output: "hi",
      status: "completed",
    });
    expect(nonReasoning(turn)[2]).toMatchObject({ phase: "final", text: "DONE" });
    // Claude keeps only thinking signatures: reasoning items keep their ids, not their text.
    expect(
      turn?.items
        .filter((item) => item.type === "reasoning")
        .map((item) => (item.type === "reasoning" ? item.summary : null)),
    ).toEqual([[], []]);
  });

  it("marks a rejected tool call declined and the interrupted turn interrupted", () => {
    const turns = reconstructTurns(fixture("declined_tool_interrupt"), [], context);
    expect(turns.map((turn) => turn.status)).toEqual(["interrupted"]);
    expect(
      nonReasoning(turns[0]).map((item) => [item.type, "status" in item ? item.status : null]),
    ).toEqual([
      ["userMessage", null],
      ["command", "declined"],
    ]);
  });

  it("maps MCP calls and keeps the last answer final", () => {
    const turns = reconstructTurns(fixture("three_tools_final"), [], context);
    expect(nonReasoning(turns[0]).map((item) => item.type)).toEqual([
      "userMessage",
      "command",
      "mcpToolCall",
      "command",
      "agentMessage",
    ]);
    expect(nonReasoning(turns[0])[2]).toMatchObject({
      server: "probe",
      status: "completed",
      tool: "write_note",
    });
  });

  it("derives turn boundaries from prompts, the interrupt marker and a task-notification wake", () => {
    const messages = fixture("background_wake_steer_interrupt");
    const turns = reconstructTurns(messages, [], context);
    expect(turns.map((turn) => [turn.origin, turn.status])).toEqual([
      ["user", "completed"],
      ["user", "interrupted"],
      ["user", "completed"],
      ["provider", "completed"],
    ]);
    expect(
      nonReasoning(turns[0]).map((item) => [item.type, "status" in item ? item.status : null]),
    ).toEqual([
      ["userMessage", null],
      ["command", "failed"],
      ["command", "completed"],
      ["toolCall", "completed"],
    ]);
    // An interrupted turn has no final answer; the wake turn's answer is final.
    expect(nonReasoning(turns[1]).at(-1)).toMatchObject({
      phase: "commentary",
      type: "agentMessage",
    });
    expect(types(turns[3]).filter((type) => type !== "reasoning")).toEqual(["agentMessage"]);
    expect(nonReasoning(turns[3])[0]).toMatchObject({ phase: "final", text: "DONE" });
    expect(orderingViolations(turns)).toEqual([]);
  });

  it("uses the host's turn index for turn ids, steers, client message ids and outcomes", () => {
    const messages = fixture("background_wake_steer_interrupt");
    const first = promptUuid(messages, "Run the shell command `sleep 25`");
    const steer = promptUuid(messages, "Write the numbers");
    const record: TurnRecord = {
      anchors: [first, steer],
      completedAt: 1_791_542_449,
      origin: "user",
      outcome: { status: "interrupted" },
      prompts: [
        { clientMessageId: "client-1", role: "first", uuid: first },
        { clientMessageId: "client-2", role: "steer", uuid: steer },
      ],
      startedAt: 1_791_542_431,
      turnId: "turn-from-index",
      usage: null,
    };
    const turns = reconstructTurns(messages, [record], context);
    expect(turns.map((turn) => [turn.turnId, turn.status])).toEqual([
      ["turn-from-index", "interrupted"],
      [promptUuid(messages, "Reply with just OK"), "completed"],
      [turns[2]?.turnId, "completed"],
    ]);
    const users = turns[0]?.items.filter((item) => item.type === "userMessage") ?? [];
    expect(
      users.map((item) =>
        item.type === "userMessage" ? [item.itemId, item.clientMessageId] : null,
      ),
    ).toEqual([
      ["turn-from-index:user:0", "client-1"],
      ["turn-from-index:user:1", "client-2"],
    ]);
    expect(turns[0]).toMatchObject({ completedAt: 1_791_542_449, startedAt: 1_791_542_431 });
  });

  it("keeps a failed outcome, its error and its usage from the index", () => {
    const counts = {
      cacheWriteInputTokens: 100,
      cachedInputTokens: 900,
      inputTokens: 1_010,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 1_030,
    };
    const recordedUsage = {
      contextWindow: 200_000,
      cost: { basis: "list" as const, model: "claude-sonnet-4-6", threadUsd: 0.5, turnUsd: 0.5 },
      last: counts,
      total: counts,
      turn: counts,
    };
    const messages = fixture("three_tools_final");
    const first = promptUuid(messages, "Do these three steps");
    const turns = reconstructTurns(
      messages,
      [
        {
          anchors: [first],
          completedAt: null,
          origin: "user",
          outcome: { error: { kind: "usageLimit", message: "limit reached" }, status: "failed" },
          prompts: [{ clientMessageId: null, role: "first", uuid: first }],
          startedAt: 1,
          turnId: "failed-turn",
          usage: recordedUsage,
        },
      ],
      context,
    );
    expect(turns[0]).toMatchObject({
      error: { kind: "usageLimit", message: "limit reached" },
      status: "failed",
      turnId: "failed-turn",
    });
    // The usage `usage.updated` reported when the turn ended comes back on a read.
    expect(turns[0]?.usage).toEqual(recordedUsage);
    expect(turns.slice(1).every((turn) => turn.usage === undefined)).toBe(true);
    // A failed turn has no final answer.
    expect(nonReasoning(turns[0]).at(-1)).toMatchObject({
      phase: "commentary",
      type: "agentMessage",
    });
  });

  it("ignores sub-agent, meta and malformed messages", () => {
    const turns = reconstructTurns(
      [
        null,
        {
          type: "user",
          uuid: "u1",
          timestamp: "2026-10-01T10:00:00.000Z",
          parent_tool_use_id: null,
          message: { content: "<command-name>/clear</command-name>" },
        },
        {
          type: "user",
          uuid: "u2",
          timestamp: "2026-10-01T10:00:00.000Z",
          parent_tool_use_id: null,
          is_meta: true,
          message: { content: "Caveat" },
        },
        {
          type: "assistant",
          uuid: "a1",
          timestamp: "2026-10-01T10:00:01.000Z",
          parent_tool_use_id: "toolu_task",
          message: { id: "msg_sub", content: [{ type: "text", text: "sub-agent" }] },
        },
        {
          type: "user",
          uuid: "u3",
          timestamp: "not a time",
          parent_tool_use_id: null,
          message: { content: "lost" },
        },
      ],
      [],
      context,
    );
    expect(turns).toEqual([]);
  });
});
