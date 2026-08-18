import { describe, expect, it } from "vitest";

import {
  projectSubagentConversation,
  subagentActivityTargetThreadId,
  SubagentListProjection,
  subagentDisplayName,
  subagentOwnTurns,
  subagentsForThread,
} from "../src/data/subagent-projection";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";

function summary(
  id: string,
  parentThreadId: string | null,
  recencyAt: number,
  overrides: Partial<StoredThreadSummary> = {},
): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: id,
    parentThreadId,
    agentNickname: null,
    agentRole: null,
    name: null,
    preview: "",
    cwd: "/workspace",
    updatedAt: recencyAt,
    recencyAt,
    status: { type: "idle" },
    pinned: false,
    archived: false,
    pendingRequestCount: 0,
    latestActivityCursor: 0,
    lastSeenCursor: 0,
    unread: 0,
    deleteCommandId: null,
    ...overrides,
  };
}

describe("subagent projection", () => {
  it("keeps subagents out of the root projection and sorts them by recency", () => {
    const projection = new SubagentListProjection();
    const values = [summary("root", null, 4), summary("old", "root", 1), summary("new", "root", 3)];

    expect(projection.project(values).map((row) => row.remoteThreadId)).toEqual(["new", "old"]);
    expect(projection.project(values)).toBe(projection.project(values));
  });

  it("does not freeze an initially empty projection when a live-query array mutates in place", () => {
    const projection = new SubagentListProjection();
    const values = [summary("root", null, 1)];

    expect(projection.project(values)).toEqual([]);
    values.push(summary("spawned", "root", 2));

    expect(projection.project(values).map((row) => row.remoteThreadId)).toEqual(["spawned"]);
  });

  it("includes nested descendants without leaking a sibling tree", () => {
    const values = [
      summary("direct", "root", 2),
      summary("nested", "direct", 4),
      summary("sibling", "other-root", 9),
    ];

    expect(subagentsForThread(values, "root").map((row) => row.remoteThreadId)).toEqual(["nested", "direct"]);
  });

  it("uses the app-server nickname as the visible title", () => {
    const value = summary("agent", "root", 1, { agentNickname: "frontend_taste", name: "Fallback", agentRole: "frontend" });
    expect(subagentDisplayName(value)).toBe("frontend_taste");
  });

  it("removes the inherited parent transcript at the child creation boundary", () => {
    const child = thread("child", "root", 200, [
      turn("parent-turn", 190, "parent prompt"),
      agentTurn("child-turn", 201, "working"),
    ]);

    expect(subagentOwnTurns(child).map((value) => value.id)).toEqual(["child-turn"]);
    expect(projectSubagentConversation(child, null).thread.turns.map((value) => value.id)).toEqual(["child-turn"]);
  });

  it("materializes a collab prompt when app-server exposes it only on the parent", () => {
    const parent = thread("root", null, 100, [{
      ...turn("spawn-turn", 199, ""),
      items: [{
        type: "collabAgentToolCall",
        id: "spawn",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "root",
        receiverThreadIds: ["child"],
        prompt: "Audit the renderer boundary.",
        model: null,
        reasoningEffort: null,
        agentsStates: {},
      }],
    }]);
    const child = thread("child", "root", 200, [agentTurn("child-turn", 201, "working")]);

    const projection = projectSubagentConversation(child, parent);

    expect(projection.delegationPrompt).toBe("Audit the renderer boundary.");
    expect(projection.thread.turns.map((value) => value.id)).toEqual(["child-turn"]);
    expect(projection.thread.turns[0]?.items).toEqual([
      {
        type: "userMessage",
        id: "child:delegated-task",
        clientId: null,
        content: [{ type: "text", text: "Audit the renderer boundary.", text_elements: [] }],
      },
      { type: "agentMessage", id: "child-turn-message", text: "working", phase: "commentary", memoryCitation: null },
    ]);
  });

  it("removes injected user-role bootstrap content and exposes the stable task name", () => {
    const child = {
      ...thread("child", "root", 200, [{
        ...agentTurn("child-turn", 201, "working"),
        items: [
          ...turn("bootstrap", 201, "<AGENTS.md>internal instructions</AGENTS.md>").items,
          ...agentTurn("answer", 201, "working").items,
        ],
      }]),
      source: {
        subAgent: {
          thread_spawn: { agent_path: "/root/research_draft_deep" },
        },
      },
    } as Thread;

    const projection = projectSubagentConversation(child, null);

    expect(projection.taskName).toBe("research draft deep");
    expect(projection.thread.turns[0]?.items.map((item) => item.type)).toEqual(["agentMessage"]);
  });

  it("preserves a real child input and does not duplicate it with parent metadata", () => {
    const child = thread("child", "root", 200, [{
      ...agentTurn("child-turn", 201, "working"),
      items: [
        ...turn("bootstrap", 201, "<environment_context>internal</environment_context>").items,
        ...turn("handoff", 201, "Review the native renderer.").items,
        ...agentTurn("answer", 201, "working").items,
      ],
    }]);
    const parent = thread("root", null, 100, [{
      ...turn("spawn-turn", 199, ""),
      items: [{
        type: "collabAgentToolCall",
        id: "spawn",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "root",
        receiverThreadIds: ["child"],
        prompt: "Review the native renderer.",
        model: null,
        reasoningEffort: null,
        agentsStates: {},
      }],
    }]);

    const items = projectSubagentConversation(child, parent).thread.turns[0]?.items ?? [];
    expect(items.filter((item) => item.type === "userMessage")).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "userMessage", content: [{ text: "Review the native renderer." }] });
  });

  it("materializes the exact parent handoff without reordering the child transcript", () => {
    const parent = thread("root", null, 100, [{
      ...turn("spawn-turn", 199, ""),
      items: [{
        type: "collabAgentToolCall",
        id: "spawn",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "root",
        receiverThreadIds: ["child"],
        prompt: "Inspect the streaming renderer.",
        model: null,
        reasoningEffort: null,
        agentsStates: {},
      }],
    }]);
    const child = thread("child", "root", 200, [{
      ...turn("child-turn", 201, ""),
      items: [
        { type: "agentMessage", id: "commentary-1", text: "Inspecting", phase: "commentary", memoryCitation: null },
        {
          type: "commandExecution",
          id: "command",
          command: "rg bug",
          cwd: "/workspace",
          processId: null,
          status: "completed",
          commandActions: [],
          aggregatedOutput: "match",
          exitCode: 0,
          durationMs: 10,
        },
        { type: "agentMessage", id: "commentary-2", text: "Found it", phase: "commentary", memoryCitation: null },
        { type: "agentMessage", id: "result", text: "Fixed", phase: "final_answer", memoryCitation: null },
      ],
    }]);

    expect(projectSubagentConversation(child, parent).thread.turns[0]?.items.map((item) => item.type)).toEqual([
      "userMessage",
      "agentMessage",
      "commandExecution",
      "agentMessage",
      "agentMessage",
    ]);
  });

  it("creates an ordinary pending conversation turn when only the handoff is available", () => {
    const child = {
      ...thread("child", "root", 200, []),
      status: { type: "active", activeFlags: [] },
    } as Thread;
    const parent = thread("root", null, 100, [{
      ...turn("spawn-turn", 199, ""),
      items: [{
        type: "collabAgentToolCall",
        id: "spawn",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "root",
        receiverThreadIds: ["child"],
        prompt: "Start the audit.",
        model: null,
        reasoningEffort: null,
        agentsStates: {},
      }],
    }]);

    const projected = projectSubagentConversation(child, parent).thread.turns[0];
    expect(projected).toMatchObject({ status: "inProgress", completedAt: null });
    expect(projected?.items[0]).toMatchObject({ type: "userMessage", content: [{ text: "Start the audit." }] });
  });

  it("resolves a concrete subagent navigation target without guessing among several receivers", () => {
    expect(subagentActivityTargetThreadId({
      type: "subAgentActivity",
      id: "activity",
      kind: "started",
      agentThreadId: "child",
      agentPath: "/root/child",
    })).toBe("child");
    expect(subagentActivityTargetThreadId({
      type: "collabAgentToolCall",
      id: "spawn",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "root",
      receiverThreadIds: ["child"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: {},
    })).toBe("child");
    expect(subagentActivityTargetThreadId({
      type: "collabAgentToolCall",
      id: "wait",
      tool: "wait",
      status: "completed",
      senderThreadId: "root",
      receiverThreadIds: ["first", "second"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: {},
    })).toBeNull();
  });
});

function turn(id: string, startedAt: number, prompt: string): Turn {
  return {
    id,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt,
    completedAt: startedAt + 1,
    durationMs: 1_000,
    items: prompt === "" ? [] : [{
      type: "userMessage",
      id: `${id}-prompt`,
      clientId: null,
      content: [{ type: "text", text: prompt, text_elements: [] }],
    }],
  };
}

function agentTurn(id: string, startedAt: number, text: string): Turn {
  return {
    ...turn(id, startedAt, ""),
    items: [{ type: "agentMessage", id: `${id}-message`, text, phase: "commentary", memoryCitation: null }],
  };
}

function thread(id: string, parentThreadId: string | null, createdAt: number, turns: Turn[]): Thread {
  return {
    id,
    parentThreadId,
    createdAt,
    turns,
  } as unknown as Thread;
}
