import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { WebSocket, type RawData } from "ws";

type JsonObject = Record<string, unknown>;
type RpcResult = { value: JsonObject; ms: number };
type RustTurn = { id: string; startOffset: number };
type RustTail = { elapsedMs: number; bytesScanned: number; turns: RustTurn[] };
type RustDigest = {
  id: string;
  status: string;
  userTextBytes: number | null;
  finalAgentTextBytes: number | null;
  activityCount: number;
  activityKinds: string[];
  unknownEventKinds: string[];
};

const run = promisify(execFile);
const threadId = required("CODEX_THREAD_ID");
const rollout = required("CODEX_ROLLOUT");
const rustBinary = process.env.RUST_COMPANION_BIN
  ?? path.resolve("target/release/codewide-host-rs");
const token = (await readFile(
  path.join(process.env.HOME ?? ".", ".codewide", "host.token"),
  "utf8",
)).trim();
const socket = new WebSocket("ws://127.0.0.1:8765/v1/sync", {
  headers: { authorization: `Bearer ${token}` },
});
const pending = new Map<number, {
  resolve(value: JsonObject): void;
  reject(error: Error): void;
}>();
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
await new Promise<void>((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});
socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));

let requestId = 0;
const rpc = async (method: string, params: JsonObject): Promise<RpcResult> => {
  requestId += 1;
  const id = requestId;
  const startedAt = performance.now();
  const value = await new Promise<JsonObject>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "rpc", request: { id, method, params } }));
  });
  return { value, ms: elapsed(startedAt) };
};

try {
  const firstNode = await rpc("thread/resume", {
    threadId,
    excludeTurns: true,
    initialTurnsPage: { limit: 12, sortDirection: "desc", itemsView: "summary" },
  });
  const firstNodePage = firstNode.value.initialTurnsPage as JsonObject;
  const firstRust = await rustTail();
  const firstNodeIds = ids(firstNodePage);
  const firstRustIds = firstRust.value.turns.map(({ id }) => id);
  assertSame("first page", firstNodeIds, firstRustIds);
  const rustDigests = await rustDigestPage();
  const nodeDigests = normalizeNodeTurns(firstNodePage);
  assertDigestParity(nodeDigests, rustDigests.value);
  const contentLengthMismatches = compareContentLengths(nodeDigests, rustDigests.value);

  const secondNode = await rpc("thread/turns/list", {
    threadId,
    cursor: firstNodePage.nextCursor,
    limit: 12,
    sortDirection: "desc",
    itemsView: "summary",
  });
  const beforeOffset = firstRust.value.turns.at(-1)?.startOffset;
  if (beforeOffset === undefined) throw new Error("Rust returned no first-page turns");
  const secondRust = await rustTail(beforeOffset);
  const secondNodeIds = ids(secondNode.value);
  const secondRustIds = secondRust.value.turns.map(({ id }) => id);
  assertSame("second page", secondNodeIds, secondRustIds);

  process.stdout.write(`${JSON.stringify({
    status: "match",
    pages: 2,
    turns: firstNodeIds.length + secondNodeIds.length,
    nodeMs: Math.round((firstNode.ms + secondNode.ms) * 10) / 10,
    rustProcessMs: Math.round((firstRust.ms + secondRust.ms) * 10) / 10,
    rustScanMs: firstRust.value.elapsedMs + secondRust.value.elapsedMs,
    rustBytesScanned: firstRust.value.bytesScanned + secondRust.value.bytesScanned,
    semanticTurns: rustDigests.value.length,
    semanticProcessMs: rustDigests.ms,
    contentLengthMismatches,
    nodeFirstTurn: summarizeNodeTurn(firstNodePage),
  })}\n`);
} finally {
  socket.close();
}

async function rustTail(beforeOffset?: number): Promise<{ value: RustTail; ms: number }> {
  const args = ["tail", "--rollout", rollout, "--limit", "12"];
  if (beforeOffset !== undefined) args.push("--before-offset", String(beforeOffset));
  const startedAt = performance.now();
  const { stdout } = await run(rustBinary, args, { maxBuffer: 16 * 1024 * 1024 });
  return { value: JSON.parse(stdout) as RustTail, ms: elapsed(startedAt) };
}

async function rustDigestPage(): Promise<{ value: RustDigest[]; ms: number }> {
  const startedAt = performance.now();
  const { stdout } = await run(
    rustBinary,
    ["digest-page", "--rollout", rollout, "--limit", "12"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return { value: JSON.parse(stdout) as RustDigest[], ms: elapsed(startedAt) };
}

function ids(page: JsonObject): string[] {
  const data = page.data;
  if (!Array.isArray(data)) throw new Error("Node page has no data array");
  return data.map((turn) => {
    if (typeof turn !== "object" || turn === null || typeof (turn as JsonObject).id !== "string") {
      throw new Error("Node page contains a turn without an id");
    }
    return (turn as JsonObject).id as string;
  });
}

function assertSame(label: string, expected: string[], actual: string[]): void {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return;
  throw new Error(`${label} differs: ${JSON.stringify({ expected, actual })}`);
}

function summarizeNodeTurn(page: JsonObject): JsonObject | null {
  const turn = Array.isArray(page.data) ? page.data[0] as JsonObject | undefined : undefined;
  if (turn === undefined) return null;
  const items = Array.isArray(turn.items) ? turn.items as JsonObject[] : [];
  const codewide = typeof turn.codewide === "object" && turn.codewide !== null
    ? turn.codewide as JsonObject
    : {};
  return {
    id: turn.id,
    status: turn.status,
    turnKeys: Object.keys(turn).sort(),
    itemIds: items.map((item) => item.id),
    itemTypes: items.map((item) => item.type),
    itemKeys: items.map((item) => Object.keys(item).sort()),
    remoteKeys: Object.keys(codewide).sort(),
    activity: codewide.activity,
  };
}

function normalizeNodeTurns(page: JsonObject): RustDigest[] {
  const turns = Array.isArray(page.data) ? page.data as JsonObject[] : [];
  return turns.map((turn) => {
    const items = Array.isArray(turn.items) ? turn.items as JsonObject[] : [];
    const user = items.find((item) => item.type === "userMessage");
    const agent = items.findLast((item) => item.type === "agentMessage");
    const remote = typeof turn.codewide === "object" && turn.codewide !== null
      ? turn.codewide as JsonObject
      : {};
    const activity = typeof remote.activity === "object" && remote.activity !== null
      ? remote.activity as JsonObject
      : {};
    const activityKinds = Array.isArray(activity.kinds)
      ? activity.kinds.filter((kind): kind is string => typeof kind === "string")
      : [];
    return {
      id: String(turn.id),
      status: String(turn.status),
      userTextBytes: userTextBytes(user) ?? null,
      finalAgentTextBytes: typeof agent?.text === "string" ? Buffer.byteLength(agent.text) : null,
      activityCount: typeof activity.count === "number" ? activity.count : 0,
      activityKinds,
      unknownEventKinds: [],
    };
  });
}

function userTextBytes(item: JsonObject | undefined): number | undefined {
  if (!Array.isArray(item?.content)) return undefined;
  const text = (item.content as JsonObject[])
    .filter((content) => content.type === "text" && typeof content.text === "string")
    .map((content) => content.text as string)
    .join("");
  return Buffer.byteLength(text);
}

function assertDigestParity(expected: RustDigest[], actual: RustDigest[]): void {
  const normalize = (digest: RustDigest) => ({
    id: digest.id,
    status: digest.status,
    activityCount: digest.activityCount,
    activityKinds: digest.activityKinds,
    unknownEventKinds: digest.unknownEventKinds,
  });
  const expectedComparable = expected.map(normalize);
  const actualComparable = actual.map(normalize);
  if (JSON.stringify(expectedComparable) === JSON.stringify(actualComparable)) return;
  throw new Error(`semantic page differs: ${JSON.stringify({ expected: expectedComparable, actual: actualComparable })}`);
}

function compareContentLengths(expected: RustDigest[], actual: RustDigest[]): JsonObject[] {
  return expected.flatMap((candidate, index) => {
    const observed = actual[index];
    if (observed !== undefined
      && candidate.userTextBytes === observed.userTextBytes
      && candidate.finalAgentTextBytes === observed.finalAgentTextBytes) return [];
    return [{
      id: candidate.id,
      nodeUserBytes: candidate.userTextBytes,
      rustUserBytes: observed?.userTextBytes ?? null,
      nodeAgentBytes: candidate.finalAgentTextBytes,
      rustAgentBytes: observed?.finalAgentTextBytes ?? null,
    }];
  });
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
