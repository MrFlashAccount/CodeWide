import net from "node:net";

import WebSocket from "ws";

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

type ThreadSummary = {
  id: string;
};

type TurnEffort = "high" | "low" | "medium" | "xhigh";

const REQUEST_TIMEOUT_MS = 30_000;

export class AppServerClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => this.#onMessage(data.toString()));
    socket.on("close", () => this.#failPending(new Error("App Server connection closed")));
    socket.on("error", (error) => this.#failPending(error));
  }

  static async connect(socketPath: string): Promise<AppServerClient> {
    const socket = new WebSocket("ws://localhost/", {
      createConnection: () => net.createConnection(socketPath),
      perMessageDeflate: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const client = new AppServerClient(socket);
    await client.request("initialize", {
      clientInfo: {
        name: "codewide_android_e2e",
        title: "CodeWide Android E2E",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    client.notify("initialized");
    return client;
  }

  async listThreads(): Promise<ThreadSummary[]> {
    const result = await this.request("thread/list", {
      cursor: null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
    });
    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new Error("App Server returned an invalid thread/list response");
    }
    const threads: ThreadSummary[] = [];
    for (const candidate of result.data) {
      if (!isRecord(candidate) || typeof candidate.id !== "string") {
        throw new Error("App Server thread/list contained an invalid thread");
      }
      threads.push({ id: candidate.id });
    }
    return threads;
  }

  async createThread(workspace: string, name: string): Promise<string> {
    const result = await this.request("thread/start", {
      cwd: workspace,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      baseInstructions:
        "You are a visual parity test. Reply exactly with the token requested by the user. Do not call tools.",
      developerInstructions: "Return only the requested token and no other text.",
    });
    const threadId = readThreadId(result);
    await this.request("thread/name/set", { threadId, name });
    return threadId;
  }

  async readThread(threadId: string): Promise<unknown> {
    const result = await this.request("thread/read", { threadId, includeTurns: true });
    if (!isRecord(result) || !isRecord(result.thread) || result.thread.id !== threadId) {
      throw new Error(`App Server returned an invalid thread/read response for ${threadId}`);
    }
    return result.thread;
  }

  async findNewThreadWithUserText(
    baselineIds: ReadonlySet<string>,
    expectedText: string,
    timeoutMs: number,
  ): Promise<string> {
    return poll(
      timeoutMs,
      async () => {
        const threads = await this.listThreads();
        for (const thread of threads) {
          if (baselineIds.has(thread.id)) continue;
          const detail = await this.readThread(thread.id);
          if (hasUserText(detail, expectedText)) return thread.id;
        }
        return null;
      },
      `new authoritative thread containing ${expectedText}`,
    );
  }

  async waitForAgentText(threadId: string, expectedText: string, timeoutMs: number): Promise<void> {
    await poll(
      timeoutMs,
      async () => {
        const detail = await this.readThread(threadId);
        return hasCompletedAgentText(detail, expectedText) ? true : null;
      },
      `completed authoritative agent response ${expectedText}`,
    );
  }

  async waitForUserText(threadId: string, expectedText: string, timeoutMs: number): Promise<void> {
    await poll(
      timeoutMs,
      async () => {
        const detail = await this.readThread(threadId);
        return hasUserText(detail, expectedText) ? true : null;
      },
      `authoritative user message ${expectedText}`,
    );
  }

  async unarchiveThreadIfNeeded(threadId: string): Promise<void> {
    const result = await this.request("thread/list", {
      archived: true,
      cursor: null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      useStateDbOnly: true,
    });
    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new Error("App Server returned an invalid archived thread/list response");
    }
    if (!result.data.some((candidate) => isRecord(candidate) && candidate.id === threadId)) return;
    await this.request("thread/unarchive", { threadId });
    await poll(
      REQUEST_TIMEOUT_MS,
      async () => {
        const active = await this.request("thread/list", {
          archived: false,
          cursor: null,
          limit: 100,
          sortKey: "updated_at",
          sortDirection: "desc",
          useStateDbOnly: true,
        });
        if (!isRecord(active) || !Array.isArray(active.data)) return null;
        return active.data.some((candidate) => isRecord(candidate) && candidate.id === threadId)
          ? true
          : null;
      },
      `unarchived thread ${threadId} in active catalog`,
    );
  }

  async startTurn(threadId: string, userText: string, clientUserMessageId: string): Promise<void> {
    await this.request("thread/resume", { threadId, excludeTurns: true });
    await this.#submitTurn(threadId, userText, clientUserMessageId);
  }

  async startSubscribedTurn(
    threadId: string,
    userText: string,
    clientUserMessageId: string,
    effort: TurnEffort = "low",
  ): Promise<void> {
    await this.#submitTurn(threadId, userText, clientUserMessageId, effort);
  }

  async #submitTurn(
    threadId: string,
    userText: string,
    clientUserMessageId: string,
    effort: TurnEffort = "low",
  ): Promise<void> {
    await this.request("turn/start", {
      threadId,
      clientUserMessageId,
      input: [{ type: "text", text: userText, text_elements: [] }],
      effort,
    });
  }

  close(): void {
    this.#socket.close(1000);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`App Server request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#socket.send(
        JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }),
      );
    });
  }

  notify(method: string, params?: unknown): void {
    this.#socket.send(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }));
  }

  #onMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.#failPending(new Error("App Server emitted invalid JSON"));
      return;
    }
    if (!isRecord(message) || typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(message.id);
    if (isRecord(message.error)) {
      const detail =
        typeof message.error.message === "string" ? message.error.message : "unknown RPC error";
      pending.reject(new Error(`App Server RPC failed: ${detail}`));
    } else {
      pending.resolve(message.result);
    }
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function hasUserText(thread: unknown, expectedText: string): boolean {
  if (!isRecord(thread) || !Array.isArray(thread.turns)) return false;
  return thread.turns.some((turn) => {
    if (!isRecord(turn) || !Array.isArray(turn.items)) return false;
    return turn.items.some((item) => {
      if (!isRecord(item) || item.type !== "userMessage" || !Array.isArray(item.content))
        return false;
      return item.content.some(
        (input) => isRecord(input) && input.type === "text" && input.text === expectedText,
      );
    });
  });
}

function hasCompletedAgentText(thread: unknown, expectedText: string): boolean {
  if (!isRecord(thread) || !Array.isArray(thread.turns)) return false;
  return thread.turns.some((turn) => {
    if (!isRecord(turn) || turn.status !== "completed" || !Array.isArray(turn.items)) return false;
    return turn.items.some(
      (item) =>
        isRecord(item) &&
        item.type === "agentMessage" &&
        typeof item.text === "string" &&
        item.text.includes(expectedText),
    );
  });
}

async function poll<T>(
  timeoutMs: number,
  read: () => Promise<T | null>,
  description: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await delay(500);
  }
  const suffix = lastError === null ? "" : `: ${lastError.message}`;
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readThreadId(result: unknown): string {
  if (!isRecord(result) || !isRecord(result.thread) || typeof result.thread.id !== "string") {
    throw new Error("App Server returned an invalid thread/start response");
  }
  return result.thread.id;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
