import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { WebSocket } from "ws";

type JsonObject = Record<string, unknown>;
type ThreadCase = { name: string; threadId: string };
type Endpoint = { name: "node" | "rust"; url: string; pid: number | null };
type Measurement = { elapsedMs: number; bytes: number; count: number };

const execFileAsync = promisify(execFile);
async function main(): Promise<void> {
  const tokenPath = process.env.CODEWIDE_TOKEN_FILE
    ?? path.join(homedir(), ".codewide", "host.token");
  const token = (await readFile(tokenPath, "utf8")).trim();
  const iterations = positiveInteger("CODEX_BENCH_ITERATIONS", 12);
  const concurrency = positiveInteger("CODEX_BENCH_CONCURRENCY", 8);
  const requestsPerClient = positiveInteger("CODEX_BENCH_REQUESTS_PER_CLIENT", 4);
  const threadCases = parseThreadCases(process.env.CODEX_BENCH_THREADS);
  const endpoints: Endpoint[] = [
  {
    name: "node",
    url: process.env.CODEX_NODE_SYNC ?? "ws://127.0.0.1:8765/v1/sync",
    pid: await resolvePid("CODEX_NODE_PID", "codewide-host.service"),
  },
  {
    name: "rust",
    url: process.env.CODEX_RUST_SYNC ?? "ws://127.0.0.1:8766/v1/sync",
    pid: await resolvePid("CODEX_RUST_PID", "codewide-host-rust-shadow.service"),
  },
  ];

  const results: JsonObject[] = [];
  for (const threadCase of threadCases) {
    const endpointResults: JsonObject[] = [];
    for (const endpoint of endpoints) {
      const client = await SyncClient.connect(endpoint.url, token);
      try {
      const turnsParams = {
        threadId: threadCase.threadId,
        cursor: null,
        limit: 12,
        sortDirection: "desc",
        itemsView: "summary",
      };
      const coldTurns = await measure(() => client.rpc("thread/turns/list", turnsParams));
      const warmTurns = [];
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        warmTurns.push(await measure(() => client.rpc("thread/turns/list", turnsParams)));
      }
      const resourcesParams = { threadId: threadCase.threadId };
      const coldResources = await measure(() => client.rpc("companion/threadResources/read", resourcesParams));
      const warmResources = [];
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        warmResources.push(await measure(() => client.rpc("companion/threadResources/read", resourcesParams)));
      }
      endpointResults.push({
        endpoint: endpoint.name,
        cold: {
          turns: coldTurns,
          resources: coldResources,
        },
        warm: {
          turns: summarize(warmTurns),
          resources: summarize(warmResources),
        },
        process: await processSnapshot(endpoint.pid),
      });
      } finally {
        client.close();
      }
    }
    results.push({ name: threadCase.name, threadId: threadCase.threadId, endpoints: endpointResults });
  }

  const load = [];
  for (const endpoint of endpoints) {
    const clients = await Promise.all(
      Array.from({ length: concurrency }, async () => await SyncClient.connect(endpoint.url, token)),
    );
    const before = await processSnapshot(endpoint.pid);
    const startedAt = performance.now();
    let errors = 0;
    try {
    await Promise.all(clients.map(async (client, clientIndex) => {
      for (let requestIndex = 0; requestIndex < requestsPerClient; requestIndex += 1) {
        const threadCase = threadCases[(clientIndex + requestIndex) % threadCases.length];
        if (threadCase === undefined) throw new Error("No benchmark thread case");
        try {
          await client.rpc("thread/turns/list", {
            threadId: threadCase.threadId,
            cursor: null,
            limit: 12,
            sortDirection: "desc",
            itemsView: "summary",
          });
        } catch {
          errors += 1;
        }
      }
    }));
    } finally {
      for (const client of clients) client.close();
    }
    const elapsedMs = performance.now() - startedAt;
    const after = await processSnapshot(endpoint.pid);
    const requests = concurrency * requestsPerClient;
    load.push({
    endpoint: endpoint.name,
    clients: concurrency,
    requests,
    errors,
    elapsedMs: rounded(elapsedMs),
    requestsPerSecond: rounded(requests / (elapsedMs / 1_000)),
    cpuMs: before.cpuMs === null || after.cpuMs === null ? null : rounded(after.cpuMs - before.cpuMs),
    rssKbBefore: before.rssKb,
    rssKbAfter: after.rssKb,
    });
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    applicationCold: "fresh process/cache when endpoints were freshly launched; OS page cache is intentionally not dropped",
    iterations,
    concurrency,
    requestsPerClient,
    results,
    load,
  })}\n`);
}

class SyncClient {
  readonly #socket: WebSocket;
  readonly #inbox: JsonObject[] = [];
  readonly #waiters = new Set<() => void>();
  #requestId = 0;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => {
      this.#inbox.push(JSON.parse(data.toString("utf8")) as JsonObject);
      for (const waiter of this.#waiters) waiter();
    });
  }

  static async connect(url: string, tokenValue: string): Promise<SyncClient> {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${tokenValue}` },
      perMessageDeflate: false,
    });
    const client = new SyncClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    const hello = await client.take((message) => message.type === "hello");
    socket.send(JSON.stringify({ type: "snapshotApplied", cursor: hello.headCursor }));
    await client.take((message) => message.type === "caughtUp");
    return client;
  }

  async rpc(method: string, params: JsonObject): Promise<JsonObject> {
    this.#requestId += 1;
    const id = this.#requestId;
    this.#socket.send(JSON.stringify({ type: "rpc", request: { id, method, params } }));
    const envelope = await this.take((message) => {
      if (message.type !== "rpc") return false;
      return asObject(message.response)?.id === id;
    });
    const response = asObject(envelope.response);
    if (response === null) throw new Error(`${method} returned an invalid response`);
    if (response.error !== undefined) throw new Error(`${method}: ${JSON.stringify(response.error)}`);
    return response;
  }

  close(): void {
    this.#socket.close();
  }

  async take(predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
    const index = this.#inbox.findIndex(predicate);
    if (index >= 0) return this.#inbox.splice(index, 1)[0] as JsonObject;
    return await new Promise<JsonObject>((resolve, reject) => {
      const check = (): void => {
        const candidate = this.#inbox.findIndex(predicate);
        if (candidate < 0) return;
        clearTimeout(timeout);
        this.#waiters.delete(check);
        resolve(this.#inbox.splice(candidate, 1)[0] as JsonObject);
      };
      const timeout = setTimeout(() => {
        this.#waiters.delete(check);
        reject(new Error(`Timed out waiting for ${this.#socket.url}`));
      }, positiveInteger("CODEX_BENCH_TIMEOUT_MS", 180_000));
      this.#waiters.add(check);
    });
  }
}

async function measure(action: () => Promise<JsonObject>): Promise<Measurement> {
  const startedAt = performance.now();
  const response = await action();
  const elapsedMs = performance.now() - startedAt;
  const result = asObject(response.result);
  const data = Array.isArray(result?.data)
    ? result.data
    : [...(Array.isArray(result?.changes) ? result.changes : []), ...(Array.isArray(result?.attachments) ? result.attachments : [])];
  return {
    elapsedMs: rounded(elapsedMs),
    bytes: Buffer.byteLength(JSON.stringify(response)),
    count: data.length,
  };
}

function summarize(measurements: Measurement[]): JsonObject {
  const values = measurements.map((measurement) => measurement.elapsedMs).sort((left, right) => left - right);
  return {
    iterations: measurements.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    minMs: values[0] ?? null,
    maxMs: values.at(-1) ?? null,
    responseBytes: measurements.at(-1)?.bytes ?? 0,
    count: measurements.at(-1)?.count ?? 0,
  };
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index] ?? null;
}

function parseThreadCases(raw: string | undefined): ThreadCase[] {
  if (raw === undefined) {
    throw new Error('CODEX_BENCH_THREADS must be JSON, for example [{"name":"small","threadId":"..."}]');
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("CODEX_BENCH_THREADS must be a non-empty array");
  return parsed.map((value, index) => {
    const candidate = asObject(value);
    if (typeof candidate?.name !== "string" || typeof candidate.threadId !== "string") {
      throw new Error(`Invalid thread case at index ${index}`);
    }
    return { name: candidate.name, threadId: candidate.threadId };
  });
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

async function resolvePid(environmentName: string, unit: string): Promise<number | null> {
  const explicit = Number(process.env[environmentName] ?? 0);
  if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
  try {
    const { stdout } = await execFileAsync("systemctl", ["--user", "show", "--property", "MainPID", "--value", unit]);
    const value = Number(stdout.trim());
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function processSnapshot(pid: number | null): Promise<{ pid: number | null; rssKb: number | null; cpuMs: number | null }> {
  if (pid === null) return { pid: null, rssKb: null, cpuMs: null };
  try {
    const [status, stat, clockTicks] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
      execFileAsync("getconf", ["CLK_TCK"]).then(({ stdout }) => Number(stdout.trim())),
    ]);
    const rssKb = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? Number.NaN);
    const closingParen = stat.lastIndexOf(")");
    const fields = stat.slice(closingParen + 2).split(" ");
    const userTicks = Number(fields[11] ?? Number.NaN);
    const systemTicks = Number(fields[12] ?? Number.NaN);
    return {
      pid,
      rssKb: Number.isFinite(rssKb) ? rssKb : null,
      cpuMs: Number.isFinite(userTicks + systemTicks) && Number.isFinite(clockTicks)
        ? ((userTicks + systemTicks) / clockTicks) * 1_000
        : null,
    };
  } catch {
    return { pid, rssKb: null, cpuMs: null };
  }
}

function rounded(value: number): number {
  return Number(value.toFixed(2));
}

await main();
