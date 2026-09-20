import { describe, expect, it, vi } from "vitest";

import {
  parseGlobalSupervisorBinding,
  type GlobalSupervisorBinding,
} from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorVisibilityPolicy } from "../src/data/globalSupervisorVisibility";
import { createSearchWorkspaceAdapter } from "../src/features/search/workspaceAdapter";

function visibility(
  value: unknown = {
    home: { connectionId: "home-server", threadId: "supervisor-thread" },
    schemaVersion: 1,
    status: "ready",
  },
) {
  const binding = parseGlobalSupervisorBinding(value);
  if (binding === null) {
    throw new Error("Invalid visibility fixture");
  }
  return createGlobalSupervisorVisibilityPolicy(() => binding);
}

describe("global supervisor search visibility", () => {
  it("removes the exact hidden thread from global message search", async () => {
    const rpcAfterAttach = vi.fn(async () => ({
      data: [
        {
          excerpt: "hidden",
          kind: "agent_message",
          messageId: 1,
          project: "project",
          sourceOffset: 1,
          threadId: "supervisor-thread",
          timestamp: "2026-09-17T00:00:00.000Z",
          title: "Supervisor",
          turnId: "turn-hidden",
        },
        {
          excerpt: "visible",
          kind: "agent_message",
          messageId: 2,
          project: "project",
          sourceOffset: 2,
          threadId: "ordinary-thread",
          timestamp: "2026-09-17T00:00:01.000Z",
          title: "Ordinary",
          turnId: "turn-visible",
        },
      ],
      failedSources: 0,
      indexing: false,
      nextOffset: null,
    }));
    const adapter = createSearchWorkspaceAdapter({
      getPendingRequests: () => null,
      getSession: () => ({ rpc: vi.fn(), stop: vi.fn() }),
      getSummaries: () => null,
      getVisibility: visibility,
      rpcAfterAttach,
    });

    const page = await adapter.searchMessages("home-server", {
      from: null,
      offset: 0,
      project: null,
      query: "text",
      threadId: null,
      until: null,
    });
    expect(page.data.map((hit) => hit.threadId)).toEqual(["ordinary-thread"]);
  });

  it("rejects an exact hidden search window before transport access", async () => {
    const rpcAfterAttach = vi.fn(async () => ({
      data: [
        {
          excerpt: "ordinary",
          kind: "agent_message",
          messageId: 1,
          project: "project",
          sourceOffset: 1,
          threadId: "ordinary-thread",
          timestamp: "2026-09-17T00:00:00.000Z",
          title: "Ordinary",
          turnId: "turn-ordinary",
        },
      ],
      failedSources: 0,
      indexing: false,
      nextOffset: null,
    }));
    const adapter = createSearchWorkspaceAdapter({
      getPendingRequests: () => null,
      getSession: () => ({ rpc: vi.fn(), stop: vi.fn() }),
      getSummaries: () => null,
      getVisibility: visibility,
      rpcAfterAttach,
    });

    await expect(
      adapter.searchConversation("home-server", {
        direction: "around",
        messageId: 1,
        threadId: "supervisor-thread",
      }),
    ).rejects.toThrow("not available in ordinary search");
    expect(rpcAfterAttach).not.toHaveBeenCalled();
  });

  it("closes ref-only search while a home creation cannot be classified by thread id", async () => {
    const rpcAfterAttach = vi.fn(async () => ({
      data: [
        {
          excerpt: "ordinary",
          kind: "agent_message",
          messageId: 1,
          project: "project",
          sourceOffset: 1,
          threadId: "ordinary-thread",
          timestamp: "2026-09-17T00:00:00.000Z",
          title: "Ordinary",
          turnId: "turn-ordinary",
        },
      ],
      failedSources: 0,
      indexing: false,
      nextOffset: null,
    }));
    const adapter = createSearchWorkspaceAdapter({
      getPendingRequests: () => null,
      getSession: () => ({ rpc: vi.fn(), stop: vi.fn() }),
      getSummaries: () => null,
      getVisibility: () =>
        visibility({
          creationToken: "creation-token",
          homeConnectionId: "home-server",
          schemaVersion: 1,
          status: "creating",
        }),
      rpcAfterAttach,
    });

    await expect(
      adapter.searchConversation("home-server", {
        direction: "around",
        messageId: 1,
        threadId: "ordinary-thread",
      }),
    ).rejects.toThrow("not available in ordinary search");
    expect(rpcAfterAttach).not.toHaveBeenCalled();
  });

  it("closes every ordinary search when invalid storage has no safe classifier", async () => {
    const binding: GlobalSupervisorBinding = {
      priorHome: null,
      reason: "malformedStorage",
      schemaVersion: 1,
      status: "invalid",
    };
    const rpcAfterAttach = vi.fn(async () => ({
      data: [
        {
          excerpt: "ordinary",
          kind: "agent_message",
          messageId: 1,
          project: "project",
          sourceOffset: 1,
          threadId: "ordinary-thread",
          timestamp: "2026-09-17T00:00:00.000Z",
          title: "Ordinary",
          turnId: "turn-ordinary",
        },
      ],
      failedSources: 0,
      indexing: false,
      nextOffset: null,
    }));
    const adapter = createSearchWorkspaceAdapter({
      getPendingRequests: () => null,
      getSession: () => ({ rpc: vi.fn(), stop: vi.fn() }),
      getSummaries: () => null,
      getVisibility: () => createGlobalSupervisorVisibilityPolicy(() => binding),
      rpcAfterAttach,
    });

    await expect(
      adapter.searchMessages("home-server", {
        from: null,
        offset: 0,
        project: null,
        query: "text",
        threadId: null,
        until: null,
      }),
    ).resolves.toMatchObject({ data: [] });
    expect(rpcAfterAttach).toHaveBeenCalledOnce();
  });
});
