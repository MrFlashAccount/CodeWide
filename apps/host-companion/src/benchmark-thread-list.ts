import { readFile } from "node:fs/promises";
import { connect as connectUnix } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { WebSocket } from "ws";

type JsonObject = Record<string, unknown>;
type ThreadListResult = { data: unknown[]; nextCursor: string | null };
type Sample = { layer: string; page: string; elapsedMs: number; count: number; bytes: number; hasNext: boolean };

async function main(): Promise<void> {
  const tokenPath = process.env.CODEWIDE_TOKEN_FILE ?? path.join(homedir(), ".codewide", "host.token");
  const socketPath = process.env.CODEX_APP_SERVER_SOCKET
    ?? path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "app-server-control", "app-server-control.sock");
  const token = (await readFile(tokenPath, "utf8")).trim();

  const directStarted = performance.now();
  const direct = new RpcSocket(new WebSocket("ws://localhost/", {
    perMessageDeflate: false,
    createConnection: () => connectUnix(socketPath),
  }));
  await direct.open();
  await direct.request("initialize", {
    clientInfo: { name: "codewide_benchmark", title: "CodeWide Benchmark", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  direct.notify("initialized", {});
  const directReadyMs = round(performance.now() - directStarted);

  const companionStarted = performance.now();
  const companion = new SyncRpcSocket(new WebSocket("ws://127.0.0.1:8765/v1/sync", {
    headers: { authorization: `Bearer ${token}` },
    perMessageDeflate: false,
  }));
  await companion.open();
  const companionReadyMs = round(performance.now() - companionStarted);

  const samples: Sample[] = [
    ...await measureSnapshot("direct-scan", direct, false),
    ...await measureSnapshot("direct-db-1", direct, true),
    ...await measureSnapshot("companion-db-1", companion, true),
    ...await measureSnapshot("companion-db-2", companion, true),
  ];

  process.stdout.write(`${JSON.stringify({ directReadyMs, companionReadyMs, samples }, null, 2)}\n`);
  direct.close();
  companion.close();
}

async function measureSnapshot(
  layer: string,
  socket: Pick<RpcSocket, "request">,
  useStateDbOnly: boolean,
): Promise<Sample[]> {
  const results: Sample[] = [];
  let activeCursor: string | null = null;
  for (let page = 1; ; page += 1) {
    const sample = await measure(layer, `active-${page}`, socket, activeCursor, false, useStateDbOnly);
    results.push(sample.sample);
    activeCursor = sample.result.nextCursor;
    if (activeCursor === null) break;
  }
  let archivedCursor: string | null = null;
  for (let page = 1; ; page += 1) {
    const sample = await measure(layer, `archived-${page}`, socket, archivedCursor, true, useStateDbOnly);
    results.push(sample.sample);
    archivedCursor = sample.result.nextCursor;
    if (archivedCursor === null) break;
  }
  return results;
}

async function measure(
  layer: string,
  page: string,
  socket: Pick<RpcSocket, "request">,
  cursor: string | null,
  archived: boolean,
  useStateDbOnly: boolean,
): Promise<{ result: ThreadListResult; sample: Sample }> {
  const started = performance.now();
  const raw = await socket.request("thread/list", {
    cursor,
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived,
    useStateDbOnly,
  });
  const elapsedMs = round(performance.now() - started);
  const result = raw as ThreadListResult;
  if (!Array.isArray(result.data) || !(typeof result.nextCursor === "string" || result.nextCursor === null)) {
    throw new Error(`Invalid thread/list response for ${layer}/${page}`);
  }
  return {
    result,
    sample: {
      layer,
      page,
      elapsedMs,
      count: result.data.length,
      bytes: Buffer.byteLength(JSON.stringify(result)),
      hasNext: result.nextCursor !== null,
    },
  };
}

class RpcSocket {
  readonly socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, { resolve(value: unknown): void; reject(cause: Error): void }>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString("utf8")) as JsonObject;
      const response = this.unwrap(message);
      if (response === null || typeof response.id !== "number") return;
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      if (response.error !== undefined) pending.reject(new Error(JSON.stringify(response.error)));
      else pending.resolve(response.result);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    const response = new Promise<unknown>((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    this.sendRequest({ id, method, params });
    return await response;
  }

  notify(method: string, params: unknown): void {
    this.socket.send(JSON.stringify({ method, params }));
  }

  close(): void {
    this.socket.close();
  }

  protected sendRequest(request: JsonObject): void {
    this.socket.send(JSON.stringify(request));
  }

  protected unwrap(message: JsonObject): JsonObject | null {
    return message;
  }
}

class SyncRpcSocket extends RpcSocket {
  override async open(): Promise<void> {
    await super.open();
    const hello = this.waitFor((message) => message.type === "hello");
    const live = this.waitFor((message) => message.type === "status" && message.status === "live");
    this.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    await hello;
    await live;
  }

  protected override sendRequest(request: JsonObject): void {
    this.socket.send(JSON.stringify({ type: "rpc", request }));
  }

  protected override unwrap(message: JsonObject): JsonObject | null {
    if (message.type !== "rpc") return null;
    const response = message.response;
    return response !== null && typeof response === "object" && !Array.isArray(response)
      ? response as JsonObject
      : null;
  }

  private async waitFor(predicate: (message: JsonObject) => boolean): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off("message", onMessage);
        reject(new Error("Companion handshake timed out"));
      }, 30_000);
      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString("utf8")) as JsonObject;
        if (!predicate(message)) return;
        clearTimeout(timeout);
        this.socket.off("message", onMessage);
        resolve();
      };
      this.socket.on("message", onMessage);
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

await main();
