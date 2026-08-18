import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppServerSyncHub, HostQueueStore, ReplayJournal, attachThreadPatch, liveEventBatchDelayMs, shouldFlushLiveEventBatch, startHostCompanion, type RunningHostCompanion } from "../src/index.js";

type JsonObject = Record<string, unknown>;

class Inbox {
  readonly messages: JsonObject[] = [];
  readonly #waiters = new Set<() => void>();

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString("utf8")) as JsonObject);
      for (const waiter of this.#waiters) waiter();
    });
  }

  async next(predicate: (message: JsonObject) => boolean, timeoutMs = 5_000): Promise<JsonObject> {
    const existing = this.messages.find(predicate);
    if (existing !== undefined) return existing;
    return await new Promise<JsonObject>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#waiters.delete(check);
        reject(new Error(`Timed out waiting for message; received ${JSON.stringify(this.messages)}`));
      }, timeoutMs);
      const check = () => {
        const match = this.messages.find(predicate);
        if (match === undefined) return;
        clearTimeout(timeout);
        this.#waiters.delete(check);
        resolve(match);
      };
      this.#waiters.add(check);
    });
  }
}

describe("companion sync/replay hub", () => {
  let companion: RunningHostCompanion | undefined;
  let upstreamServer: WebSocketServer | undefined;
  const upstreamSockets = new Set<WebSocket>();
  const upstreamMessages: JsonObject[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await companion?.close();
    companion = undefined;
    for (const socket of upstreamSockets) socket.close();
    upstreamSockets.clear();
    upstreamMessages.length = 0;
    const server = upstreamServer;
    upstreamServer = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  const startUpstream = async (): Promise<() => WebSocket> => {
    upstreamServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      upstreamServer?.once("listening", resolve);
      upstreamServer?.once("error", reject);
    });
    upstreamServer.on("connection", (socket) => {
      upstreamSockets.add(socket);
      socket.once("close", () => upstreamSockets.delete(socket));
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString("utf8")) as JsonObject;
        upstreamMessages.push(message);
        if (message.method === "initialize") {
          socket.send(JSON.stringify({ id: message.id, result: { userAgent: "fake-app-server" } }));
        } else if (message.method === "thread/list") {
          socket.send(JSON.stringify({ id: message.id, result: { data: [{ id: "real-thread" }] } }));
        }
      });
    });
    const address = upstreamServer.address();
    if (address === null || typeof address === "string") throw new Error("Unexpected upstream address");
    return () => new WebSocket(`ws://127.0.0.1:${address.port}`);
  };

  const connectClient = async (port: number, token: string): Promise<{ socket: WebSocket; inbox: Inbox }> => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const inbox = new Inbox(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return { socket, inbox };
  };

  const broadcast = (message: JsonObject): void => {
    for (const socket of upstreamSockets) socket.send(JSON.stringify(message));
  };

  it("attaches a stable semantic thread patch without removing raw notification data", () => {
    const projected = attachThreadPatch({
      method: "item/agentMessage/delta",
      params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "hello" },
    });

    expect(projected.params).toMatchObject({ delta: "hello" });
    expect(projected.codewideThreadPatch).toEqual({
      version: 1,
      threadId: "thread",
      operation: {
        kind: "itemTextDelta",
        itemType: "agentMessage",
        summary: {
          activity: true,
          conversationMessage: false,
          finalAgentResponse: false,
          previewText: null,
        },
      },
    });
  });

  it("adds constant-size patch metadata instead of duplicating live content", () => {
    const raw = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "x".repeat(1_000_000) },
    };
    const projected = attachThreadPatch(raw);

    expect(JSON.stringify(projected).length - JSON.stringify(raw).length).toBeLessThan(256);
  });

  it("projects bounded thread-list semantics for a completed turn", () => {
    const projected = attachThreadPatch({
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: { items: [
          { type: "userMessage", content: [{ type: "text", text: "Prompt" }] },
          { type: "agentMessage", phase: "final_answer", text: "**Answer**" },
        ] },
      },
    });

    expect(projected.codewideThreadPatch).toMatchObject({
      operation: {
        kind: "turnCompleted",
        summary: {
          activity: true,
          conversationMessage: true,
          finalAgentResponse: true,
          previewText: "**Answer**",
        },
      },
    });
  });

  it("snapshots, remaps RPC ids, journals offline events and replays by cursor", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-sync-"));
    const token = "s".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
      replayJournalPath: path.join(directory, "replay.jsonl"),
    });
    const { port } = companion.address();
    const first = await connectClient(port, token);
    first.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    const hello = await first.inbox.next((message) => message.type === "hello");
    expect(hello).toMatchObject({ protocolVersion: 1, headCursor: 0, snapshotRequired: true });
    await first.inbox.next((message) => message.type === "status" && message.status === "live");

    first.socket.send(JSON.stringify({ type: "rpc", request: { id: 7, method: "thread/list", params: {} } }));
    const response = await first.inbox.next((message) => message.type === "rpc");
    expect(response).toEqual({ type: "rpc", response: { id: 7, result: { data: [{ id: "real-thread" }] } } });
    expect(upstreamMessages.find((message) => message.method === "thread/list")?.id).not.toBe(7);

    broadcast({ method: "thread/started", params: { thread: { id: "real-thread" } } });
    first.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
    const firstEvent = await first.inbox.next((message) => message.type === "event");
    expect(firstEvent).toMatchObject({ type: "event", cursor: 1, payload: { method: "thread/started" } });
    first.socket.send(JSON.stringify({ type: "ack", cursor: 1 }));
    first.socket.close();
    await new Promise<void>((resolve) => first.socket.once("close", () => resolve()));

    broadcast({ method: "turn/completed", params: { threadId: "real-thread", turn: { id: "turn-1" } } });
    await new Promise((resolve) => setTimeout(resolve, 60));

    const second = await connectClient(port, token);
    second.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: 1 }));
    await expect(second.inbox.next((message) => message.type === "hello")).resolves.toMatchObject({
      headCursor: 2,
      snapshotRequired: false,
    });
    await expect(second.inbox.next((message) => message.type === "event" && message.cursor === 2)).resolves.toMatchObject({
      payload: { method: "turn/completed" },
    });
    await expect(second.inbox.next((message) => message.type === "caughtUp")).resolves.toEqual({
      type: "caughtUp",
      cursor: 2,
    });
    second.socket.close();
  });

  it("persists a live delta burst in one journal pass before emitting its compatible frames", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-live-batch-"));
    const token = "v".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
      replayJournalPath: path.join(directory, "replay.jsonl"),
    });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
    const appendBatch = vi.spyOn(ReplayJournal.prototype, "appendBatch");

    broadcast({ method: "item/agentMessage/delta", params: { threadId: "real-thread", itemId: "agent", delta: "one" } });
    broadcast({ method: "item/agentMessage/delta", params: { threadId: "real-thread", itemId: "agent", delta: "two" } });
    broadcast({ method: "item/agentMessage/delta", params: { threadId: "real-thread", itemId: "agent", delta: "three" } });

    await expect.poll(() => client.inbox.messages.filter((message) => message.type === "event").length).toBe(3);
    expect(appendBatch).toHaveBeenCalledTimes(1);
    expect(client.inbox.messages.filter((message) => message.type === "event")).toMatchObject([
      { cursor: 1, payload: { params: { delta: "one" }, codewideThreadPatch: { version: 1, operation: { kind: "itemTextDelta" } } } },
      { cursor: 2, payload: { params: { delta: "two" }, codewideThreadPatch: { version: 1, operation: { kind: "itemTextDelta" } } } },
      { cursor: 3, payload: { params: { delta: "three" }, codewideThreadPatch: { version: 1, operation: { kind: "itemTextDelta" } } } },
    ]);
    client.socket.close();
  });

  it("flushes partial live batches at lifecycle boundaries but not on deltas", () => {
    expect(shouldFlushLiveEventBatch("turn/completed")).toBe(true);
    expect(shouldFlushLiveEventBatch("companion/queue/changed")).toBe(true);
    expect(shouldFlushLiveEventBatch("thread/status/changed")).toBe(true);
    expect(shouldFlushLiveEventBatch("item/tool/requestUserInput")).toBe(true);
    expect(shouldFlushLiveEventBatch("item/agentMessage/delta")).toBe(false);
    expect(shouldFlushLiveEventBatch("item/reasoning/summaryTextDelta")).toBe(false);
  });

  it("uses a frame-sized batch for streamed agent text without accelerating tool output", () => {
    expect(liveEventBatchDelayMs("item/agentMessage/delta")).toBe(16);
    expect(liveEventBatchDelayMs("item/reasoning/textDelta")).toBe(32);
    expect(liveEventBatchDelayMs("item/commandExecution/outputDelta")).toBe(32);
  });

  it("serves companion dictation locally without forwarding OAuth or audio to App Server", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-dictation-rpc-"));
    const authFilePath = path.join(directory, "auth.json");
    await writeFile(authFilePath, JSON.stringify({
      tokens: { access_token: "host-oauth-secret-token-that-is-long-enough", account_id: "host-account", refresh_token: "unused" },
    }), { mode: 0o600 });
    const token = "d".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
      dictationOptions: {
        authFilePath,
        fetchImpl: async () => Response.json({ text: "remote transcript", asset_pointer: "private" }),
      },
    });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");

    client.socket.send(JSON.stringify({ type: "rpc", request: { id: 20, method: "companion/dictation/start", params: {} } }));
    const started = await client.inbox.next((message) => message.type === "rpc" && (message.response as JsonObject | undefined)?.id === 20);
    const sessionId = ((started.response as JsonObject).result as JsonObject).sessionId;
    client.socket.send(JSON.stringify({
      type: "rpc",
      request: {
        id: 21,
        method: "companion/dictation/append",
        params: { sessionId, data: Buffer.alloc(8).toString("base64"), sampleRate: 24_000, numChannels: 1, samplesPerChannel: 4 },
      },
    }));
    await client.inbox.next((message) => message.type === "rpc" && (message.response as JsonObject | undefined)?.id === 21);
    client.socket.send(JSON.stringify({ type: "rpc", request: { id: 22, method: "companion/dictation/finish", params: { sessionId } } }));
    await expect(client.inbox.next((message) => message.type === "rpc" && (message.response as JsonObject | undefined)?.id === 22))
      .resolves.toEqual({ type: "rpc", response: { id: 22, result: { text: "remote transcript" } } });
    expect(upstreamMessages.some((message) => String(message.method).startsWith("companion/dictation/"))).toBe(false);
    expect(JSON.stringify(client.inbox.messages)).not.toContain("host-oauth-secret-token-that-is-long-enough");
    expect(JSON.stringify(client.inbox.messages)).not.toContain("asset_pointer");
    client.socket.close();
  });

  it("replaces legacy resume pagination with one indexed history read", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-legacy-history-"));
    upstreamServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      upstreamServer?.once("listening", resolve);
      upstreamServer?.once("error", reject);
    });
    let historyReads = 0;
    let resumeParams: JsonObject | undefined;
    upstreamServer.on("connection", (socket) => {
      upstreamSockets.add(socket);
      socket.once("close", () => upstreamSockets.delete(socket));
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString("utf8")) as JsonObject;
        if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
        else if (message.method === "thread/read") {
          historyReads += 1;
          socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "legacy", recencyAt: 7, turns: [
            legacyTurn("one"), legacyTurn("two"), legacyTurn("three"),
          ] } } }));
        } else if (message.method === "thread/resume") {
          resumeParams = message.params as JsonObject;
          socket.send(JSON.stringify({ id: message.id, result: {
            thread: { id: "legacy", recencyAt: 7, turns: [] },
            initialTurnsPage: null,
            turnsBackwardsCursor: "upstream-cursor",
          } }));
        }
      });
    });
    const upstreamAddress = upstreamServer.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") throw new Error("Unexpected upstream address");
    const token = "h".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      deviceRegistryPath: path.join(directory, "devices.json"),
      connectUpstream: () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`),
    });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "rpc", request: {
      id: 30,
      method: "thread/resume",
      params: {
        threadId: "legacy",
        excludeTurns: true,
        initialTurnsPage: { limit: 2, sortDirection: "desc", itemsView: "summary" },
      },
    } }));
    const resumed = await client.inbox.next((message) => message.type === "rpc" && (message.response as JsonObject | undefined)?.id === 30);
    const result = (resumed.response as JsonObject).result as JsonObject;
    const page = result.initialTurnsPage as JsonObject;
    expect((page.data as JsonObject[]).map(({ id }) => id)).toEqual(["three", "two"]);
    const materializedThread = result.thread as JsonObject;
    expect((materializedThread.turns as JsonObject[]).map(({ id }) => id)).toEqual(["two", "three"]);
    expect(((materializedThread.codewide as JsonObject).readModelVersion)).toBe(1);
    expect(result.codewideReadModelVersion).toBe(1);
    expect(page.nextCursor).toEqual(expect.stringContaining("codewide-history-v1:"));
    expect(result.turnsBackwardsCursor).not.toBe("upstream-cursor");
    expect(resumeParams).not.toHaveProperty("initialTurnsPage");

    client.socket.send(JSON.stringify({ type: "rpc", request: {
      id: 31,
      method: "thread/items/list",
      params: { threadId: "legacy", turnId: "two", cursor: null, limit: 100, sortDirection: "asc" },
    } }));
    const activity = await client.inbox.next((message) => message.type === "rpc" && (message.response as JsonObject | undefined)?.id === 31);
    expect((((activity.response as JsonObject).result as JsonObject).data as unknown[])).toHaveLength(3);
    expect(historyReads).toBe(1);
    client.socket.close();
  });

  it("previews only exact local images observed from the trusted app server", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-observed-preview-"));
    const observed = path.join(directory, "observed.png");
    const unobserved = path.join(directory, "unobserved.png");
    await writeFile(observed, "observed", "utf8");
    await writeFile(unobserved, "private", "utf8");
    const token = "i".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
    });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));

    broadcast({
      method: "item/completed",
      params: {
        threadId: "real-thread",
        item: { type: "userMessage", content: [
          { type: "text", text: `# Files mentioned by the user:\n\n## observed.png: ${observed}\n\n## My request:\nInspect it` },
          { type: "image", url: `data:image/png;base64,${"A".repeat(256 * 1024)}` },
        ] },
      },
    });
    const projected = await client.inbox.next((message) => message.type === "event");
    const projectedItem = ((projected.payload as JsonObject).params as JsonObject).item as JsonObject;
    expect(JSON.stringify(projected).length).toBeLessThan(4_096);
    expect(projectedItem.content).toEqual(expect.arrayContaining([{ type: "localImage", path: observed }]));
    broadcast({
      method: "item/completed",
      params: {
        threadId: "real-thread",
        item: { type: "mcpToolCall", result: { type: "localImage", path: unobserved } },
      },
    });
    await client.inbox.next((message) => {
      const payload = message.payload as JsonObject | undefined;
      const params = payload?.params as JsonObject | undefined;
      const item = params?.item as JsonObject | undefined;
      return message.type === "event" && item?.type === "mcpToolCall";
    });

    const base = `http://127.0.0.1:${companion.address().port}/v1/files/preview?path=`;
    const headers = { authorization: `Bearer ${token}` };
    const allowed = await fetch(`${base}${encodeURIComponent(observed)}`, { headers });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("observed");
    const denied = await fetch(`${base}${encodeURIComponent(unobserved)}`, { headers });
    expect(denied.status).toBe(403);
    client.socket.close();
  });

  it("previews workspace files and exact outside attachments without exposing sibling paths", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-observed-workspace-"));
    const workspace = path.join(directory, "workspace");
    const guide = path.join(workspace, "guide.md");
    const attachment = path.join(directory, "attached.md");
    const linkedOutput = path.join(directory, "agent-output.md");
    const absoluteOutput = path.join(directory, "agent-absolute.md");
    const outside = path.join(directory, "private.txt");
    await mkdir(workspace);
    await writeFile(guide, "# Guide\n", "utf8");
    await writeFile(attachment, "# Attached\n", "utf8");
    await writeFile(linkedOutput, "# Relative agent output\n", "utf8");
    await writeFile(absoluteOutput, "# Absolute agent output\n", "utf8");
    await writeFile(outside, "private", "utf8");
    await symlink(outside, path.join(workspace, "escape.txt"));
    const token = "w".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
    });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));

    broadcast({
      method: "thread/started",
      params: { thread: { id: "thread", cwd: workspace, turns: [] } },
    });
    await client.inbox.next((message) => message.type === "event");
    broadcast({
      method: "item/completed",
      params: {
        threadId: "thread",
        item: {
          type: "userMessage",
          content: [{
            type: "text",
            text: `# Files mentioned by the user:\n\n## attached.md: \`${attachment}\`\n\n## My request for Codex:\n\nOpen it`,
          }],
        },
      },
    });
    await client.inbox.next((message) => message.type === "event");
    broadcast({
      method: "item/completed",
      params: {
        threadId: "thread",
        item: {
          type: "agentMessage",
          text: `Open [relative](<../agent-output.md>) or [absolute](<${absoluteOutput}>).`,
        },
      },
    });
    await client.inbox.next((message) => message.type === "event");

    const base = `http://127.0.0.1:${companion.address().port}/v1/files/preview?path=`;
    const headers = { authorization: `Bearer ${token}` };
    const allowed = await fetch(`${base}${encodeURIComponent(guide)}`, { headers });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("# Guide\n");
    const attached = await fetch(`${base}${encodeURIComponent(attachment)}`, { headers });
    expect(attached.status).toBe(200);
    expect(await attached.text()).toBe("# Attached\n");
    const relativeLinked = await fetch(`${base}${encodeURIComponent(linkedOutput)}`, { headers });
    expect(relativeLinked.status).toBe(200);
    expect(await relativeLinked.text()).toBe("# Relative agent output\n");
    const absoluteLinked = await fetch(`${base}${encodeURIComponent(absoluteOutput)}`, { headers });
    expect(absoluteLinked.status).toBe(200);
    expect(await absoluteLinked.text()).toBe("# Absolute agent output\n");
    expect((await fetch(`${base}${encodeURIComponent(outside)}`, { headers })).status).toBe(403);
    expect((await fetch(`${base}${encodeURIComponent(path.join(workspace, "escape.txt"))}`, { headers })).status).toBe(403);
    client.socket.close();
  });

  it("externalizes a multi-megabyte completed tool item before journaling or sending it", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-large-live-item-"));
    const token = "l".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
      deviceRegistryPath: path.join(directory, "devices.json"),
      replayJournalPath: path.join(directory, "replay.jsonl"),
    });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
    const output = "large output\n".repeat(200_000);
    broadcast({
      method: "item/completed",
      params: {
        threadId: "real-thread",
        turnId: "turn",
        item: { id: "command", type: "commandExecution", command: "generate", aggregatedOutput: output, status: "completed" },
      },
    });
    const event = await client.inbox.next((message) => message.type === "event");
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(40 * 1024);
    const item = (((event.payload as JsonObject).params as JsonObject).item as JsonObject);
    const metadata = item.codewideContent as { fields: Record<string, { id: string; byteLength: number }> };
    const reference = metadata.fields["/aggregatedOutput"]!;
    expect(reference.byteLength).toBe(Buffer.byteLength(output));
    expect((await readFile(path.join(directory, "replay.jsonl"))).byteLength).toBeLessThan(40 * 1024);
    const response = await fetch(`http://127.0.0.1:${companion.address().port}/v1/content/${reference.id}?offset=0&limit=4096`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(206);
    expect(Buffer.byteLength(await response.text())).toBeLessThanOrEqual(4_096);
    client.socket.close();
  });

  it("uses a snapshot instead of flooding a reconnecting client with a large replay", async () => {
    const connectUpstream = await startUpstream();
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-large-replay-"));
    const replayJournalPath = path.join(directory, "replay.jsonl");
    const journal = await ReplayJournal.open({ filePath: replayJournalPath });
    for (let index = 0; index < 513; index += 1) {
      await journal.append({ method: "thread/status/changed", params: { threadId: "thread", sequence: index } });
    }
    await journal.close();
    const token = "b".repeat(43);
    companion = await startHostCompanion({
      host: "127.0.0.1",
      port: 0,
      capabilityToken: token,
      connectUpstream,
      replayJournalPath,
    });
    const client = await connectClient(companion.address().port, token);

    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: 0 }));

    await expect(client.inbox.next((message) => message.type === "hello")).resolves.toMatchObject({
      headCursor: 513,
      snapshotRequired: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(client.inbox.messages.some((message) => message.type === "event")).toBe(false);
    client.socket.close();
  });

  it("disarms the hello deadline after a valid handshake", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const connectUpstream = await startUpstream();
    const token = "h".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token, connectUpstream });
    const client = await connectClient(companion.address().port, token);
    const helloTimerIndex = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 10_000);
    expect(helloTimerIndex).toBeGreaterThanOrEqual(0);
    const helloTimer = setTimeoutSpy.mock.results[helloTimerIndex]?.value;

    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "hello");

    expect(clearTimeoutSpy).toHaveBeenCalledWith(helloTimer);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.close();
  });

  it("ignores a stale duplicate acknowledgement without dropping the device", async () => {
    const connectUpstream = await startUpstream();
    const token = "a".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token, connectUpstream });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
    broadcast({ method: "thread/started", params: { thread: { id: "real-thread" } } });
    await client.inbox.next((message) => message.type === "event" && message.cursor === 1);

    client.socket.send(JSON.stringify({ type: "ack", cursor: 1 }));
    client.socket.send(JSON.stringify({ type: "ack", cursor: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.close();
  });

  it("routes a server request response exactly once across devices", async () => {
    const connectUpstream = await startUpstream();
    const token = "r".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token, connectUpstream });
    const { port } = companion.address();
    const first = await connectClient(port, token);
    const second = await connectClient(port, token);
    for (const client of [first, second]) {
      client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
      await client.inbox.next((message) => message.type === "status" && message.status === "live");
      client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
    }

    broadcast({ id: 99, method: "item/commandExecution/requestApproval", params: { command: "true" } });
    await first.inbox.next((message) => message.type === "event" && (message.payload as JsonObject | undefined)?.id === 99);
    await second.inbox.next((message) => message.type === "event" && (message.payload as JsonObject | undefined)?.id === 99);
    const reconnect = await connectClient(port, token);
    reconnect.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await expect(reconnect.inbox.next((message) => message.type === "hello")).resolves.toMatchObject({
      pendingRequests: [{ id: 99, method: "item/commandExecution/requestApproval", params: { command: "true" } }],
    });
    reconnect.socket.close();
    first.socket.send(JSON.stringify({ type: "serverResponse", response: { id: 99, result: { decision: "accept" } } }));
    await expect(first.inbox.next((message) => message.type === "serverResponseAccepted")).resolves.toMatchObject({ id: 99 });
    second.socket.send(JSON.stringify({ type: "serverResponse", response: { id: 99, result: { decision: "decline" } } }));
    await expect(second.inbox.next((message) => message.type === "serverResponseRejected")).resolves.toMatchObject({
      id: 99,
      reason: "already_resolved_or_unknown",
    });
    await expect(second.inbox.next((message) => message.type === "event" && (message.payload as JsonObject | undefined)?.method === "serverRequest/resolved")).resolves.toMatchObject({
      payload: { params: { requestId: 99, reason: "responded" } },
    });
    expect(upstreamMessages.filter((message) => message.id === 99 && "result" in message)).toHaveLength(1);
    first.socket.close();
    second.socket.close();
  });

  it("resolves stale approvals for every client when the upstream disconnects", async () => {
    const connectUpstream = await startUpstream();
    const token = "u".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token, connectUpstream });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));

    broadcast({ id: "approval-lost", method: "item/fileChange/requestApproval", params: { threadId: "real-thread" } });
    await client.inbox.next((message) => message.type === "event" && (message.payload as JsonObject | undefined)?.id === "approval-lost");
    for (const socket of [...upstreamSockets]) socket.close(1012, "restart");

    await expect(client.inbox.next((message) => message.type === "event" && (message.payload as JsonObject | undefined)?.method === "serverRequest/resolved")).resolves.toMatchObject({
      payload: { params: { requestId: "approval-lost", reason: "upstream_disconnected" } },
    });
    client.socket.close();
  });

  it("bounds unanswered RPC requests independently for each client", async () => {
    const connectUpstream = await startUpstream();
    const token = "p".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token, connectUpstream });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    for (let id = 0; id <= 128; id += 1) {
      client.socket.send(JSON.stringify({ type: "rpc", request: { id, method: "thread/read", params: { threadId: "x" } } }));
    }
    await expect(client.inbox.next((message) => {
      const response = message.response as JsonObject | undefined;
      const error = response?.error as JsonObject | undefined;
      return message.type === "rpc" && response?.id === 128 && error?.code === -32004;
    })).resolves.toMatchObject({
      response: { id: 128, error: { code: -32004, message: "Too many pending RPC requests" } },
    });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.close();
  });

  it("keeps one durable queue head claimed during asynchronous dispatch preparation", async () => {
    upstreamServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      upstreamServer?.once("listening", resolve);
      upstreamServer?.once("error", reject);
    });
    let turnsPageCount = 0;
    let turnStartCount = 0;
    let releasePreparation: (() => void) | undefined;
    const preparationBlocked = new Promise<void>((resolve) => { releasePreparation = resolve; });
    let preparationStarted: (() => void) | undefined;
    const preparationStartedPromise = new Promise<void>((resolve) => { preparationStarted = resolve; });
    upstreamServer.on("connection", (socket) => {
      upstreamSockets.add(socket);
      socket.once("close", () => upstreamSockets.delete(socket));
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString("utf8")) as JsonObject;
        if (message.method === "initialize") {
          socket.send(JSON.stringify({ id: message.id, result: {} }));
        } else if (message.method === "thread/turns/list") {
          turnsPageCount += 1;
          socket.send(JSON.stringify({
            id: message.id,
            result: { data: [], nextCursor: null },
          }));
        } else if (message.method === "turn/start") {
          turnStartCount += 1;
          socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "queue-turn" } } }));
        }
      });
    });
    const upstreamAddress = upstreamServer.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") throw new Error("Unexpected upstream address");
    const queue = await HostQueueStore.open();
    await queue.put({
      commandId: "queue-race-command",
      remoteThreadId: "queue-thread",
      method: "turn/start",
      params: {
        threadId: "queue-thread",
        clientUserMessageId: "queue-race-command",
        input: [{ type: "text", text: "run once" }],
      },
    });
    const hub = new AppServerSyncHub(
      () => new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`),
      await ReplayJournal.open(),
      queue,
      async (_method, params) => {
        preparationStarted?.();
        await preparationBlocked;
        return params;
      },
    );
    const downstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      downstream.once("listening", resolve);
      downstream.once("error", reject);
    });
    downstream.on("connection", (socket) => hub.attach(socket, { kind: "admin", deviceId: null, scopes: [] }));
    const downstreamAddress = downstream.address();
    if (downstreamAddress === null || typeof downstreamAddress === "string") throw new Error("Unexpected downstream address");
    const client = new WebSocket(`ws://127.0.0.1:${downstreamAddress.port}`);
    const inbox = new Inbox(client);
    try {
      await new Promise<void>((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
      client.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
      await inbox.next((message) => message.type === "status" && message.status === "live");
      client.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
      await preparationStartedPromise;

      broadcast({ method: "thread/status/changed", params: { threadId: "other-thread", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(turnsPageCount).toBe(1);

      releasePreparation?.();
      await expect.poll(() => turnStartCount).toBe(1);
      await expect(inbox.next((message) => {
        const payload = message.payload as JsonObject | undefined;
        const params = payload?.params as JsonObject | undefined;
        const data = params?.data;
        return message.type === "event"
          && payload?.method === "companion/queue/changed"
          && Array.isArray(data)
          && (data[0] as JsonObject | undefined)?.state === "delivered";
      })).resolves.toMatchObject({
        payload: { method: "companion/queue/changed", params: { threadId: "queue-thread" } },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(turnsPageCount).toBe(1);
    } finally {
      releasePreparation?.();
      client.close();
      await hub.close();
      await new Promise<void>((resolve, reject) => downstream.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("fails closed when a replay event cannot be persisted", async () => {
    const connectUpstream = await startUpstream();
    const token = "j".repeat(43);
    companion = await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token, connectUpstream });
    const client = await connectClient(companion.address().port, token);
    client.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await client.inbox.next((message) => message.type === "status" && message.status === "live");
    client.socket.send(JSON.stringify({ type: "snapshotApplied", cursor: 0 }));
    vi.spyOn(ReplayJournal.prototype, "appendBatch").mockRejectedValueOnce(new Error("disk full"));

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      client.socket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
    });
    broadcast({ method: "thread/started", params: { thread: { id: "must-not-be-delivered" } } });
    await expect(closed).resolves.toEqual({ code: 1011, reason: "replay_journal_failed" });
    expect(client.inbox.messages.some((message) => {
      const payload = message.payload as JsonObject | undefined;
      return message.type === "event" && (payload?.params as JsonObject | undefined)?.thread !== undefined;
    })).toBe(false);
  });
});

function legacyTurn(id: string): JsonObject {
  return {
    id,
    items: [
      { type: "userMessage", id: `${id}-user`, content: [{ type: "text", text: id }] },
      { type: "commandExecution", id: `${id}-command`, command: id },
      { type: "agentMessage", id: `${id}-agent`, text: id },
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1_000,
  };
}
