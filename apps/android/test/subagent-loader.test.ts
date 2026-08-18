import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { loadSubagentDescendants, subagentActivityRootThreadId } from "../src/data/subagent-loader";

function thread(id: string, parentThreadId: string): Thread {
  return {
    id,
    parentThreadId,
    name: id,
    preview: "",
    cwd: "/repo",
    updatedAt: 1,
    status: { type: "idle" },
    ephemeral: false,
    turns: [],
  } as Thread;
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

  it("loads every active and archived page with the ancestor filter", async () => {
    const rpc = vi.fn(async (_method: string, params: unknown) => {
      const input = params as { archived: boolean; cursor: string | null };
      if (!input.archived && input.cursor === null) return { data: [thread("active-1", "root")], nextCursor: "next" };
      if (!input.archived) return { data: [thread("active-2", "active-1")], nextCursor: null };
      return { data: [thread("archived", "root")], nextCursor: null };
    });
    const session = { rpc } as unknown as RpcClient;

    const snapshots = await loadSubagentDescendants(session, "root");

    expect(snapshots.map(({ thread: value, archived }) => [value.id, archived])).toEqual([
      ["active-1", false],
      ["active-2", false],
      ["archived", true],
    ]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ ancestorThreadId: "root", useStateDbOnly: false });
  });
});
