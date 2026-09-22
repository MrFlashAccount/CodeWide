import { describe, expect, it, vi } from "vitest";
import { createSearchWorkspaceAdapter } from "../src/features/search/workspaceAdapter";

describe("server-owned search membership", () => {
  it("renders the server page without a local supervisor policy", async () => {
    const data = [
      {
        excerpt: "text",
        kind: "agent_message",
        messageId: 1,
        project: "project",
        sourceOffset: 1,
        threadId: "server-admitted",
        timestamp: "2026-09-17T00:00:00.000Z",
        title: "Assistant",
        turnId: "turn",
      },
    ];
    const rpcAfterAttach = vi.fn(async () => ({
      data,
      failedSources: 0,
      indexing: false,
      nextOffset: 30,
    }));
    const adapter = createSearchWorkspaceAdapter({
      getPendingRequests: () => null,
      getSession: () => ({ rpc: vi.fn(), stop: vi.fn() }),
      getSummaries: () => null,
      rpcAfterAttach,
    });
    const page = await adapter.searchMessages("server", {
      from: null,
      until: null,
      offset: 0,
      project: null,
      query: "text",
      threadId: null,
    });
    expect(page.data).toEqual(data);
    expect(page.nextOffset).toBe(30);
  });
  it("preserves server rejection instead of inventing local admission", async () => {
    const rpcAfterAttach = vi.fn(async () => {
      throw new Error("Invalid search query");
    });
    const adapter = createSearchWorkspaceAdapter({
      getPendingRequests: () => null,
      getSession: () => ({ rpc: vi.fn(), stop: vi.fn() }),
      getSummaries: () => null,
      rpcAfterAttach,
    });
    await expect(
      adapter.searchConversation("server", {
        direction: "around",
        messageId: 1,
        threadId: "hidden",
      }),
    ).rejects.toThrow("Invalid search query");
    expect(rpcAfterAttach).toHaveBeenCalledOnce();
  });
});
