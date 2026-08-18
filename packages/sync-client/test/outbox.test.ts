import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { DurableOutbox, MAX_OUTBOX_COMMANDS_PER_CONNECTION, MAX_TURN_ATTACHMENTS, MAX_TURN_SKILLS, MAX_TURN_TEXT_CHARS, RpcResponseError, type OutboxCommand, type OutboxStore, type RpcClient } from "../src/index.js";

describe("DurableOutbox", () => {
  it("reconciles a response lost after acceptance without creating a duplicate turn", async () => {
    const store = new FakeStore(thread());
    const outbox = new DurableOutbox(store, () => "client-message-1");
    await outbox.enqueueText("server", "thread", "hello");
    let starts = 0;
    const client: RpcClient = {
      async rpc<T>(method: string): Promise<T> {
        if (method === "turn/start") {
          starts += 1;
          store.thread.turns[0]?.items.push({
            type: "userMessage", id: "accepted", clientId: "client-message-1",
            content: [{ type: "text", text: "hello", text_elements: [] }],
          });
          throw new Error("Connection closed after upstream accepted the request");
        }
        return { thread: structuredClone(store.thread) } as T;
      },
    };
    await outbox.flush("server", client);
    expect(store.commands[0]?.state).toBe("uncertain");
    await outbox.flush("server", client);
    expect(store.commands).toHaveLength(0);
    expect(starts).toBe(1);
  });

  it("marks explicit App Server rejection failed and continues the queue", async () => {
    const store = new FakeStore(thread());
    let next = 0;
    const outbox = new DurableOutbox(store, () => `command-${++next}`);
    await outbox.enqueueText("server", "thread", "bad");
    await outbox.enqueueText("server", "thread", "good");
    let calls = 0;
    await outbox.flush("server", {
      async rpc<T>(): Promise<T> {
        calls += 1;
        if (calls === 1) throw new RpcResponseError(-32602, "invalid params");
        return {} as T;
      },
    });
    expect(store.commands).toMatchObject([{ commandId: "command-1", state: "failed" }]);
    expect(calls).toBe(2);
  });

  it("holds queued text while a turn is active and starts it after completion", async () => {
    const active = thread();
    active.status = { type: "active", activeFlags: [] };
    const store = new FakeStore(active);
    const outbox = new DurableOutbox(store, () => "queued-1");
    await outbox.enqueueText("server", "thread", "next", { type: "queue" });
    let starts = 0;
    const client: RpcClient = {
      async rpc<T>(method: string): Promise<T> {
        if (method === "thread/read") return { thread: structuredClone(store.thread) } as T;
        starts += 1;
        return {} as T;
      },
    };
    await outbox.flush("server", client);
    expect(starts).toBe(0);
    expect(store.commands[0]?.state).toBe("queued");
    store.thread.status = { type: "idle" };
    await outbox.flush("server", client);
    expect(starts).toBe(1);
    expect(store.commands).toHaveLength(0);
  });

  it("leaves a mirrored queue to the companion and preserves FIFO", async () => {
    const store = new FakeStore(thread());
    let next = 0;
    const outbox = new DurableOutbox(store, () => `mirrored-${++next}`);
    await outbox.enqueueText("server", "thread", "queued", { type: "queue" });
    await outbox.enqueueText("server", "thread", "later");
    const methods: string[] = [];
    await outbox.flush("server", {
      async rpc<T>(method: string): Promise<T> {
        methods.push(method);
        return {} as T;
      },
    }, { dispatchQueued: false });
    expect(methods).toEqual([]);
    expect(store.commands.map((command) => command.state)).toEqual(["queued", "pending"]);
  });

  it("never retries uncertain or queued work from a stale cached idle thread", async () => {
    const store = new FakeStore(thread());
    let next = 0;
    const outbox = new DurableOutbox(store, () => `stale-${++next}`);
    const uncertain = await outbox.enqueueText("server", "thread", "uncertain");
    await store.updateOutbox(uncertain.commandId, "server", {
      state: "uncertain",
      attempts: 1,
      updatedAt: Date.now(),
      lastError: "connection closed",
    });
    await outbox.enqueueText("server", "thread", "queued", { type: "queue" });
    let mutations = 0;
    await outbox.flush("server", {
      async rpc<T>(method: string): Promise<T> {
        if (method === "thread/read") throw new Error("offline");
        mutations += 1;
        return {} as T;
      },
    });
    expect(mutations).toBe(0);
    expect(store.commands.map((command) => command.state)).toEqual(["uncertain", "queued"]);
  });

  it("does not send turn/start-only overrides in a steer request", async () => {
    const store = new FakeStore(thread());
    const outbox = new DurableOutbox(store, () => "steer-1");
    const command = await outbox.enqueueText(
      "server",
      "thread",
      "change direction",
      { type: "steer", expectedTurnId: "active-turn" },
      {
        model: "gpt-5.6",
        effort: "high",
        personality: "pragmatic",
        permissions: ":workspace",
        skills: [{ name: "openai-docs", path: "/skills/openai-docs" }],
      },
    );
    expect(command.params).toEqual({
      threadId: "thread",
      clientUserMessageId: "steer-1",
      expectedTurnId: "active-turn",
      input: [
        { type: "text", text: "change direction", text_elements: [] },
        { type: "skill", name: "openai-docs", path: "/skills/openai-docs" },
      ],
    });
  });

  it("persists root-scoped file inputs for companion-side resolution", async () => {
    const store = new FakeStore(thread());
    const outbox = new DurableOutbox(store, () => "attachment-command");
    const command = await outbox.enqueueText("server", "thread", "inspect this", { type: "start" }, {
      attachments: [{ id: "a1", rootId: "workspace", path: "uploads/screenshot.png", name: "screenshot.png", kind: "image" }],
    });
    expect(command.params.input).toEqual([
      { type: "text", text: "inspect this", text_elements: [] },
      { type: "remoteFile", rootId: "workspace", path: "uploads/screenshot.png", name: "screenshot.png", kind: "image" },
    ]);
  });

  it("rejects empty or unbounded commands before they reach durable storage", async () => {
    const store = new FakeStore(thread());
    const outbox = new DurableOutbox(store, () => "bounded-command");
    await expect(outbox.enqueueText("server", "thread", "")).rejects.toThrow("empty");
    await expect(outbox.enqueueText("server", "thread", "x".repeat(MAX_TURN_TEXT_CHARS + 1))).rejects.toThrow("exceeds");
    await expect(outbox.enqueueText("server", "thread", "x", { type: "start" }, {
      attachments: Array.from({ length: MAX_TURN_ATTACHMENTS + 1 }, (_, index) => ({
        id: `a-${index}`, rootId: "workspace", path: `uploads/${index}`, name: String(index), kind: "file" as const,
      })),
    })).rejects.toThrow("attachments");
    await expect(outbox.enqueueText("server", "thread", "x", { type: "start" }, {
      skills: Array.from({ length: MAX_TURN_SKILLS + 1 }, (_, index) => ({ name: `skill-${index}`, path: `/skills/${index}` })),
    })).rejects.toThrow("skills");
    expect(store.commands).toHaveLength(0);
  });

  it("applies backpressure before a command would become invisible past the dispatch window", async () => {
    const store = new FakeStore(thread());
    store.commands = Array.from({ length: MAX_OUTBOX_COMMANDS_PER_CONNECTION }, (_, index) => command(`existing-${index}`));
    const outbox = new DurableOutbox(store, () => "overflow");
    await expect(outbox.enqueueText("server", "thread", "one too many")).rejects.toThrow("capacity exceeded");
    expect(store.commands).toHaveLength(MAX_OUTBOX_COMMANDS_PER_CONNECTION);
  });

  it("drains work enqueued while an earlier flush is already running", async () => {
    const store = new FakeStore(thread());
    let next = 0;
    const outbox = new DurableOutbox(store, () => `concurrent-${++next}`);
    await outbox.enqueueText("server", "thread", "first");
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted: (() => void) | undefined;
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const delivered: string[] = [];
    const client: RpcClient = {
      async rpc<T>(method: string, params: unknown): Promise<T> {
        if (method === "turn/start") {
          const commandId = (params as { clientUserMessageId: string }).clientUserMessageId;
          delivered.push(commandId);
          if (commandId === "concurrent-1") {
            firstStarted?.();
            await firstBlocked;
          }
        }
        return {} as T;
      },
    };

    const firstFlush = outbox.flush("server", client);
    await firstStartedPromise;
    await outbox.enqueueText("server", "thread", "second");
    const secondFlush = outbox.flush("server", client);
    releaseFirst?.();
    await Promise.all([firstFlush, secondFlush]);

    expect(delivered).toEqual(["concurrent-1", "concurrent-2"]);
    expect(store.commands).toHaveLength(0);
  });
});

class FakeStore implements OutboxStore {
  commands: OutboxCommand[] = [];
  constructor(public thread: Thread) {}
  async putOutbox(command: OutboxCommand) { this.commands.push(structuredClone(command)); }
  async listOutbox(connectionId: string) { return structuredClone(this.commands.filter((value) => value.connectionId === connectionId)); }
  async updateOutbox(commandId: string, connectionId: string, patch: Pick<OutboxCommand, "state" | "attempts" | "updatedAt" | "lastError">) {
    const command = this.commands.find((value) => value.commandId === commandId && value.connectionId === connectionId);
    if (command !== undefined) Object.assign(command, patch);
  }
  async deleteOutbox(commandId: string, connectionId: string) {
    this.commands = this.commands.filter((value) => value.commandId !== commandId || value.connectionId !== connectionId);
  }
  async getThread() { return structuredClone(this.thread); }
  async saveThread(_connectionId: string, value: Thread) { this.thread = structuredClone(value); }
}

function thread(): Thread {
  return {
    id: "thread", extra: null, sessionId: "thread", forkedFromId: null, parentThreadId: null,
    preview: "", ephemeral: false, section: null, sectionEnteredAt: null, historyMode: "paginated", modelProvider: "openai",
    createdAt: 1, updatedAt: 1, recencyAt: 1, status: { type: "idle" }, path: null, cwd: "/workspace",
    cliVersion: "0.147.0", source: "appServer", canAcceptDirectInput: true, threadSource: null, agentNickname: null,
    agentRole: null, gitInfo: null, name: "Thread",
    turns: [{ id: "turn", items: [], itemsView: "full", status: "completed", error: null, startedAt: 1, completedAt: 2, durationMs: 1_000 }],
  };
}

function command(commandId: string): OutboxCommand {
  return {
    connectionId: "server",
    commandId,
    remoteThreadId: "thread",
    method: "turn/start",
    params: { threadId: "thread", clientUserMessageId: commandId, input: [{ type: "text", text: "queued", text_elements: [] }] },
    state: "queued",
    attempts: 0,
    createdAt: 1,
    updatedAt: 1,
    lastError: null,
  };
}
