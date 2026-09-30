import { describe, expect, it, vi } from "vitest";

import type { StoredConnection } from "../src/data/connection-profile-types";
import type { PendingServerRequest } from "../src/data/pending-request-types";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { createGlobalSupervisorAttentionOwner } from "../src/data/globalSupervisorAttention";
import { createGlobalSupervisorAttentionDeliverySession } from "../src/data/globalSupervisorAttentionDelivery";
import { createGlobalSupervisorAttentionStorage } from "../src/data/globalSupervisorAttentionStorage.web";
import { createGlobalSupervisorUnsolicitedAdmission } from "../src/data/globalSupervisorUnsolicitedAdmission";
import {
  globalSupervisorQualifiedChatRef,
  parseGlobalSupervisorBinding,
} from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorToolCapabilities } from "../src/data/globalSupervisorTools";
import { globalSupervisorPendingRequestEventId } from "../src/data/globalSupervisorPendingRequest";
import {
  createGlobalSupervisorToolTargetPolicy,
  type GlobalSupervisorToolTargetPolicy,
} from "../src/data/globalSupervisorToolTarget";

const TARGET = globalSupervisorQualifiedChatRef("target-server", "target-thread");

function connection(id: string): StoredConnection {
  return {
    displayName: id,
    iconId: "desktop",
    enabled: true,
    endpoint: `https://${id}.example`,
    id,
    lastError: null,
    lastErrorAt: null,
    sortOrder: 0,
    state: "live",
    token: "test-token",
  };
}

function capabilities({
  currentConnections = () => [connection("target-server")],
  currentPendingRequests = () => [],
  isRpcAvailable = () => true,
  now = () => 0,
  readAttachmentText = vi.fn(async () => ({
    contentType: "text/markdown",
    nextOffset: 0,
    text: "",
    totalBytes: 0,
    truncated: false,
  })),
  readWorkCatalog = async () => [],
  respondToPendingRequest = vi.fn(async () => undefined),
  rpcAfterAttach,
  sendSystemText = vi.fn(async ({ commandId }) => commandId),
  targetPolicy = createGlobalSupervisorToolTargetPolicy(() => null),
}: {
  readonly currentConnections?: () => StoredConnection[];
  readonly currentPendingRequests?: () => readonly PendingServerRequest[];
  readonly isRpcAvailable?: (connectionId: string) => boolean;
  readonly now?: () => number;
  readonly readAttachmentText?: ReturnType<typeof vi.fn>;
  readonly readWorkCatalog?: () => Promise<readonly StoredThreadSummary[]>;
  readonly respondToPendingRequest?: ReturnType<typeof vi.fn>;
  readonly rpcAfterAttach: ReturnType<typeof vi.fn>;
  readonly sendSystemText?: ReturnType<typeof vi.fn>;
  readonly targetPolicy?: GlobalSupervisorToolTargetPolicy;
}) {
  const session = { rpc: vi.fn(), stop: vi.fn() };
  const attention = createGlobalSupervisorAttentionOwner({
    now: () => 0,
    storage: createGlobalSupervisorAttentionStorage(),
  });
  return {
    attention,
    sendSystemText,
    session,
    value: createGlobalSupervisorToolCapabilities({
      attention,
      currentConnections,
      currentPendingRequests,
      deriveTargetSendCommandId: vi.fn(async () => "opaque-command"),
      deriveWorkerCreationSource: vi.fn(async () => "worker-source"),
      getSession: () => session,
      isRpcAvailable,
      now,
      readAttachmentText,
      readWorkCatalog,
      respond: vi.fn(),
      rpcAfterAttach,
      sendSystemText,
      respondToPendingRequest,
      targetPolicy,
    }),
  };
}

function historyEntry(id: string, text: string) {
  return { id, text, type: "agentMessage" };
}

function historyPage(items: readonly unknown[], nextCursor: string | null = null) {
  return { data: [{ id: "turn-1", items }], nextCursor };
}

function catalogEntry(id: string) {
  return { id, name: `Chat ${id}`, preview: `Preview ${id}`, threadSource: null };
}

function workSummary(input: {
  connectionId: string;
  id: string;
  name: string | null;
  preview: string;
  status: StoredThreadSummary["status"];
  updatedAt: number;
}): StoredThreadSummary {
  return {
    archived: false,
    closedQuestionTurnId: null,
    connectionId: input.connectionId,
    cwd: `/projects/${input.name ?? input.id}`,
    deleteCommandId: null,
    lastSeenCursor: 0,
    latestActivityCursor: 0,
    name: input.name,
    parentThreadId: null,
    pendingQuestion: null,
    pendingRequestCount: 0,
    pinned: false,
    preview: input.preview,
    provisionalThread: null,
    recencyAt: input.updatedAt,
    remoteThreadId: input.id,
    skippedQuestions: null,
    status: input.status,
    submittedQuestions: null,
    unread: 0,
    updatedAt: input.updatedAt,
  };
}

describe("GlobalSupervisorToolCapabilities", () => {
  it("atomically creates a visible top-level chat and durably admits its objective", async () => {
    const rpcAfterAttach = vi.fn(async (_session, method) =>
      method === "companion/supervisor/threadList"
        ? { data: [], nextCursor: null }
        : { thread: { id: "worker-thread" } },
    );
    const lower = capabilities({ rpcAfterAttach });
    const supervisor = globalSupervisorQualifiedChatRef("home", "supervisor");
    await lower.attention.enableDelivery(supervisor);

    const acknowledgement = await lower.value.startTask({
      commandId: "command-1",
      connectionId: "target-server",
      cwd: null,
      objective: "Implement the objective",
      source: "codewide-global-supervisor-worker:request",
      supervisor,
    });
    const worker = acknowledgement.chat;
    await lower.attention.ingestEvents("target-server", [
      {
        cursor: 1,
        payload: {
          codewideThreadPatch: {
            operation: {
              kind: "turnCompleted",
              summary: { previewText: "Worker finished" },
              turn: { completedAt: 1, id: "turn-1", status: "completed" },
            },
            threadId: worker.threadId,
            version: 1,
          },
          method: "turn/completed",
          params: {
            threadId: worker.threadId,
            turn: { completedAt: 1, id: "turn-1", status: "completed" },
          },
        },
      },
    ]);

    expect(acknowledgement).toEqual({
      chat: { connectionId: "target-server", threadId: "worker-thread" },
      commandId: "command-1",
      delivery: "durablyQueued",
    });
    expect(rpcAfterAttach).toHaveBeenCalledWith(lower.session, "thread/start", {
      threadSource: "codewide-global-supervisor-worker:request",
    });
    expect(lower.sendSystemText).toHaveBeenCalledWith({
      commandId: "command-1",
      connectionId: "target-server",
      text: "Implement the objective",
      threadId: "worker-thread",
    });
    await expect(lower.attention.pendingCount(supervisor)).resolves.toBe(1);
  });

  it("recovers the same created chat and command after initial delivery admission fails", async () => {
    let created = false;
    const rpcAfterAttach = vi.fn(async (_session, method) => {
      if (method === "companion/supervisor/threadList") {
        return {
          data: created ? [{ id: "recovered-worker" }] : [],
          nextCursor: null,
        };
      }
      created = true;
      return { thread: { id: "recovered-worker" } };
    });
    const sendSystemText = vi
      .fn(async ({ commandId }) => commandId)
      .mockRejectedValueOnce(new Error("native admission unavailable"));
    const lower = capabilities({ rpcAfterAttach, sendSystemText });
    const request = {
      commandId: "stable-command",
      connectionId: "target-server",
      cwd: null,
      objective: "Recover this task",
      source: "codewide-global-supervisor-worker:stable-request",
      supervisor: globalSupervisorQualifiedChatRef("home", "supervisor"),
    } as const;

    await expect(lower.value.startTask(request)).rejects.toThrow("native admission unavailable");
    await expect(lower.value.startTask(request)).resolves.toMatchObject({
      chat: { threadId: "recovered-worker" },
      commandId: "stable-command",
      delivery: "durablyQueued",
    });

    expect(rpcAfterAttach.mock.calls.filter((call) => call[1] === "thread/start")).toHaveLength(1);
    expect(sendSystemText).toHaveBeenCalledTimes(2);
    expect(sendSystemText.mock.calls[0]?.[0]).toMatchObject({ commandId: "stable-command" });
    expect(sendSystemText.mock.calls[1]?.[0]).toMatchObject({ commandId: "stable-command" });
  });

  it("returns one bounded multi-connection active-work snapshot with exact pending identity", async () => {
    const pending: PendingServerRequest = {
      connectionId: "server-b",
      createdAt: 10,
      method: "item/commandExecution/requestApproval",
      params: { reason: "Run the focused tests", threadId: "waiting", turnId: "turn-waiting" },
      requestId: 7,
      requestKey: "number:7",
      state: "pending",
    };
    const rows = [
      workSummary({
        connectionId: "target-server",
        id: "running",
        name: "Android task",
        preview: "Implementing controls",
        status: { activeFlags: [], type: "active" },
        updatedAt: 30,
      }),
      workSummary({
        connectionId: "server-b",
        id: "waiting",
        name: "Companion task",
        preview: "Needs approval",
        status: { activeFlags: ["waitingOnApproval"], type: "active" },
        updatedAt: 20,
      }),
      workSummary({
        connectionId: "server-b",
        id: "failed",
        name: "Failed task",
        preview: "Transport failed",
        status: { type: "systemError" },
        updatedAt: 10,
      }),
      workSummary({
        connectionId: "target-server",
        id: "completed",
        name: "Completed task",
        preview: "Done",
        status: { type: "idle" },
        updatedAt: 5,
      }),
    ];
    const lower = capabilities({
      currentConnections: () => [connection("target-server"), connection("server-b")],
      currentPendingRequests: () => [pending],
      readWorkCatalog: async () => rows,
      rpcAfterAttach: vi.fn(),
    });
    const snapshot = await lower.value.listActiveWork(
      globalSupervisorQualifiedChatRef("home", "supervisor"),
    );

    expect(snapshot.items.map((item) => item.status)).toEqual([
      "waitingForUser",
      "failed",
      "running",
      "completed",
    ]);
    expect(snapshot.items[0]?.pendingRequests[0]).toMatchObject({
      eventId: globalSupervisorPendingRequestEventId(pending),
      requestId: 7,
      response: { kind: "approval" },
    });
  });

  it("reports every active-work bound and never labels unknown lifecycle as completion", async () => {
    const running: StoredThreadSummary[] = [];
    for (let index = 0; index < 40; index += 1) {
      running.push(
        workSummary({
          connectionId: "target-server",
          id: `running-${index}`,
          name: `Running ${index}`,
          preview: "Working",
          status: { activeFlags: [], type: "active" },
          updatedAt: index,
        }),
      );
    }
    running.push(
      workSummary({
        connectionId: "target-server",
        id: "unknown",
        name: "Unknown lifecycle",
        preview: "Not loaded",
        status: { type: "notLoaded" },
        updatedAt: 100,
      }),
    );
    const active = capabilities({ readWorkCatalog: async () => running, rpcAfterAttach: vi.fn() });
    const supervisor = globalSupervisorQualifiedChatRef("home", "supervisor");

    const activeSnapshot = await active.value.listActiveWork(supervisor);
    expect(activeSnapshot.items).toHaveLength(32);
    expect(activeSnapshot.items.every((item) => item.status === "running")).toBe(true);
    expect(activeSnapshot.items.some((item) => item.target.threadId === "unknown")).toBe(false);
    expect(activeSnapshot.truncated).toBe(true);

    const completions: StoredThreadSummary[] = [];
    for (let index = 0; index < 12; index += 1) {
      completions.push(
        workSummary({
          connectionId: "target-server",
          id: `completed-${index}`,
          name: `Completed ${index}`,
          preview: "Done",
          status: { type: "idle" },
          updatedAt: index,
        }),
      );
    }
    const completed = capabilities({
      readWorkCatalog: async () => completions,
      rpcAfterAttach: vi.fn(),
    });
    const completedSnapshot = await completed.value.listActiveWork(supervisor);
    expect(completedSnapshot.items).toHaveLength(8);
    expect(completedSnapshot.truncated).toBe(true);
  });

  it("returns explicit ambiguity for multiple voice search matches", async () => {
    const rows = [
      workSummary({
        connectionId: "target-server",
        id: "one",
        name: "Release Android",
        preview: "First candidate",
        status: { type: "idle" },
        updatedAt: 2,
      }),
      workSummary({
        connectionId: "target-server",
        id: "two",
        name: "Release Android",
        preview: "Second candidate",
        status: { type: "idle" },
        updatedAt: 1,
      }),
    ];
    const lower = capabilities({ readWorkCatalog: async () => rows, rpcAfterAttach: vi.fn() });

    await expect(
      lower.value.findChat(globalSupervisorQualifiedChatRef("home", "supervisor"), {
        connectionId: null,
        project: null,
        title: "Release Android",
        topic: null,
      }),
    ).resolves.toMatchObject({ status: "ambiguous", truncated: false });
  });

  it("matches the displayed fallback title when a chat has no explicit name", async () => {
    const rows = [
      workSummary({
        connectionId: "target-server",
        id: "unnamed",
        name: null,
        preview: "Investigate audio routing\nCurrent details",
        status: { type: "idle" },
        updatedAt: 1,
      }),
    ];
    const lower = capabilities({ readWorkCatalog: async () => rows, rpcAfterAttach: vi.fn() });

    await expect(
      lower.value.findChat(globalSupervisorQualifiedChatRef("home", "supervisor"), {
        connectionId: null,
        project: null,
        title: "audio routing",
        topic: null,
      }),
    ).resolves.toMatchObject({
      chat: { target: { connectionId: "target-server", threadId: "unnamed" } },
      status: "found",
    });
  });

  it("does not claim a unique voice match when the bounded source catalog is incomplete", async () => {
    const rows: StoredThreadSummary[] = [];
    for (let index = 0; index < 100; index += 1) {
      rows.push(
        workSummary({
          connectionId: "target-server",
          id: `candidate-${index}`,
          name: index === 0 ? "Unique visible match" : `Other chat ${index}`,
          preview: "Conversation",
          status: { type: "idle" },
          updatedAt: index,
        }),
      );
    }
    const lower = capabilities({ readWorkCatalog: async () => rows, rpcAfterAttach: vi.fn() });

    await expect(
      lower.value.findChat(globalSupervisorQualifiedChatRef("home", "supervisor"), {
        connectionId: null,
        project: null,
        title: "Unique visible match",
        topic: null,
      }),
    ).resolves.toMatchObject({
      candidates: [{ target: { connectionId: "target-server", threadId: "candidate-0" } }],
      status: "ambiguous",
      truncated: true,
    });
  });

  it("validates the exact request identity and its allowed answers before durable response", async () => {
    const pending: PendingServerRequest = {
      connectionId: "target-server",
      createdAt: 10,
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            id: "release",
            isOther: false,
            isSecret: false,
            options: [{ description: "Proceed", label: "Ship" }],
            question: "Release now?",
          },
        ],
        threadId: TARGET.threadId,
        turnId: "turn-request",
      },
      requestId: "request-7",
      requestKey: 'string:"request-7"',
      state: "pending",
    };
    const respondToPendingRequest = vi.fn(async () => undefined);
    const lower = capabilities({
      currentPendingRequests: () => [pending],
      respondToPendingRequest,
      rpcAfterAttach: vi.fn(),
    });
    const eventId = globalSupervisorPendingRequestEventId(pending);

    await expect(
      lower.value.respondToRequest({
        answer: {
          answers: [{ answer: "Guess", questionId: "release" }],
          kind: "userInput",
        },
        eventId,
        target: TARGET,
      }),
    ).rejects.toThrow("allowed answers");
    expect(respondToPendingRequest).not.toHaveBeenCalled();

    await expect(
      lower.value.respondToRequest({
        answer: {
          answers: [{ answer: "Ship", questionId: "release" }],
          kind: "userInput",
        },
        eventId,
        target: TARGET,
      }),
    ).resolves.toEqual({ eventId, responded: true });
    expect(respondToPendingRequest).toHaveBeenCalledWith(pending, {
      answers: { release: { answers: ["Ship"] } },
    });
  });

  it("validates elicitation choices and bounds before claiming the pending request", async () => {
    const pending: PendingServerRequest = {
      connectionId: "target-server",
      createdAt: 11,
      method: "mcpServer/elicitation/request",
      params: {
        message: "Choose release targets",
        mode: "form",
        requestedSchema: {
          properties: {
            retries: { maximum: 3, minimum: 1, type: "integer" },
            targets: {
              items: { enum: ["android", "companion"] },
              maxItems: 2,
              minItems: 1,
              type: "array",
            },
          },
          required: ["retries", "targets"],
          type: "object",
        },
        threadId: TARGET.threadId,
        turnId: "turn-elicitation",
      },
      requestId: "request-elicitation",
      requestKey: 'string:"request-elicitation"',
      state: "pending",
    };
    const respondToPendingRequest = vi.fn(async () => undefined);
    const lower = capabilities({
      currentPendingRequests: () => [pending],
      respondToPendingRequest,
      rpcAfterAttach: vi.fn(),
    });
    const eventId = globalSupervisorPendingRequestEventId(pending);

    await expect(
      lower.value.respondToRequest({
        answer: {
          action: "accept",
          content: { retries: 2, targets: ["other"] },
          kind: "elicitation",
        },
        eventId,
        target: TARGET,
      }),
    ).rejects.toThrow("allowed values");
    await expect(
      lower.value.respondToRequest({
        answer: {
          action: "accept",
          content: { retries: 4, targets: ["android"] },
          kind: "elicitation",
        },
        eventId,
        target: TARGET,
      }),
    ).rejects.toThrow("allowed field bounds");
    expect(respondToPendingRequest).not.toHaveBeenCalled();

    await expect(
      lower.value.respondToRequest({
        answer: {
          action: "accept",
          content: { retries: 2, targets: ["android", "companion"] },
          kind: "elicitation",
        },
        eventId,
        target: TARGET,
      }),
    ).resolves.toEqual({ eventId, responded: true });
    expect(respondToPendingRequest).toHaveBeenCalledWith(pending, {
      _meta: null,
      action: "accept",
      content: { retries: 2, targets: ["android", "companion"] },
    });
  });

  it("interrupts only the latest running turn and treats an idle target idempotently", async () => {
    let running = true;
    const rpcAfterAttach = vi.fn(async (_session, method) => {
      if (method === "turn/interrupt") {
        running = false;
        return {};
      }
      return {
        data: [
          {
            id: "turn-current",
            items: [],
            status: running ? "inProgress" : "interrupted",
          },
        ],
        nextCursor: null,
      };
    });
    const lower = capabilities({ rpcAfterAttach });

    await expect(lower.value.interruptChat(TARGET)).resolves.toMatchObject({
      status: "interruptRequested",
      target: TARGET,
      turnId: "turn-current",
    });
    await expect(lower.value.interruptChat(TARGET)).resolves.toMatchObject({
      status: "alreadyIdle",
      target: TARGET,
      turnId: null,
    });
    expect(rpcAfterAttach.mock.calls.filter((call) => call[1] === "turn/interrupt")).toHaveLength(
      1,
    );
  });

  it("reads one authoritative summary page without materializing tool activity", async () => {
    const rpcAfterAttach = vi.fn(async () =>
      historyPage([historyEntry("message-1", "first")], "next-turn"),
    );
    const lower = capabilities({ rpcAfterAttach });

    const page = await lower.value.readChat({
      cursor: null,
      limit: 1,
      maxBytes: 262_144,
      target: TARGET,
    });

    expect(page.items).toEqual([{ id: "message-1", kind: "assistant", text: "first" }]);
    expect(page.cursor).not.toBeNull();
    expect(rpcAfterAttach).toHaveBeenCalledWith(
      lower.session,
      "thread/turns/list",
      expect.objectContaining({ itemsView: "summary", limit: 1, threadId: "target-thread" }),
    );
  });

  it("keeps repeated chat reads on the summary wire path", async () => {
    const rpcAfterAttach = vi.fn(async (_session, _method, params: { itemsView?: string }) => {
      if (params.itemsView !== "summary") {
        throw new Error("historical tool output was requested inline");
      }
      return historyPage([
        { id: "tool", type: "commandExecution" },
        historyEntry("message-1", "done"),
      ]);
    });
    const lower = capabilities({ rpcAfterAttach });

    for (let iteration = 0; iteration < 2; iteration += 1) {
      await expect(
        lower.value.readChat({ cursor: null, limit: 2, maxBytes: 262_144, target: TARGET }),
      ).resolves.toMatchObject({
        items: [{ id: "message-1", kind: "assistant", text: "done" }],
      });
    }

    expect(rpcAfterAttach).toHaveBeenCalledTimes(2);
  });

  it("inspects live progress through one full latest-turn read with bounded sanitized output", async () => {
    const secret = "sk-secretvalue123456";
    const items: unknown[] = [
      {
        id: "update-1",
        phase: "commentary",
        text: `Checking https://service.test/path?token=${secret} token ${secret}`,
        type: "agentMessage",
      },
    ];
    for (let index = 0; index < 30; index += 1) {
      items.push({
        aggregatedOutput: `raw-${secret}`,
        command: `curl --token ${secret}`,
        commandActions: [],
        cwd: `/secret/${secret}`,
        exitCode: index,
        id: `command-${String(index)}`,
        status: index === 29 ? "inProgress" : "completed",
        type: "commandExecution",
      });
    }
    items.push({
      arguments: { token: secret },
      contentItems: [{ text: `raw-${secret}`, type: "inputText" }],
      id: "tool",
      status: "completed",
      success: true,
      tool: "workspace.inspect",
      type: "dynamicToolCall",
    });
    const rpcAfterAttach = vi.fn(async () => ({
      data: [{ id: "active-turn", items, status: "inProgress" }],
      nextCursor: null,
    }));
    const lower = capabilities({ rpcAfterAttach });

    const inspection = await lower.value.inspectChat(TARGET);

    expect(inspection).toMatchObject({
      target: TARGET,
      turn: {
        id: "active-turn",
        status: "inProgress",
        truncated: true,
        updates: [
          { phase: "commentary", text: "Checking https://service.test/path token [redacted]" },
        ],
      },
    });
    expect(inspection.turn?.steps).toHaveLength(24);
    expect(inspection.turn?.steps.at(-1)).toEqual({
      kind: "tool",
      name: "workspace.inspect",
      outcome: "success:true",
      status: "completed",
    });
    expect(JSON.stringify(inspection)).not.toContain(secret);
    expect(JSON.stringify(inspection)).not.toContain("curl");
    expect(JSON.stringify(inspection)).not.toContain("aggregatedOutput");
    expect(rpcAfterAttach).toHaveBeenCalledWith(lower.session, "thread/turns/list", {
      cursor: null,
      itemsView: "full",
      limit: 1,
      sortDirection: "desc",
      threadId: TARGET.threadId,
    });
  });

  it("lists bounded attachment metadata without exposing paths or remote URLs", async () => {
    const attachments: unknown[] = [];
    for (let index = 0; index < 34; index += 1) {
      attachments.push({
        itemId: `item-${String(index)}`,
        key: `path:/private/secret-${String(index)}.md`,
        kind: "file",
        name: index === 33 ? "report.md" : `note-${String(index)}.md`,
        origin: index % 2 === 0 ? "agent" : "user",
        path: `/private/secret-${String(index)}.md`,
        turnId: `turn-${String(index)}`,
        url: null,
      });
    }
    attachments[32] = {
      itemId: "item-remote",
      key: "url:https://files.example/report.md?token=secret-token",
      kind: "file",
      name: "remote.md",
      origin: "agent",
      path: null,
      turnId: "turn-remote",
      url: "https://files.example/report.md?token=secret-token",
    };
    const rpcAfterAttach = vi.fn(async () => ({
      attachments,
      revision: "resources-v1",
      threadId: TARGET.threadId,
    }));
    const lower = capabilities({ rpcAfterAttach });

    const listed = await lower.value.listChatAttachments(TARGET);

    expect(listed.items).toHaveLength(32);
    expect(listed.truncated).toBe(true);
    expect(listed.items.at(-1)).toMatchObject({
      itemId: "item-33",
      kind: "file",
      name: "report.md",
      origin: "user",
      textReadable: true,
      turnId: "turn-33",
    });
    expect(listed.items.at(-2)).toMatchObject({ name: "remote.md", textReadable: false });
    expect(JSON.stringify(listed)).not.toContain("/private/");
    expect(JSON.stringify(listed)).not.toContain("files.example");
    expect(JSON.stringify(listed)).not.toContain("secret-token");
    expect(rpcAfterAttach).toHaveBeenCalledWith(lower.session, "companion/threadAttachments/read", {
      threadId: TARGET.threadId,
    });
  });

  it("reads only the selected authoritative text attachment in bounded pages", async () => {
    const resource = {
      itemId: "message-item",
      key: "path:/private/agent-report.md",
      kind: "file",
      name: "agent-report.md",
      origin: "agent",
      path: "/private/agent-report.md",
      turnId: "turn-report",
      url: null,
    };
    const rpcAfterAttach = vi.fn(async () => ({
      attachments: [resource],
      revision: "resources-v1",
      threadId: TARGET.threadId,
    }));
    const readAttachmentText = vi.fn(async ({ limit, offset }) => ({
      contentType: "text/markdown",
      nextOffset: offset + limit,
      text: "# Agent report\n\nThe rollout is ready.",
      totalBytes: 240_000,
      truncated: true,
    }));
    const lower = capabilities({ readAttachmentText, rpcAfterAttach });
    const listed = await lower.value.listChatAttachments(TARGET);
    const attachment = listed.items[0];
    if (attachment === undefined) {
      throw new Error("Missing attachment fixture");
    }

    const first = await lower.value.readChatAttachment({
      attachmentId: attachment.attachmentId,
      offset: 0,
      target: TARGET,
    });
    const last = await lower.value.readChatAttachment({
      attachmentId: attachment.attachmentId,
      offset: 196_000,
      target: TARGET,
    });

    expect(first).toMatchObject({
      attachmentId: attachment.attachmentId,
      contentType: "text/markdown",
      limitReached: false,
      name: "agent-report.md",
      nextOffset: 65_536,
      offset: 0,
      target: TARGET,
      text: "# Agent report\n\nThe rollout is ready.",
      truncated: true,
    });
    expect(last).toMatchObject({ limitReached: true, nextOffset: null, truncated: true });
    expect(readAttachmentText).toHaveBeenNthCalledWith(1, {
      connectionId: TARGET.connectionId,
      limit: 65_536,
      offset: 0,
      path: "/private/agent-report.md",
    });
    expect(readAttachmentText).toHaveBeenNthCalledWith(2, {
      connectionId: TARGET.connectionId,
      limit: 608,
      offset: 196_000,
      path: "/private/agent-report.md",
    });
    expect(JSON.stringify(first)).not.toContain("/private/");
  });

  it("cannot reuse an attachment identity for another chat or read a remote source", async () => {
    const attachment = {
      itemId: "message-item",
      key: "url:https://files.example/report.md",
      kind: "file",
      name: "remote.md",
      origin: "agent",
      path: null,
      turnId: "turn-report",
      url: "https://files.example/report.md",
    };
    const rpcAfterAttach = vi.fn(async (_session, _method, params) => ({
      attachments: [attachment],
      revision: "resources-v1",
      threadId: params.threadId,
    }));
    const readAttachmentText = vi.fn();
    const lower = capabilities({ readAttachmentText, rpcAfterAttach });
    const listed = await lower.value.listChatAttachments(TARGET);
    const listedAttachment = listed.items[0];
    if (listedAttachment === undefined) {
      throw new Error("Missing attachment fixture");
    }

    await expect(
      lower.value.readChatAttachment({
        attachmentId: listedAttachment.attachmentId,
        offset: 0,
        target: TARGET,
      }),
    ).rejects.toThrow("not readable text");
    await expect(
      lower.value.readChatAttachment({
        attachmentId: listedAttachment.attachmentId,
        offset: 0,
        target: globalSupervisorQualifiedChatRef("target-server", "other-thread"),
      }),
    ).rejects.toThrow("no longer available");
    expect(readAttachmentText).not.toHaveBeenCalled();
  });

  it("rejects a read continuation reused for another qualified target before RPC", async () => {
    const rpcAfterAttach = vi.fn(async () =>
      historyPage([historyEntry("message-1", "first")], "next-turn"),
    );
    const lower = capabilities({ rpcAfterAttach });
    const first = await lower.value.readChat({
      cursor: null,
      limit: 1,
      maxBytes: 262_144,
      target: TARGET,
    });
    const otherTarget = globalSupervisorQualifiedChatRef("target-server", "other-thread");

    await expect(
      lower.value.readChat({
        cursor: first.cursor,
        limit: 1,
        maxBytes: 262_144,
        target: otherTarget,
      }),
    ).rejects.toThrow("readChat cursor is invalid");
    expect(rpcAfterAttach).toHaveBeenCalledTimes(1);
  });

  it("rejects a catalog continuation after enabled connection order changes", async () => {
    let connections: StoredConnection[] = [connection("server-a"), connection("server-b")];
    const rpcAfterAttach = vi.fn(async () => ({ data: [], nextCursor: null }));
    const lower = capabilities({ currentConnections: () => connections, rpcAfterAttach });
    const first = await lower.value.listChats(null, 100);
    connections = [connection("server-b"), connection("server-a")];

    await expect(lower.value.listChats(first.cursor, 100)).rejects.toThrow(
      "listChats cursor is invalid",
    );
    expect(rpcAfterAttach).toHaveBeenCalledTimes(1);
  });

  it("rejects catalog over-return and bounds one full turn before projection", async () => {
    const catalogAtLimit = Array.from({ length: 100 }, (_, index) =>
      catalogEntry(`thread-${String(index)}`),
    );
    const historyAtLimit = Array.from({ length: 100 }, (_, index) =>
      historyEntry(`message-${String(index)}`, "x"),
    );
    const rpcAfterAttach = vi
      .fn()
      .mockResolvedValueOnce({ data: catalogAtLimit, nextCursor: null })
      .mockResolvedValueOnce({
        data: [...catalogAtLimit, catalogEntry("overflow")],
        nextCursor: null,
      })
      .mockResolvedValueOnce(historyPage(historyAtLimit))
      .mockResolvedValueOnce(historyPage([...historyAtLimit, historyEntry("overflow", "x")]));
    const lower = capabilities({ rpcAfterAttach });

    await expect(lower.value.listChats(null, 100)).resolves.toHaveProperty("items.length", 100);
    await expect(lower.value.listChats(null, 100)).rejects.toThrow("catalog response is invalid");
    await expect(
      lower.value.readChat({ cursor: null, limit: 100, maxBytes: 262_144, target: TARGET }),
    ).resolves.toHaveProperty("items.length", 100);
    const bounded = await lower.value.readChat({
      cursor: null,
      limit: 100,
      maxBytes: 262_144,
      target: TARGET,
    });
    expect(bounded.items).toHaveLength(100);
    expect(bounded.cursor).not.toBeNull();
  });

  it("stops history projection at the exact byte boundary with a scoped continuation", async () => {
    const item = {
      id: "message-1",
      kind: "assistant",
      text: "bounded message content that is larger than the overflow marker",
    } as const;
    const exactBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
    const rpcAfterAttach = vi.fn(async () => historyPage([historyEntry(item.id, item.text)]));
    const lower = capabilities({ rpcAfterAttach });

    await expect(
      lower.value.readChat({ cursor: null, limit: 1, maxBytes: exactBytes, target: TARGET }),
    ).resolves.toMatchObject({ items: [item] });
    await expect(
      lower.value.readChat({ cursor: null, limit: 1, maxBytes: exactBytes - 1, target: TARGET }),
    ).resolves.toMatchObject({
      items: [{ id: "message-1", kind: "assistant", text: "[Message exceeds read limit]" }],
    });
  });

  it("replaces oversized single and multipart messages before joining or encoding content", async () => {
    const rpcAfterAttach = vi
      .fn()
      .mockResolvedValueOnce(historyPage([historyEntry("assistant", "x".repeat(10_000))]))
      .mockResolvedValueOnce(
        historyPage([
          {
            content: [
              { text: "a".repeat(10_000), type: "text" },
              { text: "b".repeat(10_000), type: "text" },
            ],
            id: "user",
            type: "userMessage",
          },
        ]),
      );
    const lower = capabilities({ rpcAfterAttach });

    await expect(
      lower.value.readChat({ cursor: null, limit: 1, maxBytes: 100, target: TARGET }),
    ).resolves.toMatchObject({
      items: [{ id: "assistant", kind: "assistant", text: "[Message exceeds read limit]" }],
    });
    await expect(
      lower.value.readChat({ cursor: null, limit: 1, maxBytes: 100, target: TARGET }),
    ).resolves.toMatchObject({
      items: [{ id: "user", kind: "user", text: "[Message exceeds read limit]" }],
    });
  });

  it("rejects a disconnected target and the exact hidden supervisor before RPC", async () => {
    const disconnectedRpc = vi.fn();
    const disconnected = capabilities({
      isRpcAvailable: () => false,
      rpcAfterAttach: disconnectedRpc,
    });
    await expect(
      disconnected.value.readChat({
        cursor: null,
        limit: 1,
        maxBytes: 262_144,
        target: TARGET,
      }),
    ).rejects.toThrow("target chat server is not live");
    expect(disconnectedRpc).not.toHaveBeenCalled();

    const binding = parseGlobalSupervisorBinding({
      home: { connectionId: "target-server", threadId: "target-thread" },
      schemaVersion: 1,
      status: "ready",
    });
    if (binding === null) {
      throw new Error("Invalid hidden-target fixture");
    }
    const hiddenRpc = vi.fn();
    const hidden = capabilities({
      rpcAfterAttach: hiddenRpc,
      targetPolicy: createGlobalSupervisorToolTargetPolicy(() => binding),
    });
    await expect(
      hidden.value.readChat({
        cursor: null,
        limit: 1,
        maxBytes: 262_144,
        target: TARGET,
      }),
    ).rejects.toThrow("not a valid tool target");
    await expect(hidden.value.inspectChat(TARGET)).rejects.toThrow("not a valid tool target");
    await expect(hidden.value.listChatAttachments(TARGET)).rejects.toThrow(
      "not a valid tool target",
    );
    await expect(
      hidden.value.readChatAttachment({
        attachmentId: `attachment-v1-${"a".repeat(32)}`,
        offset: 0,
        target: TARGET,
      }),
    ).rejects.toThrow("not a valid tool target");
    expect(() => hidden.value.assertLiveTarget(TARGET)).toThrow("not a valid tool target");
    await expect(
      hidden.value.sendText({
        commandId: "opaque-command",
        supervisor: globalSupervisorQualifiedChatRef("home", "supervisor"),
        target: TARGET,
        text: "hello",
      }),
    ).rejects.toThrow("not a valid tool target");
    expect(hiddenRpc).not.toHaveBeenCalled();
  });

  it("rechecks live target authority immediately before non-optimistic delivery", async () => {
    const lower = capabilities({ rpcAfterAttach: vi.fn() });
    await expect(
      lower.value.sendText({
        commandId: "opaque-command",
        supervisor: globalSupervisorQualifiedChatRef("home", "supervisor"),
        target: TARGET,
        text: "hello",
      }),
    ).resolves.toBe("opaque-command");
    expect(lower.sendSystemText).toHaveBeenCalledWith({
      commandId: "opaque-command",
      connectionId: "target-server",
      text: "hello",
      threadId: "target-thread",
    });
  });

  it("delivers concurrent worker completions after sendText follow survives runtime unload", async () => {
    const lower = capabilities({ rpcAfterAttach: vi.fn() });
    const supervisor = globalSupervisorQualifiedChatRef("home", "supervisor");
    await lower.attention.enableDelivery(supervisor);
    await lower.value.sendText({
      commandId: "global-supervisor-targetSend-worker",
      supervisor,
      target: TARGET,
      text: "Do the work",
    });
    await lower.attention.ingestEvents(TARGET.connectionId, [
      {
        cursor: 1,
        payload: { method: "thread/closed", params: { threadId: TARGET.threadId } },
      },
    ]);
    const completed = (cursor: number, turnId: string, observedAt: number) => ({
      cursor,
      payload: {
        codewideThreadPatch: {
          operation: {
            kind: "turnCompleted" as const,
            summary: { previewText: `completed-${turnId}` },
            turn: { completedAt: observedAt, id: turnId, status: "completed" as const },
          },
          threadId: TARGET.threadId,
          version: 1 as const,
        },
        method: "turn/completed",
        params: {
          threadId: TARGET.threadId,
          turn: { completedAt: observedAt, id: turnId, status: "completed" },
        },
      },
    });
    await Promise.all([
      lower.attention.ingestEvents(TARGET.connectionId, [completed(3, "turn-2", 3_000)]),
      lower.attention.ingestEvents(TARGET.connectionId, [completed(2, "turn-1", 2_000)]),
    ]);
    const appendText = vi.fn(async () => undefined);
    const admission = createGlobalSupervisorUnsolicitedAdmission();
    admission.setLifecycleIdle(true);
    const delivery = createGlobalSupervisorAttentionDeliverySession({
      admission,
      appendText,
      attention: lower.attention,
      home: supervisor,
      onTerminal: vi.fn(),
    });

    admission.setLifecycleIdle(false);
    admission.setLifecycleIdle(true);
    await vi.waitFor(() => expect(appendText).toHaveBeenCalledOnce());
    admission.setLifecycleIdle(false);
    admission.completeExchange();
    admission.setLifecycleIdle(true);
    await vi.waitFor(() => expect(appendText).toHaveBeenCalledTimes(2));
    admission.setLifecycleIdle(false);
    admission.completeExchange();
    admission.setLifecycleIdle(true);
    await vi.waitFor(async () => {
      await expect(lower.attention.pendingCount(supervisor)).resolves.toBe(0);
    });

    expect(appendText.mock.calls.map(([text]) => text)).toEqual([
      expect.stringContaining('summary="completed-turn-1"'),
      expect.stringContaining('summary="completed-turn-2"'),
    ]);
    await delivery.stop();
  });
});
