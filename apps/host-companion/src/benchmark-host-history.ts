import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { WebSocket, type RawData } from "ws";

type JsonObject = Record<string, unknown>;

const threadId = process.env.CODEX_THREAD_ID;
if (threadId === undefined) throw new Error("CODEX_THREAD_ID is required");
const token = (await readFile(path.join(process.env.HOME ?? ".", ".codewide", "host.token"), "utf8")).trim();
const socket = new WebSocket("ws://127.0.0.1:8765/v1/sync", { headers: { authorization: `Bearer ${token}` } });
const pending = new Map<number, { resolve(value: JsonObject): void; reject(error: Error): void }>();
socket.on("message", (data: RawData) => {
  const envelope = JSON.parse(data.toString("utf8")) as JsonObject;
  if (envelope.type !== "rpc") return;
  const response = envelope.response as JsonObject;
  const waiter = pending.get(Number(response.id));
  if (waiter === undefined) return;
  pending.delete(Number(response.id));
  if (response.error !== undefined) waiter.reject(new Error(JSON.stringify(response.error)));
  else waiter.resolve(response.result as JsonObject);
});
await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
let id = 0;
const rpc = async (method: string, params: JsonObject): Promise<{ value: JsonObject; ms: number }> => {
  id += 1;
  const requestId = id;
  const startedAt = performance.now();
  const value = await new Promise<JsonObject>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ type: "rpc", request: { id: requestId, method, params } }));
  });
  return { value, ms: Math.round((performance.now() - startedAt) * 10) / 10 };
};

const resumed = await rpc("thread/resume", {
  threadId,
  excludeTurns: true,
  initialTurnsPage: { limit: 6, sortDirection: "desc", itemsView: "summary" },
});
const first = { value: resumed.value.initialTurnsPage as JsonObject, ms: resumed.ms };
const second = await rpc("thread/turns/list", { threadId, cursor: first.value.nextCursor, limit: 12, sortDirection: "desc", itemsView: "summary" });
const firstTurn = (first.value.data as JsonObject[])[0];
if (firstTurn === undefined || typeof firstTurn.id !== "string") throw new Error("History page returned no turn");
const activity = await rpc("thread/items/list", { threadId, turnId: firstTurn.id, cursor: null, limit: 100, sortDirection: "asc" });
const firstPageTurns = first.value.data as JsonObject[];
const secondPageTurns = second.value.data as JsonObject[];
process.stdout.write(`${JSON.stringify({
  resumeWithColdPageMs: first.ms,
  warmPageMs: second.ms,
  activityMs: activity.ms,
  firstPageTurns: firstPageTurns.length,
  secondPageTurns: secondPageTurns.length,
  firstPageTurnIds: firstPageTurns.map((turn) => turn.id),
  secondPageTurnIds: secondPageTurns.map((turn) => turn.id),
  activityItems: (activity.value.data as unknown[]).length,
})}\n`);
socket.close();
