import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

import { startHostCompanion } from "./server.js";

type JsonObject = Record<string, unknown>;

const externalUrl = process.env.CODEWIDE_SYNC_URL;
const token = externalUrl === undefined
  ? randomBytes(32).toString("base64url")
  : (process.env.CODEWIDE_TOKEN
    ?? await readFile(
      process.env.CODEWIDE_TOKEN_FILE ?? path.join(homedir(), ".codewide", "host.token"),
      "utf8",
    )).trim();
const companion = externalUrl === undefined
  ? await startHostCompanion({ host: "127.0.0.1", port: 0, capabilityToken: token })
  : undefined;
const syncUrl = externalUrl ?? `ws://127.0.0.1:${companion?.address().port ?? 0}/v1/sync`;
let socket: WebSocket | undefined;
let threadId: string | undefined;
let rpcCounter = 0;
let currentStep = "connect";
const messages: JsonObject[] = [];
const waiters = new Set<() => void>();

try {
  socket = new WebSocket(syncUrl, {
    headers: { authorization: `Bearer ${token}` },
  });
  socket.on("message", (data) => {
    messages.push(JSON.parse(data.toString("utf8")) as JsonObject);
    for (const waiter of waiters) waiter();
  });
  await new Promise<void>((resolve, reject) => {
    socket?.once("open", resolve);
    socket?.once("error", reject);
  });
  const waitFor = async (predicate: (message: JsonObject) => boolean, timeoutMs = 30_000): Promise<JsonObject> => {
    const existing = messages.find(predicate);
    if (existing !== undefined) return existing;
    return await new Promise<JsonObject>((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`Live mutation smoke timed out during ${currentStep}`));
      }, timeoutMs);
      const check = () => {
        const message = messages.find(predicate);
        if (message === undefined) return;
        clearTimeout(timeout);
        waiters.delete(check);
        resolve(message);
      };
      waiters.add(check);
    });
  };
  const rpc = async <T extends JsonObject>(method: string, params: JsonObject): Promise<T> => {
    currentStep = method;
    const id = `mutation-${++rpcCounter}`;
    socket?.send(JSON.stringify({ type: "rpc", request: { id, method, params } }));
    const envelope = await waitFor((message) => {
      const response = asObject(message.response);
      return message.type === "rpc" && response?.id === id;
    }, 120_000);
    const response = asObject(envelope.response);
    if (response === null || response.error !== undefined) throw new Error(`${method} failed: ${JSON.stringify(response?.error)}`);
    const result = asObject(response.result);
    if (result === null) throw new Error(`${method} returned no result`);
    return result as T;
  };

  currentStep = "hello";
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
  const hello = await waitFor((message) => message.type === "hello");
  await waitFor((message) => message.type === "status" && message.status === "live");
  if (hello.snapshotRequired === true) {
    if (typeof hello.headCursor !== "number") throw new Error("Snapshot handshake returned no head cursor");
    currentStep = "snapshotApplied";
    socket.send(JSON.stringify({ type: "snapshotApplied", cursor: hello.headCursor }));
    await waitFor((message) => message.type === "caughtUp" && typeof message.cursor === "number" && message.cursor >= (hello.headCursor as number));
  }
  const started = await rpc<{ thread: JsonObject }>("thread/start", {});
  threadId = stringField(started.thread, "id");
  const smokeName = `CodeWide smoke ${new Date().toISOString()}`;
  await rpc("thread/name/set", { threadId, name: smokeName });
  await rpc("thread/goal/set", { threadId, objective: "Verify CodeWide live mutation transport", status: "paused", tokenBudget: 256 });
  const goal = await rpc<{ goal: JsonObject | null }>("thread/goal/get", { threadId });
  if (goal.goal === null || goal.goal.objective !== "Verify CodeWide live mutation transport") throw new Error("Goal did not round-trip");
  await rpc("thread/goal/clear", { threadId });

  const clientUserMessageId = `live-smoke-${randomUUID()}`;
  const turnStarted = await rpc<{ turn: JsonObject }>("turn/start", {
    threadId,
    clientUserMessageId,
    input: [{ type: "text", text: "Reply with exactly REMOTE_SMOKE_OK and nothing else.", text_elements: [] }],
  });
  const turnId = stringField(turnStarted.turn, "id");
  currentStep = "turn/completed";
  await waitFor((message) => {
    if (message.type !== "event") return false;
    const payload = asObject(message.payload);
    const params = asObject(payload?.params);
    const turn = asObject(params?.turn);
    return payload?.method === "turn/completed" && params?.threadId === threadId && turn?.id === turnId;
  }, 180_000);
  const read = await rpc<{ thread: JsonObject }>("thread/read", { threadId, includeTurns: true });
  if (!threadContainsClientMessage(read.thread, clientUserMessageId)) throw new Error("Accepted user message was not durable");
  const tokenUsageObserved = messages.some((message) => {
    const payload = asObject(message.payload);
    const params = asObject(payload?.params);
    return message.type === "event" && payload?.method === "thread/tokenUsage/updated" && params?.threadId === threadId;
  });
  if (!tokenUsageObserved) throw new Error("Live turn emitted no token usage update");

  const forked = await rpc<{ thread: JsonObject }>("thread/fork", { threadId, lastTurnId: turnId, ephemeral: true });
  const forkedId = stringField(forked.thread, "id");
  if (forkedId === threadId) throw new Error("Fork reused the source thread id");
  await rpc("thread/archive", { threadId });
  await rpc("thread/unarchive", { threadId });
  await rpc("thread/delete", { threadId });
  threadId = undefined;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    transport: "companion-sync-v1",
    mutations: ["thread/start", "thread/name/set", "goal/set/get/clear", "turn/start", "thread/read", "thread/fork", "archive/unarchive", "thread/delete"],
    acceptedClientMessage: true,
    tokenUsageObserved,
    forked: true,
  })}\n`);
} finally {
  if (threadId !== undefined && socket?.readyState === WebSocket.OPEN) {
    const id = `cleanup-${Date.now()}`;
    socket.send(JSON.stringify({ type: "rpc", request: { id, method: "thread/delete", params: { threadId } } }));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  socket?.close();
  await companion?.close();
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringField(value: unknown, field: string): string {
  const object = asObject(value);
  if (typeof object?.[field] !== "string") throw new Error(`Missing ${field}`);
  return object[field];
}

function threadContainsClientMessage(thread: JsonObject, clientId: string): boolean {
  if (!Array.isArray(thread.turns)) return false;
  return thread.turns.some((rawTurn) => {
    const turn = asObject(rawTurn);
    return Array.isArray(turn?.items) && turn.items.some((rawItem) => asObject(rawItem)?.clientId === clientId);
  });
}
