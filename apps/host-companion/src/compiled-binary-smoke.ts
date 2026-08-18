import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { WebSocket } from "ws";

type JsonObject = Record<string, unknown>;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(packageRoot, "dist", "codewide-host");
const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "codewide-compiled-smoke-"));
const token = randomBytes(32).toString("base64url");
const tokenFile = path.join(runtimeDirectory, "host.token");
await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });

let child: ChildProcessWithoutNullStreams | undefined;
let socket: WebSocket | undefined;
let currentStep = "start";
try {
  child = spawn(binary, ["serve"], {
    env: {
      ...process.env,
      CODEWIDE_TOKEN_FILE: tokenFile,
      CODEWIDE_REPLAY_JOURNAL: path.join(runtimeDirectory, "replay.jsonl"),
      CODEWIDE_QUEUE_FILE: path.join(runtimeDirectory, "queue.json"),
      CODEWIDE_DEVICE_REGISTRY: path.join(runtimeDirectory, "devices.json"),
      CODEWIDE_HOST: "127.0.0.1",
      CODEWIDE_PORT: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const address = await waitForAddress(child);
  currentStep = "connect";
  socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/sync`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const messages: JsonObject[] = [];
  const waiters = new Set<() => void>();
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
        const safeFrames = messages.map((message) => ({ type: message.type, status: message.status }));
        reject(new Error(`Compiled host smoke timed out during ${currentStep}: ${JSON.stringify(safeFrames)}`));
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

  currentStep = "hello";
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
  await waitFor((message) => message.type === "hello");
  currentStep = "upstream-live";
  await waitFor((message) => message.type === "status" && message.status === "live");

  // The regression this smoke protects used to kill every valid client at the
  // hello deadline because the timer was only cleared on socket close.
  currentStep = "past-hello-deadline";
  await new Promise((resolve) => setTimeout(resolve, 10_500));
  socket.send(JSON.stringify({ type: "ping", nonce: "past-hello-deadline" }));
  await waitFor((message) => message.type === "pong" && message.nonce === "past-hello-deadline");

  currentStep = "thread-list";
  socket.send(JSON.stringify({
    type: "rpc",
    request: { id: 1, method: "thread/list", params: { limit: 1, sortKey: "updated_at", sortDirection: "desc" } },
  }));
  const envelope = await waitFor((message) => message.type === "rpc");
  const response = envelope.response as { result?: { data?: unknown[] }; error?: unknown };
  if (response.error !== undefined || !Array.isArray(response.result?.data)) {
    throw new Error("Compiled host thread/list failed");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    binary: "codewide-host",
    validHelloPastDeadline: true,
    threadCount: response.result.data.length,
  })}\n`);
} finally {
  socket?.close();
  if (child !== undefined && child.exitCode === null) child.kill("SIGTERM");
  if (child !== undefined && child.exitCode === null) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      child?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  await rm(runtimeDirectory, { recursive: true, force: true });
}

async function waitForAddress(process: ChildProcessWithoutNullStreams): Promise<{ port: number }> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => reject(new Error("Compiled host did not start before the deadline")), 30_000);
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      const line = stdout.slice(0, newline);
      const parsed = JSON.parse(line) as { status?: unknown; port?: unknown };
      if (parsed.status !== "listening" || !Number.isSafeInteger(parsed.port)) return;
      clearTimeout(timeout);
      resolve({ port: parsed.port as number });
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Compiled host exited before listening (${code ?? "signal"})`));
    });
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
