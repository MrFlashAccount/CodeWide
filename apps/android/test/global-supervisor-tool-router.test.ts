import { describe, expect, it, vi } from "vitest";

import {
  createGlobalSupervisorToolRouter,
  type GlobalSupervisorToolCapabilities,
} from "../src/data/globalSupervisorToolRouter";
import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";

const SUPERVISOR = globalSupervisorQualifiedChatRef("home-server", "supervisor-thread");

function capabilities(): GlobalSupervisorToolCapabilities {
  return {
    assertLiveTarget: vi.fn(),
    createChat: vi.fn(async ({ connectionId }) =>
      globalSupervisorQualifiedChatRef(connectionId, "created-thread"),
    ),
    deriveTargetSendCommandId: vi.fn(
      async ({ connectionId, requestId }) => `opaque:${connectionId}:${String(requestId)}`,
    ),
    deriveWorkerCreationSource: vi.fn(async () => "worker-source"),
    followChat: vi.fn(async () => undefined),
    listChats: vi.fn(async () => ({ cursor: null, items: [] })),
    readChat: vi.fn(async () => ({ cursor: null, items: [] })),
    respond: vi.fn(async () => undefined),
    sendText: vi.fn(async ({ commandId }) => commandId),
    unfollowChat: vi.fn(async () => undefined),
  };
}

describe("GlobalSupervisorToolRouter", () => {
  it("passes qualified read targets and generated bounds to the history owner", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    await router.handle({
      connectionId: "home-server",
      params: {
        arguments: { connectionId: "target-server", cursor: "next", threadId: "target-thread" },
        callId: "call-1",
        namespace: null,
        threadId: "supervisor-thread",
        tool: "readChat",
        turnId: "turn-1",
      },
      requestId: 7,
      supervisor: SUPERVISOR,
    });

    expect(lower.readChat).toHaveBeenCalledWith({
      cursor: "next",
      limit: 100,
      maxBytes: 262_144,
      target: { connectionId: "target-server", threadId: "target-thread" },
    });
    expect(lower.respond).toHaveBeenCalledTimes(1);
  });

  it("uses one request-derived command identity for one explicit send", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const request = {
      connectionId: "home-server",
      params: {
        arguments: { connectionId: "target-server", text: "ship it", threadId: "target-thread" },
        callId: "call-2",
        namespace: null,
        threadId: "supervisor-thread",
        tool: "sendText",
        turnId: "turn-2",
      },
      requestId: "request-2",
      supervisor: SUPERVISOR,
    } as const;
    await router.handle(request);
    await router.handle(request);

    const expected = {
      commandId: "opaque:home-server:request-2",
      supervisor: SUPERVISOR,
      target: { connectionId: "target-server", threadId: "target-thread" },
      text: "ship it",
    };
    expect(lower.sendText).toHaveBeenNthCalledWith(1, expected);
    expect(lower.sendText).toHaveBeenNthCalledWith(2, expected);
  });

  it("routes create, follow and unfollow through the exact supervisor relation", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const envelope = (
      tool: "createChat" | "followChat" | "unfollowChat",
      argumentsValue: unknown,
    ) => ({
      arguments: argumentsValue,
      callId: `call-${tool}`,
      namespace: null,
      threadId: SUPERVISOR.threadId,
      tool,
      turnId: `turn-${tool}`,
    });

    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("createChat", { connectionId: "target-server", cwd: null }),
      requestId: "create-request",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("followChat", {
        connectionId: "target-server",
        threadId: "target-thread",
      }),
      requestId: "follow-request",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("unfollowChat", {
        connectionId: "target-server",
        threadId: "target-thread",
      }),
      requestId: "unfollow-request",
      supervisor: SUPERVISOR,
    });

    expect(lower.createChat).toHaveBeenCalledWith({
      connectionId: "target-server",
      cwd: null,
      source: "worker-source",
      supervisor: SUPERVISOR,
    });
    expect(lower.followChat).toHaveBeenCalledWith(SUPERVISOR, {
      connectionId: "target-server",
      threadId: "target-thread",
    });
    expect(lower.unfollowChat).toHaveBeenCalledWith(SUPERVISOR, {
      connectionId: "target-server",
      threadId: "target-thread",
    });
  });

  it("derives distinct target ids from distinct request identities even with one call id", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const params = {
      arguments: { connectionId: "target-server", text: "ship it", threadId: "target-thread" },
      callId: "same-call",
      namespace: null,
      threadId: "supervisor-thread",
      tool: "sendText",
      turnId: "turn-2",
    } as const;

    await router.handle({
      connectionId: "home-server",
      params,
      requestId: "request-a",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: "home-server",
      params,
      requestId: "request-b",
      supervisor: SUPERVISOR,
    });

    expect(lower.sendText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commandId: "opaque:home-server:request-a" }),
    );
    expect(lower.sendText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ commandId: "opaque:home-server:request-b" }),
    );
  });

  it("settles malformed and unknown calls without invoking a tool", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    await router.handle({
      connectionId: "home-server",
      params: {
        arguments: {},
        callId: "call-3",
        namespace: null,
        threadId: "supervisor-thread",
        tool: "deleteChat",
        turnId: "turn-3",
      },
      requestId: "request-3",
      supervisor: SUPERVISOR,
    });

    expect(lower.listChats).not.toHaveBeenCalled();
    expect(lower.readChat).not.toHaveBeenCalled();
    expect(lower.sendText).not.toHaveBeenCalled();
    expect(lower.respond).toHaveBeenCalledWith({
      connectionId: "home-server",
      requestId: "request-3",
      result: {
        contentItems: [
          { text: JSON.stringify({ error: "invalidOrUnsupportedToolCall" }), type: "inputText" },
        ],
        success: false,
      },
    });
  });

  it("rejects undeclared top-level and per-tool fields", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    await router.handle({
      connectionId: "home-server",
      params: {
        arguments: { cursor: null, extra: true },
        callId: "call-4",
        namespace: null,
        threadId: "supervisor-thread",
        tool: "listChats",
        turnId: "turn-4",
      },
      requestId: "request-4",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: "home-server",
      params: {
        arguments: { cursor: null },
        callId: "call-5",
        extra: true,
        namespace: null,
        threadId: "supervisor-thread",
        tool: "listChats",
        turnId: "turn-5",
      },
      requestId: "request-5",
      supervisor: SUPERVISOR,
    });

    expect(lower.listChats).not.toHaveBeenCalled();
    expect(lower.respond).toHaveBeenCalledTimes(2);
  });

  it("maps secret-bearing external failures to one bounded failure kind", async () => {
    const lower = capabilities();
    vi.mocked(lower.listChats).mockRejectedValue(
      new Error("https://service.test/?token=secret prompt content"),
    );
    const router = createGlobalSupervisorToolRouter(lower);
    await router.handle({
      connectionId: "home-server",
      params: {
        arguments: { cursor: null },
        callId: "call-6",
        namespace: null,
        threadId: "supervisor-thread",
        tool: "listChats",
        turnId: "turn-6",
      },
      requestId: "request-6",
      supervisor: SUPERVISOR,
    });

    expect(JSON.stringify(vi.mocked(lower.respond).mock.calls)).not.toContain("secret");
    expect(lower.respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        result: {
          contentItems: [
            { text: JSON.stringify({ error: "toolExecutionFailed" }), type: "inputText" },
          ],
          success: false,
        },
      }),
    );
  });
});
