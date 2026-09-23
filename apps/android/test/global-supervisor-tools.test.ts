import { describe, expect, it, vi } from "vitest";

import type { StoredConnection } from "../src/data/connection-profile-types";
import { createGlobalSupervisorAttentionOwner } from "../src/data/globalSupervisorAttention";
import { createGlobalSupervisorAttentionDeliverySession } from "../src/data/globalSupervisorAttentionDelivery";
import { createGlobalSupervisorAttentionStorage } from "../src/data/globalSupervisorAttentionStorage.web";
import {
  globalSupervisorQualifiedChatRef,
  parseGlobalSupervisorBinding,
} from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorToolCapabilities } from "../src/data/globalSupervisorTools";
import {
  createGlobalSupervisorToolTargetPolicy,
  type GlobalSupervisorToolTargetPolicy,
} from "../src/data/globalSupervisorToolTarget";

const TARGET = globalSupervisorQualifiedChatRef("target-server", "target-thread");

function connection(id: string): StoredConnection {
  return {
    displayName: id,
    emoji: "",
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
  isRpcAvailable = () => true,
  rpcAfterAttach,
  targetPolicy = createGlobalSupervisorToolTargetPolicy(() => null),
}: {
  readonly currentConnections?: () => StoredConnection[];
  readonly isRpcAvailable?: (connectionId: string) => boolean;
  readonly rpcAfterAttach: ReturnType<typeof vi.fn>;
  readonly targetPolicy?: GlobalSupervisorToolTargetPolicy;
}) {
  const session = { rpc: vi.fn(), stop: vi.fn() };
  const sendSystemText = vi.fn(async ({ commandId }) => commandId);
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
      deriveTargetSendCommandId: vi.fn(async () => "opaque-command"),
      deriveWorkerCreationSource: vi.fn(async () => "worker-source"),
      getSession: () => session,
      isRpcAvailable,
      respond: vi.fn(),
      rpcAfterAttach,
      sendSystemText,
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

describe("GlobalSupervisorToolCapabilities", () => {
  it("persists the supervisor relation around visible top-level chat creation", async () => {
    const rpcAfterAttach = vi.fn(async () => ({ thread: { id: "worker-thread" } }));
    const lower = capabilities({ rpcAfterAttach });
    const supervisor = globalSupervisorQualifiedChatRef("home", "supervisor");
    await lower.attention.enableDelivery(supervisor);

    const worker = await lower.value.createChat({
      connectionId: "target-server",
      cwd: null,
      source: "codewide-global-supervisor-worker:request",
      supervisor,
    });
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

    expect(worker).toEqual({ connectionId: "target-server", threadId: "worker-thread" });
    expect(rpcAfterAttach).toHaveBeenCalledWith(lower.session, "thread/start", {
      threadSource: "codewide-global-supervisor-worker:request",
    });
    await expect(lower.attention.pendingCount(supervisor)).resolves.toBe(1);
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
    const delivery = createGlobalSupervisorAttentionDeliverySession({
      appendText,
      attention: lower.attention,
      home: supervisor,
      onTerminal: vi.fn(),
    });

    delivery.setSpeechBusy(false);
    await vi.waitFor(() => expect(appendText).toHaveBeenCalledOnce());
    delivery.setSpeechBusy(false);
    await vi.waitFor(() => expect(appendText).toHaveBeenCalledTimes(2));
    delivery.setSpeechBusy(false);
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
