import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { Personality } from "@codewide/codex-protocol/v0.147.0";

import { RpcResponseError } from "./session";
import { threadContainsClientMessage } from "./thread-events";

export const MAX_TURN_TEXT_CHARS = 900_000;
export const MAX_TURN_ATTACHMENTS = 128;
export const MAX_TURN_SKILLS = 128;
export const MAX_OUTBOX_COMMANDS_PER_CONNECTION = 1_000;
export const MAX_OUTBOX_BYTES_PER_CONNECTION = 16 * 1024 * 1024;

export type OutboxState = "queued" | "pending" | "uncertain" | "failed";

export type OutboxCommand = {
  connectionId: string;
  commandId: string;
  remoteThreadId: string;
  method: "turn/start" | "turn/steer";
  params: Record<string, unknown>;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

export interface OutboxStore {
  putOutbox(command: OutboxCommand): Promise<void>;
  listOutbox(connectionId: string): Promise<OutboxCommand[]>;
  updateOutbox(commandId: string, connectionId: string, patch: Pick<OutboxCommand, "state" | "attempts" | "updatedAt" | "lastError">): Promise<void>;
  deleteOutbox(commandId: string, connectionId: string): Promise<void>;
  getThread(connectionId: string, remoteThreadId: string): Promise<Thread | null>;
  saveThread(connectionId: string, thread: Thread): Promise<void>;
}

export interface RpcClient {
  readonly connectionId?: string;
  rpc<T>(method: string, params: unknown): Promise<T>;
  waitUntilLive?(timeoutMs?: number): Promise<void>;
}

export type OutboxTurnOptions = {
  model?: string | null;
  effort?: string | null;
  personality?: Personality | null;
  permissions?: string | null;
  skills?: Array<{ name: string; path: string }>;
  attachments?: RemoteFileAttachment[];
};

export type RemoteFileAttachment = {
  id: string;
  rootId: string;
  path: string;
  name: string;
  kind: "image" | "audio" | "file";
};

export type OutboxFlushOptions = {
  /**
   * Queue commands are normally dispatched by the always-on companion.
   * A client may disable local dispatch after it has mirrored the queue to
   * avoid two independent owners racing the same turn/start.
   */
  dispatchQueued?: boolean;
};

export class DurableOutbox {
  readonly #store: OutboxStore;
  readonly #id: () => string;
  readonly #running = new Map<string, Promise<void>>();

  constructor(store: OutboxStore, idFactory: () => string = defaultCommandId) {
    this.#store = store;
    this.#id = idFactory;
  }

  async enqueueText(
    connectionId: string,
    remoteThreadId: string,
    text: string,
    mode: { type: "start" } | { type: "queue" } | { type: "steer"; expectedTurnId: string } = { type: "start" },
    options: OutboxTurnOptions = {},
  ): Promise<OutboxCommand> {
    if ((await this.#store.listOutbox(connectionId)).length >= MAX_OUTBOX_COMMANDS_PER_CONNECTION) {
      throw new Error(`Outbox capacity exceeded for connection (${MAX_OUTBOX_COMMANDS_PER_CONNECTION})`);
    }
    const command = createTextOutboxCommand(
      connectionId,
      remoteThreadId,
      text,
      mode,
      options,
      this.#id(),
    );
    await this.#store.putOutbox(command);
    return command;
  }

  flush(connectionId: string, client: RpcClient, options: OutboxFlushOptions = {}): Promise<void> {
    const previous = this.#running.get(connectionId);
    const running = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#drain(connectionId, client, options.dispatchQueued ?? true))
      .finally(() => {
        if (this.#running.get(connectionId) === running) this.#running.delete(connectionId);
      });
    this.#running.set(connectionId, running);
    return running;
  }

  async #drain(connectionId: string, client: RpcClient, dispatchQueued: boolean): Promise<void> {
    const commands = await this.#store.listOutbox(connectionId);
    for (const command of commands) {
      if (command.state === "failed") continue;
      if (command.state === "queued") {
        // Preserve FIFO. Once the companion owns this queue, later local
        // commands must not jump ahead of its head command.
        if (!dispatchQueued) break;
        const latest = await this.#readLatestThread(command, client);
        // A cached idle status is not sufficient evidence that a queued turn
        // may start: the server may already be running a newer turn.
        if (!latest.authoritative || latest.thread === null || latest.thread.status.type === "active") break;
        await this.#store.updateOutbox(command.commandId, connectionId, {
          state: "pending",
          attempts: command.attempts,
          updatedAt: Date.now(),
          lastError: null,
        });
      }
      if (command.state === "uncertain") {
        const reconciliation = await this.#reconcile(command, client);
        if (reconciliation === "delivered") continue;
        if (reconciliation === "wait") break;
      }
      const attempt = command.attempts + 1;
      await this.#store.updateOutbox(command.commandId, connectionId, {
        state: "uncertain",
        attempts: attempt,
        updatedAt: Date.now(),
        lastError: null,
      });
      try {
        await client.rpc(command.method, command.params);
        await this.#store.deleteOutbox(command.commandId, connectionId);
      } catch (cause) {
        const definite = cause instanceof RpcResponseError;
        await this.#store.updateOutbox(command.commandId, connectionId, {
          state: definite ? "failed" : "uncertain",
          attempts: attempt,
          updatedAt: Date.now(),
          lastError: cause instanceof Error ? cause.message.slice(0, 500) : "Delivery failed",
        });
        // Preserve FIFO: a connection failure makes following commands unsafe to deliver out of order.
        if (!definite) break;
      }
    }
  }

  async #reconcile(command: OutboxCommand, client: RpcClient): Promise<"delivered" | "retry" | "wait"> {
    const latest = await this.#readLatestThread(command, client);
    if (!latest.authoritative || latest.thread === null) return "wait";
    const thread = latest.thread;
    if (threadContainsClientMessage(thread, command.commandId)) {
      await this.#store.deleteOutbox(command.commandId, command.connectionId);
      return "delivered";
    }
    // While the target thread is active, persistence may still be catching up. Never duplicate it.
    return thread.status.type === "active" ? "wait" : "retry";
  }

  async #readLatestThread(command: OutboxCommand, client: RpcClient): Promise<{ thread: Thread | null; authoritative: boolean }> {
    let thread = await this.#store.getThread(command.connectionId, command.remoteThreadId);
    try {
      const response = await client.rpc<{ thread: Thread }>("thread/read", {
        threadId: command.remoteThreadId,
        includeTurns: true,
      });
      thread = response.thread;
      await this.#store.saveThread(command.connectionId, thread);
    } catch {
      return { thread, authoritative: false };
    }
    return { thread, authoritative: true };
  }
}

export function createTextOutboxCommand(
  connectionId: string,
  remoteThreadId: string,
  text: string,
  mode: { type: "start" } | { type: "queue" } | { type: "steer"; expectedTurnId: string } = { type: "start" },
  options: OutboxTurnOptions = {},
  commandId: string = defaultCommandId(),
  now: number = Date.now(),
): OutboxCommand {
  if (text.length > MAX_TURN_TEXT_CHARS) throw new Error(`Turn text exceeds ${MAX_TURN_TEXT_CHARS} characters`);
  if ((options.attachments?.length ?? 0) > MAX_TURN_ATTACHMENTS) throw new Error(`Turn has more than ${MAX_TURN_ATTACHMENTS} attachments`);
  if ((options.skills?.length ?? 0) > MAX_TURN_SKILLS) throw new Error(`Turn has more than ${MAX_TURN_SKILLS} skills`);
  if (text.length === 0 && (options.attachments?.length ?? 0) === 0) throw new Error("Turn input is empty");
  return {
    connectionId,
    commandId,
    remoteThreadId,
    method: mode.type === "steer" ? "turn/steer" : "turn/start",
    params: {
      threadId: remoteThreadId,
      clientUserMessageId: commandId,
      input: [
        ...(text.length === 0 ? [] : [{ type: "text", text, text_elements: [] }]),
        ...(options.attachments ?? []).map((attachment) => ({
          type: "remoteFile",
          rootId: attachment.rootId,
          path: attachment.path,
          name: attachment.name,
          kind: attachment.kind,
        })),
        ...(options.skills ?? []).map((skill) => ({ type: "skill", name: skill.name, path: skill.path })),
      ],
      ...(mode.type === "steer" || options.model === undefined ? {} : { model: options.model }),
      ...(mode.type === "steer" || options.effort === undefined ? {} : { effort: options.effort }),
      ...(mode.type === "steer" || options.personality === undefined ? {} : { personality: options.personality }),
      ...(mode.type === "steer" || options.permissions === undefined ? {} : { permissions: options.permissions }),
      ...(mode.type === "steer" ? { expectedTurnId: mode.expectedTurnId } : {}),
    },
    state: mode.type === "queue" ? "queued" : "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
}

function defaultCommandId(): string {
  const random = Math.random().toString(36).slice(2);
  return `remote-${Date.now().toString(36)}-${random}`;
}
