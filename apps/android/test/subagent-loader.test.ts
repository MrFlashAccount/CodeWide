import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { loadSubagentDescendants, subagentRefreshRoot } from "../src/data/subagent-loader";

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
  it("reads a root's descendants again when the Companion invalidates them", () => {
    expect(subagentRefreshRoot({
      method: "companion/thread/subagents/invalidated",
      params: { threadId: "root" },
    })).toBe("root");
    expect(subagentRefreshRoot({ method: "companion/thread/subagents/invalidated", params: {} }))
      .toBeNull();
  });

  it("requests a descendant refresh for completed Codex subagent activity", () => {
    expect(subagentRefreshRoot({
      method: "item/completed",
      params: {
        threadId: "root",
        item: { type: "subAgentActivity", kind: "started", agentThreadId: "child" },
      },
    })).toBe("root");
    expect(subagentRefreshRoot({
      method: "item/started",
      params: { threadId: "root", item: { type: "subAgentActivity", kind: "started" } },
    })).toBeNull();
    expect(subagentRefreshRoot({
      method: "item/completed",
      params: { threadId: "root", item: { type: "agentMessage" } },
    })).toBeNull();
  });

  it("refreshes descendants once when a Claude or CodeWide spawning call completes", () => {
    const call = (method: string, item: Record<string, unknown>) => ({
      method,
      params: { threadId: "root", item },
    });
    const claude = { type: "collabAgentToolCall", tool: "spawnAgent", status: "inProgress" };
    const codewide = { type: "dynamicToolCall", tool: "codewide_spawn_agent" };
    expect(subagentRefreshRoot(call("item/completed", claude))).toBe("root");
    expect(subagentRefreshRoot(call("item/completed", codewide))).toBe("root");
    expect(subagentRefreshRoot(call("item/started", claude))).toBeNull();
    expect(subagentRefreshRoot(call("item/started", codewide))).toBeNull();
    expect(subagentRefreshRoot(call("item/completed", { ...claude, tool: "sendInput" }))).toBeNull();
    expect(subagentRefreshRoot(call("item/completed", { ...codewide, tool: "codewide_wait_agent" })))
      .toBeNull();
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

  it("takes a sub-agent's status from its index row when the provider reports it", async () => {
    const rpc = vi.fn(async () => ({
      threads: [
        { ...indexedThread("running", "root"), running: true },
        { ...indexedThread("done", "root"), running: false },
        indexedThread("codex", "root"),
      ],
    }));
    // WHY: the loader calls only `rpc`; the remaining client surface is not part of this read.
    const session = { rpc } as unknown as RpcClient;
    const statuses = (await loadSubagentDescendants(session, "root")).map(({ thread }) => thread.status.type);
    expect(statuses).toEqual(["active", "idle", "notLoaded"]);
  });

  it("rejects an index answer with a malformed row", async () => {
    const rpc = vi.fn(async () => ({ threads: [{ ...indexedThread("bad", "root"), archived: "no" }] }));
    // WHY: the loader calls only `rpc`; the remaining client surface is not part of this read.
    const session = { rpc } as unknown as RpcClient;
    await expect(loadSubagentDescendants(session, "root")).rejects.toThrow(
      "Companion returned an invalid subagent index row",
    );
  });
});
