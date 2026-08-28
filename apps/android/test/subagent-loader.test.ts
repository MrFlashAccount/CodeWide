import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { loadSubagentDescendants, subagentActivityRootThreadId } from "../src/data/subagent-loader";

function indexedThread(id: string, parentThreadId: string, archived = false) {
  return {
    id,
    parentThreadId,
    cwd: "/repo",
    createdAt: 1,
    updatedAt: 1,
    modelProvider: "openai",
    cliVersion: "0.147.0",
    source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId } } },
    agentNickname: id,
    agentRole: "worker",
    archived,
  };
}

describe("subagent descendant loading", () => {
  it("requests an authoritative descendant refresh for live subagent activity", () => {
    expect(subagentActivityRootThreadId({
      method: "item/completed",
      params: {
        threadId: "root",
        item: { type: "subAgentActivity", kind: "started", agentThreadId: "child" },
      },
    })).toBe("root");
    expect(subagentActivityRootThreadId({
      method: "item/completed",
      params: { threadId: "root", item: { type: "agentMessage" } },
    })).toBeNull();
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
