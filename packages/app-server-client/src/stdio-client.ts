import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import {
  AppServerRpcError,
  type AppServerMessage,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "./json-rpc.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

export type StdioAppServerOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  maxFrameBytes?: number;
};

export type AppServerEvent =
  | { kind: "notification"; message: JsonRpcNotification }
  | { kind: "request"; message: JsonRpcRequest };

export class StdioAppServerClient {
  readonly #options: {
    command: string;
    args: string[];
    cwd: string | undefined;
    env: NodeJS.ProcessEnv | undefined;
    requestTimeoutMs: number;
    maxFrameBytes: number;
  };
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  readonly #listeners = new Set<(event: AppServerEvent) => void>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  #closed = false;
  #stderrTail = "";

  constructor(options: StdioAppServerOptions = {}) {
    this.#options = {
      command: options.command ?? "codex",
      args: options.args ?? ["app-server", "--stdio"],
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
      cwd: options.cwd,
      env: options.env,
    };
  }

  get stderrTail(): string {
    return this.#stderrTail;
  }

  get isRunning(): boolean {
    return this.#child !== null && !this.#closed;
  }

  start(): void {
    if (this.#child !== null) {
      throw new Error("App Server client has already been started");
    }
    this.#closed = false;
    const child = spawn(this.#options.command, this.#options.args, {
      cwd: this.#options.cwd,
      env: this.#options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    child.once("error", (error) => this.#failAll(error));
    child.once("exit", (code, signal) => {
      this.#closed = true;
      this.#failAll(
        new Error(
          `App Server exited before the connection closed (code=${String(code)}, signal=${String(signal)})${
            this.#stderrTail ? `: ${this.#stderrTail}` : ""
          }`,
        ),
      );
    });
  }

  subscribe(listener: (event: AppServerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.#write({ method, ...(params === undefined ? {} : { params }) });
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.isRunning) {
      throw new Error("App Server client is not running");
    }
    const id = this.#nextId++;
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`App Server request timed out: ${method}`));
      }, this.#options.requestTimeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });
    await this.#write({ id, method, ...(params === undefined ? {} : { params }) });
    return response;
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    await this.#write({ id, result });
  }

  async respondError(id: JsonRpcId, error: JsonRpcError): Promise<void> {
    await this.#write({ id, error });
  }

  async close(): Promise<void> {
    const child = this.#child;
    if (child === null || this.#closed) {
      return;
    }
    this.#closed = true;
    child.stdin.end();
    await Promise.race([
      once(child, "exit"),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    this.#failAll(new Error("App Server client closed"));
  }

  async #write(message: AppServerMessage): Promise<void> {
    const child = this.#child;
    if (child === null || this.#closed) {
      throw new Error("App Server client is closed");
    }
    const frame = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(frame) > this.#options.maxFrameBytes) {
      throw new Error("Outgoing App Server frame exceeds configured maximum");
    }
    if (!child.stdin.write(frame, "utf8")) {
      await once(child.stdin, "drain");
    }
  }

  #handleLine(line: string): void {
    if (Buffer.byteLength(line) > this.#options.maxFrameBytes) {
      this.#failAll(new Error("Incoming App Server frame exceeds configured maximum"));
      void this.close();
      return;
    }
    let message: AppServerMessage;
    try {
      message = JSON.parse(line) as AppServerMessage;
    } catch (error) {
      this.#failAll(new Error(`Invalid JSON from App Server: ${String(error)}`));
      void this.close();
      return;
    }
    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      clearTimeout(pending.timeout);
      this.#pending.delete(message.id);
      if ("error" in message) {
        pending.reject(new AppServerRpcError(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    const event: AppServerEvent =
      "id" in message
        ? { kind: "request", message }
        : { kind: "notification", message };
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
