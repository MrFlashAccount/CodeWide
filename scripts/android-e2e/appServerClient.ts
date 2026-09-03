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

type ServerNotification = {
  sequence: number;
  receivedAtMs: number;
  method: string;
  params: unknown;
};

type AgentDeltaAccumulator = {
  firstReceivedAtMs: number;
  notificationCount: number;
  text: string;
};

type AgentDelta = {
  turnId: string;
  itemId: string;
  delta: string;
};

export type ThreadNotificationMatch = {
  method: string;
  turnId?: string;
  predicate?(params: Record<string, unknown>): boolean;
};

export type ThreadNotificationObservation = {
  sequence: number;
  receivedAtMs: number;
  method: string;
  params: Record<string, unknown>;
  threadId: string;
  turnId: string | null;
};

export type AgentDeltaObservation = {
  firstReceivedAtMs: number;
  matchedAtMs: number;
  notificationCount: number;
  text: string;
  threadId: string;
  turnId: string;
  itemId: string;
};

export type AuthoritativeUserMessageObservation = {
  turnId: string;
  itemId: string;
  clientId: string | null;
  text: string;
};

export type AuthoritativeAttachmentExpectation =
  | { kind: "mention"; name: string; pathBasename?: string }
  | { kind: "localImage" | "localAudio"; pathBasename: string }
  | { kind: "image" | "audio"; url: string };

export type AuthoritativeAttachmentObservation = AuthoritativeUserMessageObservation & {
  attachment: {
    kind: AuthoritativeAttachmentExpectation["kind"];
    name: string | null;
    path: string | null;
    url: string | null;
  };
};

const REQUEST_TIMEOUT_MS = 30_000;

export class AppServerClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notifications: ServerNotification[] = [];
  readonly #notificationHistory: ServerNotification[] = [];
  #nextId = 1;
  #nextNotificationSequence = 1;

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
      useStateDbOnly: true,
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

  async createSubagentFixtureThread(workspace: string, name: string): Promise<string> {
    const result = await this.request("thread/start", {
      cwd: workspace,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      baseInstructions:
        "You are running a bounded real-device subagent test. Follow the user's exact spawn_agent request, wait for that child to complete, and then return only the requested parent token.",
      developerInstructions:
        "Create exactly one child through spawn_agent when requested. Do not create files or make repository changes.",
    });
    const threadId = readThreadId(result);
    await this.request("thread/name/set", { threadId, name });
    return threadId;
  }

  async waitForSingleChildThread(parentThreadId: string, timeoutMs: number): Promise<string> {
    return poll(
      timeoutMs,
      async () => {
        const result = await this.request("thread/list", {
          archived: false,
          cursor: null,
          limit: 100,
          parentThreadId,
          sortKey: "updated_at",
          sortDirection: "desc",
          sourceKinds: [
            "subAgent",
            "subAgentReview",
            "subAgentCompact",
            "subAgentThreadSpawn",
            "subAgentOther",
          ],
          useStateDbOnly: true,
        });
        if (!isRecord(result) || !Array.isArray(result.data)) {
          throw new Error("App Server returned an invalid child thread/list response");
        }
        const childIds = result.data.flatMap((candidate) =>
          isRecord(candidate) && typeof candidate.id === "string" ? [candidate.id] : [],
        );
        if (childIds.length > 1) {
          throw new Error(
            `Bounded subagent fixture created ${childIds.length} children instead of exactly one`,
          );
        }
        return childIds[0] ?? null;
      },
      `single child thread for ${parentThreadId}`,
    );
  }

  async readThread(threadId: string): Promise<unknown> {
    const result = await this.request("thread/read", { threadId, includeTurns: true });
    if (!isRecord(result) || !isRecord(result.thread) || result.thread.id !== threadId) {
      throw new Error(`App Server returned an invalid thread/read response for ${threadId}`);
    }
    return result.thread;
  }

  async subscribeThread(threadId: string): Promise<void> {
    await this.request("thread/resume", { threadId, excludeTurns: true });
  }

  async waitForThreadNotification(
    method: string,
    threadId: string,
    timeoutMs: number,
    predicate: (params: Record<string, unknown>) => boolean = () => true,
  ): Promise<Record<string, unknown>> {
    return poll(
      timeoutMs,
      async () => {
        const index = this.#notifications.findIndex(
          (notification) =>
            notification.method === method &&
            isRecord(notification.params) &&
            notification.params.threadId === threadId &&
            predicate(notification.params),
        );
        if (index < 0) return null;
        const [notification] = this.#notifications.splice(index, 1);
        return notification !== undefined && isRecord(notification.params)
          ? notification.params
          : null;
      },
      `${method} notification for ${threadId}`,
    );
  }

  async waitForThreadNotificationSequence(
    threadId: string,
    expected: readonly ThreadNotificationMatch[],
    timeoutMs: number,
  ): Promise<ThreadNotificationObservation[]> {
    if (expected.length === 0) return [];
    const observed: ThreadNotificationObservation[] = [];
    let searchAfterSequence = 0;
    await poll(
      timeoutMs,
      async () => {
        for (const notification of this.#notificationHistory) {
          if (notification.sequence <= searchAfterSequence || !isRecord(notification.params)) {
            continue;
          }
          searchAfterSequence = notification.sequence;
          const match = expected[observed.length];
          if (match === undefined) return true;
          if (!matchesThreadNotification(notification, threadId, match)) continue;
          observed.push(observeThreadNotification(notification, threadId));
          if (observed.length === expected.length) return true;
        }
        return null;
      },
      `ordered notification sequence for ${threadId}`,
    );
    return observed;
  }

  async waitForAgentDeltaText(
    threadId: string,
    expectedSubstring: string,
    timeoutMs: number,
    turnId?: string,
  ): Promise<AgentDeltaObservation> {
    if (expectedSubstring === "") throw new Error("Expected App Server delta text cannot be empty");
    const accumulated = new Map<string, AgentDeltaAccumulator>();
    return poll(
      timeoutMs,
      async () => {
        for (let index = 0; index < this.#notifications.length;) {
          const notification = this.#notifications[index];
          if (notification === undefined) {
            index += 1;
            continue;
          }
          const delta = readAgentDelta(notification, threadId, turnId);
          if (delta === null) {
            index += 1;
            continue;
          }
          this.#notifications.splice(index, 1);
          const key = `${delta.turnId}\u0000${delta.itemId}`;
          const current = accumulated.get(key);
          const text = `${current?.text ?? ""}${delta.delta}`;
          const next: AgentDeltaAccumulator = {
            firstReceivedAtMs: current?.firstReceivedAtMs ?? notification.receivedAtMs,
            notificationCount: (current?.notificationCount ?? 0) + 1,
            text,
          };
          accumulated.set(key, next);
          if (text.includes(expectedSubstring)) {
            return {
              firstReceivedAtMs: next.firstReceivedAtMs,
              matchedAtMs: notification.receivedAtMs,
              notificationCount: next.notificationCount,
              text,
              threadId,
              turnId: delta.turnId,
              itemId: delta.itemId,
            };
          }
        }
        return null;
      },
      `agent delta text ${expectedSubstring} for ${threadId}`,
    );
  }

  countThreadNotifications(method: string, threadId: string, turnId?: string): number {
    return this.#matchingThreadNotifications(method, threadId, turnId).length;
  }

  async waitForExactThreadNotificationCount(
    method: string,
    threadId: string,
    expectedCount: number,
    timeoutMs: number,
    turnId?: string,
    quietMs = 500,
  ): Promise<ThreadNotificationObservation[]> {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) {
      throw new Error("Expected App Server notification count must be a positive safe integer");
    }
    const readMatches = (): ThreadNotificationObservation[] => {
      const matches = this.#matchingThreadNotifications(method, threadId, turnId);
      if (matches.length > expectedCount) {
        throw new Error(
          `Expected ${expectedCount} ${method} notifications for ${threadId}, found ${matches.length}`,
        );
      }
      return matches.map((notification) => observeThreadNotification(notification, threadId));
    };
    await poll(
      timeoutMs,
      async () => {
        const matches = readMatches();
        return matches.length === expectedCount ? matches : null;
      },
      `${expectedCount} exact ${method} notifications for ${threadId}`,
    );
    if (quietMs > 0) await delay(quietMs);
    const settled = readMatches();
    if (settled.length !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} settled ${method} notifications for ${threadId}, found ${settled.length}`,
      );
    }
    return settled;
  }

  async assertNoThreadNotification(
    method: string,
    threadId: string,
    quietMs: number,
    turnId?: string,
  ): Promise<void> {
    const deadline = Date.now() + quietMs;
    while (Date.now() < deadline) {
      if (this.countThreadNotifications(method, threadId, turnId) > 0) {
        const suffix = turnId === undefined ? "" : ` for turn ${turnId}`;
        throw new Error(`Unexpected ${method} notification for ${threadId}${suffix}`);
      }
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }

  async waitForExactUserMessageSequence(
    threadId: string,
    expectedTexts: readonly string[],
    timeoutMs: number,
    quietMs = 500,
  ): Promise<AuthoritativeUserMessageObservation[]> {
    if (expectedTexts.length === 0) return [];
    await poll(
      timeoutMs,
      async () => {
        const detail = await this.readThread(threadId);
        return exactUserMessageSequence(detail, expectedTexts);
      },
      `exact authoritative user-message sequence for ${threadId}`,
    );
    if (quietMs > 0) await delay(quietMs);
    const settled = exactUserMessageSequence(await this.readThread(threadId), expectedTexts);
    if (settled === null) {
      throw new Error(`Authoritative user-message sequence changed after settling for ${threadId}`);
    }
    return settled;
  }

  async waitForUserInputWithAttachment(
    threadId: string,
    expectedText: string,
    expectedAttachment: AuthoritativeAttachmentExpectation,
    timeoutMs: number,
  ): Promise<AuthoritativeAttachmentObservation> {
    return poll(
      timeoutMs,
      async () => {
        const detail = await this.readThread(threadId);
        return findUserInputWithAttachment(detail, expectedText, expectedAttachment);
      },
      `authoritative user input with ${expectedAttachment.kind} attachment for ${threadId}`,
    );
  }

  clearThreadNotifications(threadId: string): void {
    for (const notifications of [this.#notifications, this.#notificationHistory]) {
      for (let index = notifications.length - 1; index >= 0; index -= 1) {
        const notification = notifications[index];
        if (isRecord(notification?.params) && notification.params.threadId === threadId) {
          notifications.splice(index, 1);
        }
      }
    }
  }

  async waitForThreadNotificationOrder(
    threadId: string,
    first: { method: string; predicate(params: Record<string, unknown>): boolean },
    second: { method: string; predicate(params: Record<string, unknown>): boolean },
    timeoutMs: number,
  ): Promise<void> {
    await this.waitForThreadNotificationSequence(threadId, [first, second], timeoutMs);
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

  async startTurn(
    threadId: string,
    userText: string,
    clientUserMessageId: string,
  ): Promise<string> {
    await this.request("thread/resume", { threadId, excludeTurns: true });
    return this.#submitTurn(threadId, userText, clientUserMessageId);
  }

  async startSubscribedTurn(
    threadId: string,
    userText: string,
    clientUserMessageId: string,
    effort: TurnEffort = "low",
  ): Promise<void> {
    await this.#submitTurn(threadId, userText, clientUserMessageId, effort);
  }

  async startSubscribedTurnWithMention(
    threadId: string,
    userText: string,
    clientUserMessageId: string,
    mention: { name: string; path: string },
    effort: TurnEffort = "low",
  ): Promise<void> {
    const result = await this.request("turn/start", {
      threadId,
      clientUserMessageId,
      input: [
        { type: "text", text: userText, text_elements: [] },
        { type: "mention", name: mention.name, path: mention.path },
      ],
      effort,
    });
    if (!isRecord(result) || !isRecord(result.turn) || typeof result.turn.id !== "string") {
      throw new Error("App Server returned an invalid turn/start response");
    }
  }

  async #submitTurn(
    threadId: string,
    userText: string,
    clientUserMessageId: string,
    effort: TurnEffort = "low",
  ): Promise<string> {
    const result = await this.request("turn/start", {
      threadId,
      clientUserMessageId,
      input: [{ type: "text", text: userText, text_elements: [] }],
      effort,
    });
    if (!isRecord(result) || !isRecord(result.turn) || typeof result.turn.id !== "string") {
      throw new Error("App Server returned an invalid turn/start response");
    }
    return result.turn.id;
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
    if (!isRecord(message)) return;
    if (typeof message.method === "string") {
      const notification: ServerNotification = {
        sequence: this.#nextNotificationSequence,
        receivedAtMs: Date.now(),
        method: message.method,
        params: message.params,
      };
      this.#notifications.push(notification);
      this.#notificationHistory.push(notification);
      this.#nextNotificationSequence += 1;
      if (this.#notifications.length > 2_000) this.#notifications.splice(0, 1_000);
      if (this.#notificationHistory.length > 2_000) this.#notificationHistory.splice(0, 1_000);
      // Server requests carry both a method and an id. They are evidence for
      // approval/input fixture states and must not be mistaken for replies to
      // an unrelated client request that happens to use the same numeric id.
      return;
    }
    if (typeof message.id !== "number") return;
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

  #matchingThreadNotifications(
    method: string,
    threadId: string,
    turnId: string | undefined,
  ): ServerNotification[] {
    return this.#notificationHistory.filter(
      (notification) =>
        notification.method === method &&
        isRecord(notification.params) &&
        notification.params.threadId === threadId &&
        (turnId === undefined || readNotificationTurnId(notification.params) === turnId),
    );
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

function exactUserMessageSequence(
  thread: unknown,
  expectedTexts: readonly string[],
): AuthoritativeUserMessageObservation[] | null {
  const messages = readAuthoritativeUserMessages(thread);
  const expected = new Set(expectedTexts);
  if (expected.size !== expectedTexts.length) {
    throw new Error("Expected authoritative user-message texts must be unique");
  }
  const matches = messages.filter((message) => expected.has(message.text));
  if (matches.length < expectedTexts.length) return null;
  for (const text of expectedTexts) {
    const count = matches.filter((message) => message.text === text).length;
    if (count !== 1) {
      throw new Error(`Expected exactly one authoritative user message ${text}, found ${count}`);
    }
  }
  const positions = expectedTexts.map((text) =>
    matches.findIndex((message) => message.text === text),
  );
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    if (previous === undefined || current === undefined || current <= previous) {
      throw new Error("Authoritative user messages were not persisted in the expected FIFO order");
    }
  }
  return expectedTexts.map((text) => {
    const match = matches.find((message) => message.text === text);
    if (match === undefined) throw new Error("Authoritative user-message match disappeared");
    return match;
  });
}

function readAuthoritativeUserMessages(thread: unknown): AuthoritativeUserMessageObservation[] {
  if (!isRecord(thread) || !Array.isArray(thread.turns)) return [];
  const messages: AuthoritativeUserMessageObservation[] = [];
  for (const turn of thread.turns) {
    if (!isRecord(turn) || typeof turn.id !== "string" || !Array.isArray(turn.items)) continue;
    for (const item of turn.items) {
      if (
        !isRecord(item) ||
        item.type !== "userMessage" ||
        typeof item.id !== "string" ||
        !Array.isArray(item.content)
      ) {
        continue;
      }
      const text = item.content
        .filter(
          (input) => isRecord(input) && input.type === "text" && typeof input.text === "string",
        )
        .map((input) => (isRecord(input) && typeof input.text === "string" ? input.text : ""))
        .join("\n");
      messages.push({
        turnId: turn.id,
        itemId: item.id,
        clientId: typeof item.clientId === "string" ? item.clientId : null,
        text,
      });
    }
  }
  return messages;
}

function findUserInputWithAttachment(
  thread: unknown,
  expectedText: string,
  expectedAttachment: AuthoritativeAttachmentExpectation,
): AuthoritativeAttachmentObservation | null {
  if (!isRecord(thread) || !Array.isArray(thread.turns)) return null;
  for (const turn of thread.turns) {
    if (!isRecord(turn) || typeof turn.id !== "string" || !Array.isArray(turn.items)) continue;
    for (const item of turn.items) {
      if (
        !isRecord(item) ||
        item.type !== "userMessage" ||
        typeof item.id !== "string" ||
        !Array.isArray(item.content)
      ) {
        continue;
      }
      const text = item.content
        .filter(
          (input) => isRecord(input) && input.type === "text" && typeof input.text === "string",
        )
        .map((input) => (isRecord(input) && typeof input.text === "string" ? input.text : ""))
        .join("\n");
      if (text !== expectedText) continue;
      const attachment = item.content.find((input) =>
        matchesAttachmentInput(input, expectedAttachment),
      );
      if (!isRecord(attachment)) continue;
      return {
        turnId: turn.id,
        itemId: item.id,
        clientId: typeof item.clientId === "string" ? item.clientId : null,
        text,
        attachment: {
          kind: expectedAttachment.kind,
          name: typeof attachment.name === "string" ? attachment.name : null,
          path: typeof attachment.path === "string" ? attachment.path : null,
          url: typeof attachment.url === "string" ? attachment.url : null,
        },
      };
    }
  }
  return null;
}

function matchesAttachmentInput(
  input: unknown,
  expected: AuthoritativeAttachmentExpectation,
): boolean {
  if (!isRecord(input) || input.type !== expected.kind) return false;
  if (expected.kind === "mention") {
    if (input.name !== expected.name || typeof input.path !== "string") return false;
    return (
      expected.pathBasename === undefined || pathBasename(input.path) === expected.pathBasename
    );
  }
  if (expected.kind === "localImage" || expected.kind === "localAudio") {
    return typeof input.path === "string" && pathBasename(input.path) === expected.pathBasename;
  }
  if (expected.kind === "image" || expected.kind === "audio") return input.url === expected.url;
  return false;
}

function pathBasename(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function matchesThreadNotification(
  notification: ServerNotification,
  threadId: string,
  expected: ThreadNotificationMatch,
): boolean {
  if (notification.method !== expected.method || !isRecord(notification.params)) return false;
  if (notification.params.threadId !== threadId) return false;
  if (
    expected.turnId !== undefined &&
    readNotificationTurnId(notification.params) !== expected.turnId
  ) {
    return false;
  }
  return expected.predicate?.(notification.params) ?? true;
}

function observeThreadNotification(
  notification: ServerNotification,
  threadId: string,
): ThreadNotificationObservation {
  if (!isRecord(notification.params)) {
    throw new Error("Cannot observe an invalid App Server notification");
  }
  return {
    sequence: notification.sequence,
    receivedAtMs: notification.receivedAtMs,
    method: notification.method,
    params: notification.params,
    threadId,
    turnId: readNotificationTurnId(notification.params),
  };
}

function readNotificationTurnId(params: Record<string, unknown>): string | null {
  if (typeof params.turnId === "string") return params.turnId;
  return isRecord(params.turn) && typeof params.turn.id === "string" ? params.turn.id : null;
}

function readAgentDelta(
  notification: ServerNotification,
  threadId: string,
  turnId: string | undefined,
): AgentDelta | null {
  if (notification.method !== "item/agentMessage/delta" || !isRecord(notification.params)) {
    return null;
  }
  if (notification.params.threadId !== threadId) return null;
  if (
    typeof notification.params.turnId !== "string" ||
    typeof notification.params.itemId !== "string" ||
    typeof notification.params.delta !== "string"
  ) {
    throw new Error(`App Server emitted an invalid agent delta for ${threadId}`);
  }
  if (turnId !== undefined && notification.params.turnId !== turnId) return null;
  return {
    turnId: notification.params.turnId,
    itemId: notification.params.itemId,
    delta: notification.params.delta,
  };
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
