import { randomBytes } from "node:crypto";

import { WebSocket } from "ws";

import { startHostCompanion } from "./server.js";

type JsonObject = Record<string, unknown>;

const token = randomBytes(32).toString("base64url");
const companion = await startHostCompanion({
  host: "127.0.0.1",
  port: 0,
  capabilityToken: token,
});

try {
  const { port } = companion.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/sync`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const messages: JsonObject[] = [];
  const waiters = new Set<() => void>();
  socket.on("message", (data) => {
    messages.push(JSON.parse(data.toString("utf8")) as JsonObject);
    for (const waiter of waiters) waiter();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const waitFor = async (predicate: (message: JsonObject) => boolean): Promise<JsonObject> => {
    const existing = messages.find(predicate);
    if (existing !== undefined) return existing;
    return await new Promise<JsonObject>((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`Live smoke timed out; received ${JSON.stringify(messages)}`));
      }, 30_000);
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

  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
  const hello = await waitFor((message) => message.type === "hello");
  await waitFor((message) => message.type === "status" && message.status === "live");

  socket.send(JSON.stringify({
    type: "rpc",
    request: {
      id: 1,
      method: "thread/list",
      params: { limit: 5, sortKey: "updated_at", sortDirection: "desc" },
    },
  }));
  const envelope = await waitFor((message) => message.type === "rpc");
  const response = envelope.response as { result?: { data?: unknown[] }; error?: unknown };
  if (response.error !== undefined || !Array.isArray(response.result?.data)) {
    throw new Error(`Live thread/list failed: ${JSON.stringify(response)}`);
  }
  const firstThread = response.result.data[0] as { id?: unknown } | undefined;
  let threadGoalGetSupported = false;
  if (typeof firstThread?.id === "string") {
    socket.send(JSON.stringify({
      type: "rpc",
      request: { id: 2, method: "thread/goal/get", params: { threadId: firstThread.id } },
    }));
    const goalEnvelope = await waitFor((message) => {
      if (message.type !== "rpc") return false;
      const rpcResponse = message.response as { id?: unknown } | undefined;
      return rpcResponse?.id === 2;
    });
    const goalResponse = goalEnvelope.response as { result?: { goal?: unknown }; error?: unknown };
    if (goalResponse.error !== undefined || goalResponse.result === undefined || !("goal" in goalResponse.result)) {
      throw new Error(`Live thread/goal/get failed: ${JSON.stringify(goalResponse)}`);
    }
    threadGoalGetSupported = true;
  }
  socket.send(JSON.stringify({ type: "snapshotApplied", cursor: hello.headCursor }));
  await waitFor((message) => message.type === "caughtUp");
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      transport: "companion-sync-v1",
      threadCount: response.result.data.length,
      threadGoalGetSupported,
      replayCursor: hello.headCursor,
    })}\n`,
  );
  socket.close();
} finally {
  await companion.close();
}
