import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { loadSubagentDescendants, subagentActivity } from "../src/data/subagent-loader";

function indexedThread(id: string, parentThreadId: string, archived = false) {
  return {
    environments: null,
    projectId: null,
    model: null,
    reasoningEffort: null,
    originator: null,
    daybreakEnabled: null,
    id,
    parentThreadId,
    cwd: "/repo",
    createdAt: 1,
    updatedAt: 1,
    modelProvider: "openai",
    cliVersion: "0.155.1",
    source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId } } },
    agentNickname: id,
    agentRole: "worker",
    archived,
  };
}

describe("subagent descendant loading", () => {
  it("requests an authoritative descendant refresh for live subagent activity", () => {
    expect(subagentActivity({
      method: "item/completed",
      params: {
        threadId: "root",
        item: { type: "subAgentActivity", kind: "started", agentThreadId: "child" },
      },
    })).toEqual({ rootThreadId: "root", spawning: false });
    expect(subagentActivity({
      method: "item/started",
      params: { threadId: "root", item: { type: "subAgentActivity", kind: "started" } },
    })).toBeNull();
    expect(subagentActivity({
      method: "item/completed",
      params: { threadId: "root", item: { type: "agentMessage" } },
    })).toBeNull();
  });

  it("treats a Claude spawning call as subagent activity from its start", () => {
    const spawn = (method: string, tool = "spawnAgent") => ({
      method,
      params: {
        threadId: "root",
        item: { type: "collabAgentToolCall", tool, receiverThreadIds: [], status: "inProgress" },
      },
    });
    expect(subagentActivity(spawn("item/started"))).toEqual({ rootThreadId: "root", spawning: true });
    expect(subagentActivity(spawn("item/completed"))).toEqual({ rootThreadId: "root", spawning: false });
    expect(subagentActivity(spawn("item/started", "sendInput"))).toBeNull();
  });

  it("loads the descendant tree from one local parent-index RPC", async () => {
    const rpc = vi.fn(async () => ({
      threads: [
        indexedThread("active-1", "root"),
        indexedThread("active-2", "active-1"),
        indexedThread("archived", "root", true),
      ],
    }));
    const session = { rpc } as unknown as RpcClient;

    const snapshots = await loadSubagentDescendants(session, "root");

    expect(snapshots.map(({ thread: value, archived }) => [value.id, archived])).toEqual([
      ["active-1", false],
      ["active-2", false],
      ["archived", true],
    ]);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("companion/threadSubagents/read", { threadId: "root" });
  });
});
