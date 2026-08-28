import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { loadThreadCatalog } from "../src/data/thread-catalog-loader";

function thread(id: string, parentThreadId: string | null = null, ephemeral = false): Thread {
  return {
    id,
    parentThreadId,
    name: id,
    preview: "",
    cwd: "/repo",
    updatedAt: 1,
    status: { type: "idle" },
    ephemeral,
    turns: [],
  } as Thread;
}

describe("thread catalog loading", () => {
  it("loads every root-thread page across active and archived partitions", async () => {
    const rpc = vi.fn(async (_method: string, params: unknown) => {
      const input = params as { archived: boolean; cursor: string | null };
      if (!input.archived && input.cursor === null) {
        return {
          data: [thread("active-1"), thread("child", "active-1"), thread("temporary", null, true)],
          nextCursor: "next",
        };
      }
      if (!input.archived) return { data: [thread("active-2")], nextCursor: null };
      return { data: [thread("archived")], nextCursor: null };
    });
    const session = { rpc } as unknown as RpcClient;

    const snapshots = await loadThreadCatalog(session);

    expect(snapshots.map(({ thread: value, archived }) => [value.id, archived])).toEqual([
      ["active-1", false],
      ["active-2", false],
      ["archived", true],
    ]);
    expect(rpc).toHaveBeenCalledTimes(3);
    for (const [, params] of rpc.mock.calls) {
      expect(params).toMatchObject({
        limit: 100,
        modelProviders: [],
        useStateDbOnly: true,
      });
    }
  });

  it("rejects a repeated pagination cursor instead of looping forever", async () => {
    const rpc = vi.fn(async () => ({ data: [], nextCursor: "same" }));

    await expect(loadThreadCatalog({ rpc } as unknown as RpcClient))
      .rejects.toThrow("thread/list returned a repeated catalog cursor");
  });
});
