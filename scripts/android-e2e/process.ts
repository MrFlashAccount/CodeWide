import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import net from "node:net";

type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  allowFailure?: boolean;
};

type ProcessOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export class ManagedProcess {
  readonly #child;
  readonly #log;
  #tail = "";

  constructor(command: string, args: string[], options: ProcessOptions) {
    this.#log = createWriteStream(options.logPath, { flags: "a", mode: 0o600 });
    this.#child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (chunk: Buffer) => {
      this.#log.write(chunk);
      this.#tail = (this.#tail + chunk.toString("utf8")).slice(-8_000);
    };
    this.#child.stdout.on("data", capture);
    this.#child.stderr.on("data", capture);
  }

  get exitCode(): number | null {
    return this.#child.exitCode;
  }

  get tail(): string {
    return this.#tail;
  }

  async stop(): Promise<void> {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill("SIGINT");
      await Promise.race([onceExit(this.#child), delay(3_000)]);
    }
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill("SIGTERM");
      await Promise.race([onceExit(this.#child), delay(3_000)]);
    }
    this.#log.end();
  }
}

export function runCommand(command: string, args: string[], options: RunOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const timeout = options.timeoutMs === undefined ? null : setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (timeout !== null) clearTimeout(timeout);
      const exitCode = code ?? 128;
      const result = { stdout, stderr, exitCode };
      if (exitCode === 0 || options.allowFailure === true) {
        resolve(result);
      } else {
        const detail = `${stderr}\n${stdout}`.trim().slice(-8_000);
        reject(new Error(`${command} exited with ${exitCode}${signal === null ? "" : ` (${signal})`}: ${detail}`));
      }
    });
  });
}

export async function findFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a local TCP port");
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  return address.port;
}

export async function waitForTcpPort(port: number, process: ManagedProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Managed process exited before port ${port} opened: ${process.tail}`);
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for TCP port ${port}: ${process.tail}`);
}

export async function waitForHttpStatus(port: number, process: ManagedProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Appium exited during startup: ${process.tail}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Appium: ${process.tail}`);
}

export async function waitForFile(filePath: string, process: ManagedProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Managed process exited before creating ${filePath}: ${process.tail}`);
    try {
      await access(filePath);
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Timed out waiting for ${filePath}: ${process.tail}`);
}

export function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function onceExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}
