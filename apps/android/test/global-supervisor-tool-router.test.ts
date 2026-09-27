import { describe, expect, it, vi } from "vitest";

import {
  createGlobalSupervisorToolRouter,
  type GlobalSupervisorToolCapabilities,
} from "../src/data/globalSupervisorToolRouter";
import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import { globalSupervisorAttachmentLimits } from "../src/data/globalSupervisorChatAttachments";

const SUPERVISOR = globalSupervisorQualifiedChatRef("home-server", "supervisor-thread");

function capabilities(): GlobalSupervisorToolCapabilities {
  return {
    assertLiveTarget: vi.fn(),
    startTask: vi.fn(async ({ commandId, connectionId }) => ({
      chat: globalSupervisorQualifiedChatRef(connectionId, "created-thread"),
      commandId,
      delivery: "durablyQueued" as const,
    })),
    deriveTargetSendCommandId: vi.fn(
      async ({ connectionId, requestId }) => `opaque:${connectionId}:${String(requestId)}`,
    ),
    deriveWorkerCreationSource: vi.fn(async () => "worker-source"),
    followChat: vi.fn(async () => undefined),
    findChat: vi.fn(async () => ({ status: "notFound" as const })),
    inspectChat: vi.fn(async (target) => ({ target, turn: null })),
    interruptChat: vi.fn(async (target) => ({
      status: "alreadyIdle" as const,
      target,
      turnId: null,
    })),
    listActiveWork: vi.fn(async () => ({ items: [], truncated: false })),
    listChatAttachments: vi.fn(async (target) => ({ items: [], target, truncated: false })),
    listChats: vi.fn(async () => ({ cursor: null, items: [] })),
    readChat: vi.fn(async () => ({ cursor: null, items: [] })),
    readChatAttachment: vi.fn(async ({ attachmentId, offset, target }) => ({
      attachmentId,
      contentType: "text/markdown",
      limitReached: false,
      name: "report.md",
      nextOffset: null,
      offset,
      target,
      text: "report",
      totalBytes: 6,
      truncated: false,
    })),
    respond: vi.fn(async () => undefined),
    respondToRequest: vi.fn(async ({ eventId }) => ({ eventId, responded: true as const })),
    sendText: vi.fn(async ({ commandId }) => commandId),
    unfollowChat: vi.fn(async () => undefined),
    setSpokenAttention: vi.fn(async () => ({ mode: "active" as const })),
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

  it("routes current-state inspection by qualified identity", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    await router.handle({
      connectionId: "home-server",
      params: {
        arguments: { connectionId: "target-server", threadId: "target-thread" },
        callId: "call-inspect",
        namespace: null,
        threadId: "supervisor-thread",
        tool: "inspectChat",
        turnId: "turn-inspect",
      },
      requestId: "inspect-request",
      supervisor: SUPERVISOR,
    });

    expect(lower.inspectChat).toHaveBeenCalledWith({
      connectionId: "target-server",
      threadId: "target-thread",
    });
    expect(lower.respond).toHaveBeenCalledTimes(1);
  });

  it("routes attachment listing and bounded text reads by qualified identity", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const attachmentId = `attachment-v1-${"a".repeat(32)}`;
    const envelope = (tool: "listChatAttachments" | "readChatAttachment", args: unknown) => ({
      arguments: args,
      callId: `call-${tool}`,
      namespace: null,
      threadId: SUPERVISOR.threadId,
      tool,
      turnId: `turn-${tool}`,
    });

    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("listChatAttachments", {
        connectionId: "target-server",
        threadId: "target-thread",
      }),
      requestId: "list-attachments",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("readChatAttachment", {
        attachmentId,
        connectionId: "target-server",
        offset: 65_536,
        threadId: "target-thread",
      }),
      requestId: "read-attachment",
      supervisor: SUPERVISOR,
    });

    expect(lower.listChatAttachments).toHaveBeenCalledWith({
      connectionId: "target-server",
      threadId: "target-thread",
    });
    expect(lower.readChatAttachment).toHaveBeenCalledWith({
      attachmentId,
      offset: 65_536,
      target: { connectionId: "target-server", threadId: "target-thread" },
    });
    expect(lower.respond).toHaveBeenCalledTimes(2);
  });

  it("rejects forged attachment identities and out-of-range offsets before execution", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const call = async (attachmentId: string, offset: number): Promise<void> =>
      router.handle({
        connectionId: SUPERVISOR.connectionId,
        params: {
          arguments: {
            attachmentId,
            connectionId: "target-server",
            offset,
            threadId: "target-thread",
          },
          callId: "call-invalid-attachment",
          namespace: null,
          threadId: SUPERVISOR.threadId,
          tool: "readChatAttachment",
          turnId: "turn-invalid-attachment",
        },
        requestId: `invalid-${attachmentId}-${String(offset)}`,
        supervisor: SUPERVISOR,
      });

    await call("/private/report.md", 0);
    await call(
      `attachment-v1-${"a".repeat(32)}`,
      globalSupervisorAttachmentLimits.textTotalMaxBytes,
    );

    expect(lower.readChatAttachment).not.toHaveBeenCalled();
    expect(lower.respond).toHaveBeenCalledTimes(2);
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

  it("routes atomic start, follow and unfollow through the exact supervisor relation", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const envelope = (
      tool: "startTask" | "followChat" | "unfollowChat",
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
      params: envelope("startTask", {
        connectionId: "target-server",
        cwd: null,
        objective: "Implement the objective",
      }),
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

    expect(lower.startTask).toHaveBeenCalledWith({
      commandId: "opaque:home-server:create-request",
      connectionId: "target-server",
      cwd: null,
      objective: "Implement the objective",
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

  it("admits only an explicit typed answer tied to the exact request event", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const envelope = (decision: string) => ({
      arguments: {
        answer: { decision, kind: "approval" },
        connectionId: "target-server",
        eventId: "request:exact-event",
        threadId: "target-thread",
      },
      callId: `call-${decision}`,
      namespace: null,
      threadId: SUPERVISOR.threadId,
      tool: "respondToRequest",
      turnId: `turn-${decision}`,
    });

    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("accept"),
      requestId: "valid-response",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope("approveWhatever"),
      requestId: "invalid-response",
      supervisor: SUPERVISOR,
    });

    expect(lower.respondToRequest).toHaveBeenCalledExactlyOnceWith({
      answer: { decision: "accept", kind: "approval" },
      eventId: "request:exact-event",
      target: { connectionId: "target-server", threadId: "target-thread" },
    });
    expect(lower.respond).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "invalid-response" }),
    );
  });

  it("routes a bounded per-chat snooze and rejects an unbounded duration", async () => {
    const lower = capabilities();
    const router = createGlobalSupervisorToolRouter(lower);
    const envelope = (durationMinutes: number) => ({
      arguments: {
        connectionId: "target-server",
        durationMinutes,
        mode: "snoozed",
        threadId: "target-thread",
      },
      callId: `call-${durationMinutes}`,
      namespace: null,
      threadId: SUPERVISOR.threadId,
      tool: "setSpokenAttention",
      turnId: `turn-${durationMinutes}`,
    });

    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope(30),
      requestId: "valid-snooze",
      supervisor: SUPERVISOR,
    });
    await router.handle({
      connectionId: SUPERVISOR.connectionId,
      params: envelope(10_081),
      requestId: "invalid-snooze",
      supervisor: SUPERVISOR,
    });

    expect(lower.setSpokenAttention).toHaveBeenCalledExactlyOnceWith({
      durationMinutes: 30,
      mode: "snoozed",
      supervisor: SUPERVISOR,
      target: { connectionId: "target-server", threadId: "target-thread" },
    });
    expect(lower.respond).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "invalid-snooze" }),
    );
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
    expect(lower.inspectChat).not.toHaveBeenCalled();
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
