import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

type JsonObject = Record<string, unknown>;

const pcmPath = process.env.CODEX_DICTATION_PCM_FILE;
if (pcmPath === undefined) throw new Error("CODEX_DICTATION_PCM_FILE is required");
const sampleRate = Number(process.env.CODEX_DICTATION_SAMPLE_RATE ?? 48_000);
const numChannels = Number(process.env.CODEX_DICTATION_CHANNELS ?? 1);
if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) throw new Error("Invalid sample rate");
if (numChannels !== 1 && numChannels !== 2) throw new Error("Invalid channel count");

const syncUrl = process.env.CODEWIDE_SYNC_URL ?? "ws://127.0.0.1:8766/v1/sync";
const token = (process.env.CODEWIDE_TOKEN ?? await readFile(
  process.env.CODEWIDE_TOKEN_FILE ?? path.join(homedir(), ".codewide", "host.token"),
  "utf8",
)).trim();
const pcm = await readFile(pcmPath);
const bytesPerFrame = numChannels * 2;
if (pcm.length === 0 || pcm.length % bytesPerFrame !== 0) throw new Error("PCM input is empty or misaligned");

const socket = new WebSocket(syncUrl, { headers: { authorization: `Bearer ${token}` } });
const inbox: JsonObject[] = [];
const waiters = new Set<() => void>();
let requestCounter = 0;
let sessionId: string | undefined;

socket.on("message", (data) => {
  inbox.push(JSON.parse(data.toString("utf8")) as JsonObject);
  for (const waiter of waiters) waiter();
});

const waitFor = async (predicate: (message: JsonObject) => boolean, timeoutMs = 120_000): Promise<JsonObject> => {
  const existing = inbox.find(predicate);
  if (existing !== undefined) return existing;
  return await new Promise<JsonObject>((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(check);
      reject(new Error("Dictation smoke timed out"));
    }, timeoutMs);
    const check = (): void => {
      const message = inbox.find(predicate);
      if (message === undefined) return;
      clearTimeout(timeout);
      waiters.delete(check);
      resolve(message);
    };
    waiters.add(check);
  });
};

const rpc = async (method: string, params: JsonObject): Promise<JsonObject> => {
  const id = `dictation-smoke-${++requestCounter}`;
  socket.send(JSON.stringify({ type: "rpc", request: { id, method, params } }));
  const envelope = await waitFor((message) => message.type === "rpc" && asObject(message.response)?.id === id);
  const response = asObject(envelope.response);
  if (response === null || response.error !== undefined) throw new Error(`${method} failed: ${JSON.stringify(response?.error)}`);
  const result = asObject(response.result);
  if (result === null) throw new Error(`${method} returned no result`);
  return result;
};

try {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
  const hello = await waitFor((message) => message.type === "hello");
  await waitFor((message) => message.type === "status" && message.status === "live");
  if (hello.snapshotRequired === true) {
    if (typeof hello.headCursor !== "number") throw new Error("Snapshot handshake returned no cursor");
    socket.send(JSON.stringify({ type: "snapshotApplied", cursor: hello.headCursor }));
    await waitFor((message) => message.type === "caughtUp");
  }

  const started = await rpc("companion/dictation/start", { language: process.env.CODEX_DICTATION_LANGUAGE ?? "ru" });
  if (typeof started.sessionId !== "string") throw new Error("Dictation start returned no session id");
  sessionId = started.sessionId;
  const chunkBytes = 24_000 - (24_000 % bytesPerFrame);
  const chunks = [];
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    const data = pcm.subarray(offset, Math.min(offset + chunkBytes, pcm.length));
    chunks.push({
      data: data.toString("base64"),
      sampleRate,
      numChannels,
      samplesPerChannel: data.length / bytesPerFrame,
    });
  }
  await rpc("companion/dictation/appendBatch", { sessionId, batchId: "live-dictation-smoke", chunks });
  const finished = await rpc("companion/dictation/finish", { sessionId });
  if (finished.retryable === true) throw new Error(String(finished.message ?? "Dictation remained retryable"));
  if (typeof finished.text !== "string" || finished.text.trim() === "") throw new Error("Dictation returned no text");
  process.stdout.write(`${JSON.stringify({ ok: true, audioBytes: pcm.length, transcriptCharacters: finished.text.length })}\n`);
} finally {
  if (sessionId !== undefined && socket.readyState === WebSocket.OPEN) {
    await rpc("companion/dictation/cancel", { sessionId }).catch(() => undefined);
  }
  socket.close();
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
