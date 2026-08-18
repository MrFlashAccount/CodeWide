import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { applyThreadEvent, applyThreadEventsImmutable, applyThreadProjectionPatchesImmutable, latestProjectedThreadExecutionSettings, MAX_LIVE_FIELD_CHARS, preserveProjectedTurnMetadata, projectedThreadExecutionSettings, projectedTurnMetadata, seedThreadExecutionSettings, threadContainsClientMessage, threadProjectionNeedsAuthoritativeRepair, type TurnUsageProjection } from "../src/index.js";

describe("thread event projection", () => {
  it("applies companion patches without interpreting the conflicting raw event", () => {
    const value = thread();
    const next = applyThreadProjectionPatchesImmutable(value, [{
      version: 1,
      threadId: "thread",
      operation: { kind: "threadName", threadName: "Companion name" },
    }]);

    expect(next.name).toBe("Companion name");
  });
  it("bounds cumulative live text before it can grow quadratically in Hermes", () => {
    const value = thread();
    const hugeDelta = "x".repeat(MAX_LIVE_FIELD_CHARS);
    for (let index = 0; index < 20; index += 1) {
      applyThreadEvent(value, event("item/commandExecution/outputDelta", { itemId: "command", delta: hugeDelta }));
      applyThreadEvent(value, event("item/agentMessage/delta", { itemId: "agent", delta: hugeDelta }));
    }
    const command = value.turns[0]?.items.find((item) => item.type === "commandExecution");
    const agent = value.turns[0]?.items.find((item) => item.type === "agentMessage");
    expect(command?.type === "commandExecution" ? command.aggregatedOutput?.length : 0).toBeLessThanOrEqual(MAX_LIVE_FIELD_CHARS);
    expect(agent?.type === "agentMessage" ? agent.text.length : 0).toBeLessThanOrEqual(MAX_LIVE_FIELD_CHARS);
  });

  it("streams agent, plan, command and reasoning deltas into the cached thread", () => {
    const value = thread();
    const events: Array<Record<string, unknown>> = [
      event("item/agentMessage/delta", { itemId: "agent", delta: " world" }),
      event("item/plan/delta", { itemId: "plan", delta: " two" }),
      event("item/commandExecution/outputDelta", { itemId: "command", delta: "b\n" }),
      event("item/reasoning/summaryPartAdded", { itemId: "reasoning", summaryIndex: 0 }),
      event("item/reasoning/summaryTextDelta", { itemId: "reasoning", summaryIndex: 0, delta: "summary" }),
      event("item/reasoning/textDelta", { itemId: "reasoning", contentIndex: 0, delta: "detail" }),
      event("item/mcpToolCall/progress", { itemId: "mcp", message: "Reading 12 files" }),
      event("turn/plan/updated", { explanation: "Ship safely", plan: [{ step: "Test", status: "inProgress" }] }),
      event("turn/diff/updated", { diff: "--- a/x\n+++ b/x\n+done\n" }),
      usageEvent(turnUsageProjection()),
    ];
    expect(events.every((payload) => applyThreadEvent(value, payload))).toBe(true);
    expect(value.turns[0]?.items).toMatchObject([
      { type: "userMessage", clientId: "client-1" },
      { type: "agentMessage", text: "hello world" },
      { type: "plan", text: "one two" },
      { type: "commandExecution", aggregatedOutput: "a\nb\n" },
      { type: "reasoning", summary: ["summary"], content: ["detail"] },
      { type: "mcpToolCall", progress: ["Reading 12 files"] },
    ]);
    expect(threadContainsClientMessage(value, "client-1")).toBe(true);
    expect(value.turns[0]).toMatchObject({
      codewide: {
        plan: { explanation: "Ship safely", steps: [{ step: "Test", status: "inProgress" }] },
        diff: "--- a/x\n+++ b/x\n+done\n",
        usage: { turn: { tokens: { totalTokens: 12 } }, modelContextWindow: 200_000 },
      },
    });
  });

  it("ignores events for another thread", () => {
    const value = thread();
    expect(applyThreadEvent(value, { method: "thread/name/updated", params: { threadId: "other", name: "Wrong" } })).toBe(false);
    expect(value.name).toBe("Thread");
  });

  it("projects the current threadName field from the generated protocol", () => {
    const value = thread();
    expect(applyThreadEvent(value, event("thread/name/updated", { threadName: "Renamed" }))).toBe(true);
    expect(value.name).toBe("Renamed");
  });

  it("preserves usage when turn/completed replaces the live turn", () => {
    const value = thread();
    const usage = turnUsageProjection();
    applyThreadEvent(value, usageEvent(usage));
    const completed = structuredClone(value.turns[0]!);
    completed.status = "completed";
    completed.completedAt = 2;
    delete (completed as typeof completed & { codewide?: unknown }).codewide;

    applyThreadEvent(value, event("turn/completed", { turn: completed }));

    expect(projectedTurnMetadata(value.turns[0]!)?.usage).toEqual(usage);
  });

  it("replaces usage with the authoritative companion projection", () => {
    const value = thread();
    const first = turnUsageProjection();
    const second = { ...turnUsageProjection(), turn: { ...turnUsageProjection().turn, tokens: { ...turnUsageProjection().turn.tokens, totalTokens: 30 } } };
    applyThreadEvent(value, usageEvent(first));
    applyThreadEvent(value, usageEvent(second));
    expect(projectedTurnMetadata(value.turns[0]!)?.usage).toEqual(second);
  });

  it("does not erase the live user prompt when completion contains only the final answer", () => {
    const value = thread();
    const completed = {
      ...structuredClone(value.turns[0]!),
      status: "completed",
      completedAt: 2,
      items: [structuredClone(value.turns[0]!.items[1]!)],
    } as Thread["turns"][number];

    applyThreadEvent(value, event("turn/completed", { turn: completed }));

    expect(value.turns[0]?.items.map((item) => item.type)).toEqual([
      "userMessage",
      "agentMessage",
      "plan",
      "commandExecution",
      "reasoning",
      "mcpToolCall",
    ]);
    expect(value.turns[0]?.items[0]).toMatchObject({ type: "userMessage", clientId: "client-1" });
  });

  it("does not stack live and completed chat boundaries when their item ids rotate", () => {
    const value = thread();
    const completed = {
      ...structuredClone(value.turns[0]!),
      status: "completed",
      completedAt: 2,
      items: [
        {
          type: "userMessage",
          id: "history-user",
          clientId: null,
          content: [{ type: "text", text: "go", text_elements: [] }],
        },
        {
          type: "agentMessage",
          id: "history-agent",
          text: "hello",
          phase: "final_answer",
          memoryCitation: null,
        },
      ],
    } as Thread["turns"][number];

    applyThreadEvent(value, event("turn/completed", { turn: completed }));

    expect(value.turns[0]?.items.filter((item) => item.type === "userMessage")).toEqual([
      expect.objectContaining({ id: "history-user", clientId: "client-1" }),
    ]);
    expect(value.turns[0]?.items.filter((item) => item.type === "agentMessage")).toEqual([
      expect.objectContaining({ id: "history-agent", text: "hello" }),
    ]);
    expect(value.turns[0]?.items.some((item) => item.type === "commandExecution")).toBe(true);
  });

  it("replaces a rollout summary placeholder when the live agent item completes", () => {
    const value = thread();
    value.turns[0]!.items = [
      value.turns[0]!.items[0]!,
      { type: "agentMessage", id: "turn:agent", text: "Fresh progress", phase: null, memoryCitation: null },
    ];

    applyThreadEvent(value, event("item/started", {
      item: { type: "agentMessage", id: "live-agent", text: "", phase: null, memoryCitation: null },
    }));
    applyThreadEvent(value, event("item/agentMessage/delta", { itemId: "live-agent", delta: "Fresh progress" }));
    applyThreadEvent(value, event("item/completed", {
      item: { type: "agentMessage", id: "live-agent", text: "Fresh progress", phase: null, memoryCitation: null },
    }));
    applyThreadEvent(value, event("item/completed", {
      item: { type: "agentMessage", id: "live-agent", text: "Fresh progress", phase: null, memoryCitation: null },
    }));

    expect(value.turns[0]!.items.filter((item) => item.type === "agentMessage")).toEqual([
      expect.objectContaining({ id: "live-agent", text: "Fresh progress" }),
    ]);
  });

  it("does not stack one user prompt when live item ids rotate", () => {
    const value = thread();
    applyThreadEvent(value, event("item/started", {
      item: {
        type: "userMessage",
        id: "live-user-with-another-id",
        clientId: null,
        content: [{ type: "text", text: "go", text_elements: [] }],
      },
    }));

    expect(value.turns[0]?.items.filter((item) => item.type === "userMessage")).toEqual([
      expect.objectContaining({ id: "live-user-with-another-id", clientId: "client-1" }),
    ]);
  });

  it("hydrates persisted turn usage without changing protocol items", () => {
    const value = thread();
    const usage = turnUsageProjection();
    applyThreadEvent(value, usageEvent(usage));
    expect(projectedTurnMetadata(value.turns[0]!)?.usage).toEqual(usage);
    expect(value.turns[0]!.items).toHaveLength(6);
  });

  it("preserves live metadata across a full thread refresh", () => {
    const cached = thread();
    applyThreadEvent(cached, event("turn/diff/updated", { diff: "+live" }));
    const incoming = structuredClone(cached);
    delete (incoming.turns[0] as typeof incoming.turns[0] & { codewide?: unknown }).codewide;

    const merged = preserveProjectedTurnMetadata(incoming, cached);

    expect(projectedTurnMetadata(merged.turns[0]!)?.diff).toBe("+live");
  });

  it("uses the latest immutable turn settings while a cached thread refreshes", () => {
    const value = thread();
    (value.turns[0] as typeof value.turns[0] & { codewide: object }).codewide = {
      execution: {
        model: "gpt-cached",
        effort: "high",
        permissions: ":workspace",
        modelSource: "settings",
      },
    };

    expect(latestProjectedThreadExecutionSettings(value)).toEqual({
      model: "gpt-cached",
      effort: "high",
      permissions: ":workspace",
      approvalPolicy: null,
      sandboxPolicy: null,
    });
  });

  it("snapshots authoritative thread settings when a turn starts", () => {
    const value = thread();
    value.turns = [];
    applyThreadEvent(value, event("thread/settings/updated", {
      threadSettings: {
        model: "gpt-5.6-sol",
        effort: "high",
        activePermissionProfile: { id: ":workspace", extends: null },
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "workspaceWrite" },
      },
    }));
    expect(projectedThreadExecutionSettings(value)).toMatchObject({
      permissions: ":workspace",
      approvalPolicy: "on-request",
      sandboxPolicy: "workspaceWrite",
    });
    const started = thread().turns[0]!;
    applyThreadEvent(value, event("turn/started", { turn: started }));

    expect(projectedTurnMetadata(value.turns[0]!)?.execution).toEqual({
      model: "gpt-5.6-sol",
      effort: "high",
      permissions: ":workspace",
      modelSource: "settings",
    });

    applyThreadEvent(value, event("thread/settings/updated", {
      threadSettings: { model: "gpt-5.6-terra", effort: "medium", activePermissionProfile: null },
    }));
    expect(projectedTurnMetadata(value.turns[0]!)?.execution?.model).toBe("gpt-5.6-sol");
  });

  it("applies a model reroute only to the addressed turn", () => {
    const value = seedThreadExecutionSettings(thread(), {
      model: "gpt-5.6-sol",
      effort: "high",
      permissions: ":workspace",
    });
    const older = structuredClone(value.turns[0]!);
    older.id = "older";
    value.turns.unshift(older);

    applyThreadEvent(value, event("model/rerouted", { toModel: "gpt-5.6-terra" }));

    expect(projectedTurnMetadata(value.turns[1]!)?.execution).toMatchObject({
      model: "gpt-5.6-terra",
      modelSource: "reroute",
    });
    expect(projectedTurnMetadata(value.turns[0]!)?.execution?.model).toBe("gpt-5.6-sol");
  });

  it("does not invent execution provenance for completed history", () => {
    const value = thread();
    value.turns[0]!.status = "completed";
    seedThreadExecutionSettings(value, { model: "current-model", effort: null, permissions: null });
    expect(projectedTurnMetadata(value.turns[0]!)?.execution).toBeUndefined();
  });

  it("projects live deltas immutably without cloning unrelated turns", () => {
    const value = thread();
    const unrelated = structuredClone(value.turns[0]!);
    unrelated.id = "older-turn";
    value.turns.unshift(unrelated);

    const updated = applyThreadEventsImmutable(value, [event("item/agentMessage/delta", { itemId: "agent", delta: " live" })]);

    expect(updated).not.toBe(value);
    expect(updated.turns[0]).toBe(value.turns[0]);
    expect(updated.turns[1]).not.toBe(value.turns[1]);
    expect(updated.turns[1]?.items[0]).toBe(value.turns[1]?.items[0]);
    expect(updated.turns[1]?.items[1]).not.toBe(value.turns[1]?.items[1]);
    expect(updated.turns[1]?.items[1]).toMatchObject({ type: "agentMessage", text: "hello live" });
    expect(value.turns[1]?.items[1]).toMatchObject({ type: "agentMessage", text: "hello" });

    const continued = applyThreadEventsImmutable(updated, [event("item/agentMessage/delta", { itemId: "agent", delta: " again" })]);
    expect(continued.turns[1]?.items[1]).toMatchObject({ type: "agentMessage", text: "hello live again" });
  });

  it("detects a delta whose item prerequisite was lost", () => {
    expect(threadProjectionNeedsAuthoritativeRepair(thread(), [{
      version: 1,
      threadId: "thread",
      operation: {
        kind: "itemTextDelta",
        turnId: "turn",
        itemId: "missing",
        itemType: "agentMessage",
        delta: "tail",
      },
    }])).toBe(true);
  });

  it("accepts a contiguous delta whose item is already projected", () => {
    expect(threadProjectionNeedsAuthoritativeRepair(thread(), [{
      version: 1,
      threadId: "thread",
      operation: {
        kind: "itemTextDelta",
        turnId: "turn",
        itemId: "agent",
        itemType: "agentMessage",
        delta: " tail",
      },
    }])).toBe(false);
  });

  it("requires terminal reconciliation before acknowledging turn completion", () => {
    const value = thread();
    expect(threadProjectionNeedsAuthoritativeRepair(value, [{
      version: 1,
      threadId: "thread",
      operation: { kind: "turnCompleted", turn: { ...value.turns[0]!, status: "completed" } },
    }])).toBe(true);
  });
});

function event(method: string, params: Record<string, unknown>): Record<string, unknown> {
  return { method, params: { threadId: "thread", turnId: "turn", ...params } };
}

function usageEvent(usage: TurnUsageProjection): Record<string, unknown> {
  return {
    method: "thread/tokenUsage/updated",
    params: { threadId: "thread", turnId: "turn", tokenUsage: {} },
    codewideThreadPatch: { version: 1, threadId: "thread", operation: { kind: "tokenUsage", usage } },
  };
}

function turnUsageProjection(): TurnUsageProjection {
  const tokens = { totalTokens: 12, inputTokens: 8, cachedInputTokens: 4, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 1 };
  return {
    version: 1,
    status: "live",
    modelContextWindow: 200_000,
    latestRequest: tokens,
    turn: { tokens, cost: null },
    thread: { tokens: { ...tokens, totalTokens: 42, inputTokens: 30, cachedInputTokens: 20, outputTokens: 12, reasoningOutputTokens: 4 }, cost: null },
  };
}

function thread(): Thread {
  return {
    id: "thread", extra: null, sessionId: "thread", forkedFromId: null, parentThreadId: null,
    preview: "preview", ephemeral: false, section: null, sectionEnteredAt: null, historyMode: "paginated",
    modelProvider: "openai", createdAt: 1, updatedAt: 1, recencyAt: 1, status: { type: "active", activeFlags: [] },
    path: null, cwd: "/workspace", cliVersion: "0.147.0", source: "appServer", canAcceptDirectInput: true,
    threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: "Thread",
    turns: [{
      id: "turn", itemsView: "full", status: "inProgress", error: null, startedAt: 1, completedAt: null, durationMs: null,
      items: [
        { type: "userMessage", id: "user", clientId: "client-1", content: [{ type: "text", text: "go", text_elements: [] }] },
        { type: "agentMessage", id: "agent", text: "hello", phase: null, memoryCitation: null },
        { type: "plan", id: "plan", text: "one" },
        { type: "commandExecution", id: "command", pluginId: null, scriptPath: null, command: "x", cwd: "/workspace", processId: null, source: "agent", status: "inProgress", commandActions: [], aggregatedOutput: "a\n", exitCode: null, durationMs: null },
        { type: "reasoning", id: "reasoning", summary: [], content: [] },
        { type: "mcpToolCall", id: "mcp", server: "repo", tool: "search", status: "inProgress", arguments: {}, appContext: null, pluginId: null, readOnlyHint: true, result: null, error: null, durationMs: null },
      ],
    }],
  };
}
