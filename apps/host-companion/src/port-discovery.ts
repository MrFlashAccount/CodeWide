import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISCOVERY_PATH = "/v1/port-forwards/discovery";
const MAX_PORTS = 256;

export type DiscoveredPort = {
  port: number;
  name: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind: "web" | "node" | "python" | "container" | "service";
};

type Listener = { port: number; process: string | null; pid: number | null };

export class PortDiscoveryService {
  readonly #authorize: (authorization: string | undefined) => boolean;
  readonly #excludedPorts: ReadonlySet<number>;

  constructor(authorize: (authorization: string | undefined) => boolean, excludedPorts: readonly number[] = []) {
    this.#authorize = authorize;
    this.#excludedPorts = new Set(excludedPorts);
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== DISCOVERY_PATH) return false;
    if (request.method !== "GET") {
      json(response, 405, { error: "method_not_allowed" }, { allow: "GET" });
      return true;
    }
    if (!this.#authorize(request.headers.authorization)) {
      json(response, 401, { error: "unauthorized" });
      return true;
    }
    const ports = await discoverListeningPorts(this.#excludedPorts);
    json(response, 200, { ports, scannedAt: Date.now() }, { "cache-control": "no-store" });
    return true;
  }
}

export async function discoverListeningPorts(excludedPorts: ReadonlySet<number> = new Set()): Promise<DiscoveredPort[]> {
  let listeners: Listener[];
  try {
    const { stdout } = await execFileAsync("ss", ["-H", "-4", "-ltnp"], {
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    listeners = parseSsListeners(stdout);
  } catch {
    listeners = await readProcListeners();
  }
  const unique = [...new Map(listeners.map((listener) => [listener.port, listener])).values()]
    .filter((listener) => listener.port >= 1_024 && !excludedPorts.has(listener.port))
    .sort((left, right) => left.port - right.port)
    .slice(0, MAX_PORTS);
  return await Promise.all(unique.map(async (listener) => {
    const cwd = listener.pid === null ? null : await readlink(`/proc/${listener.pid}/cwd`).catch(() => null);
    const commandLine = listener.pid === null
      ? null
      : await readFile(`/proc/${listener.pid}/cmdline`, "utf8").then((value) => value.replaceAll("\0", " ")).catch(() => null);
    const kind = inferKind(listener.process, listener.port, commandLine);
    return {
      ...listener,
      cwd,
      kind,
      name: serviceName(listener.process, kind, commandLine),
    };
  }));
}

export function parseSsListeners(output: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 4) continue;
    const endpoint = columns[3] ?? "";
    const portMatch = /:([0-9]{1,5})$/u.exec(endpoint);
    if (portMatch === null) continue;
    const port = Number(portMatch[1]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) continue;
    const processMatch = /users:\(\(\"([^\"]+)\",pid=([0-9]+)/.exec(line);
    listeners.push({
      port,
      process: processMatch?.[1] ?? null,
      pid: processMatch === null ? null : Number(processMatch[2]),
    });
  }
  return listeners;
}

async function readProcListeners(): Promise<Listener[]> {
  const content = await readFile("/proc/net/tcp", "utf8").catch(() => "");
  const listeners: Listener[] = [];
  for (const line of content.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 4 || columns[3] !== "0A") continue;
    const encoded = columns[1]?.split(":")[1];
    if (encoded === undefined) continue;
    const port = Number.parseInt(encoded, 16);
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) listeners.push({ port, process: null, pid: null });
  }
  return listeners;
}

function inferKind(processName: string | null, port: number, commandLine: string | null): DiscoveredPort["kind"] {
  const normalized = `${processName ?? ""} ${commandLine ?? ""}`.toLowerCase();
  if (normalized.includes("docker") || normalized.includes("container")) return "container";
  if (normalized.includes("node") || normalized.includes("bun") || normalized.includes("vite")) return "node";
  if (normalized.includes("python") || normalized.includes("uvicorn") || normalized.includes("gunicorn")) return "python";
  if ([80, 443, 3000, 4173, 4200, 5173, 8000, 8080, 8765].includes(port)) return "web";
  return "service";
}

function serviceName(processName: string | null, kind: DiscoveredPort["kind"], commandLine: string | null): string {
  const normalized = commandLine?.toLowerCase() ?? "";
  if (normalized.includes("storybook")) return "Storybook";
  if (normalized.includes("vite")) return "Vite";
  if (normalized.includes("next")) return "Next.js";
  if (normalized.includes("webpack")) return "Webpack";
  if (normalized.includes("expo start") || normalized.includes("metro")) return "Metro";
  if (normalized.includes("uvicorn")) return "Uvicorn";
  if (normalized.includes("jupyter")) return "Jupyter";
  if (kind === "python") return "Python";
  if (processName?.toLowerCase() === "adb") return "ADB";
  if (processName !== null && processName.trim() !== "") return processName;
  if (kind === "web") return "Web service";
  return "Local service";
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(`${JSON.stringify(body)}\n`);
}
