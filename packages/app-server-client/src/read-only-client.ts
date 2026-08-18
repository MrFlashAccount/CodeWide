import type { InitializeResponse } from "@codewide/codex-protocol/v0.147.0";
import type {
  Thread,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";

import { StdioAppServerClient, type StdioAppServerOptions } from "./stdio-client.js";

const READ_ONLY_METHODS = new Set([
  "initialize",
  "thread/list",
  "thread/read",
  "thread/turns/list",
]);

export type AppServerSnapshot = {
  initialize: InitializeResponse;
  threads: Thread[];
};

export class ReadOnlyAppServerClient {
  readonly #client: StdioAppServerClient;
  #initializeResponse: InitializeResponse | null = null;

  constructor(options: StdioAppServerOptions = {}) {
    this.#client = new StdioAppServerClient(options);
  }

  get initializeResponse(): InitializeResponse {
    if (this.#initializeResponse === null) {
      throw new Error("Read-only App Server client is not initialized");
    }
    return this.#initializeResponse;
  }

  async connect(): Promise<InitializeResponse> {
    this.#client.start();
    this.#initializeResponse = await this.#request<InitializeResponse>("initialize", {
      clientInfo: {
        name: "codewide_fixture_exporter",
        title: "CodeWide Fixture Exporter",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    await this.#client.notify("initialized");
    return this.#initializeResponse;
  }

  async listThreadsPage(params: ThreadListParams): Promise<ThreadListResponse> {
    return this.#request("thread/list", params);
  }

  async listThreads(maxThreads: number): Promise<Thread[]> {
    const threads: Thread[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.listThreadsPage({
        cursor,
        limit: Math.min(100, maxThreads - threads.length),
        sortKey: "updated_at",
        sortDirection: "desc",
      });
      threads.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== null && threads.length < maxThreads);
    return threads.slice(0, maxThreads);
  }

  async readThread(threadId: string): Promise<Thread> {
    const response = await this.#request<ThreadReadResponse>("thread/read", {
      threadId,
      includeTurns: true,
    });
    return response.thread;
  }

  close(): Promise<void> {
    return this.#client.close();
  }

  #request<T>(method: string, params?: unknown): Promise<T> {
    if (!READ_ONLY_METHODS.has(method)) {
      throw new Error(`Fixture exporter denied mutating App Server method: ${method}`);
    }
    return this.#client.request<T>(method, params);
  }
}
