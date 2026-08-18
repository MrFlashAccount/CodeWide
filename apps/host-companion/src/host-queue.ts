import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type HostQueuedCommand = {
  commandId: string;
  remoteThreadId: string;
  method: "turn/start";
  params: Record<string, unknown>;
  state: "queued" | "uncertain" | "failed" | "delivered";
  order: number;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

type QueueFile = { version: 1; commands: HostQueuedCommand[] };

const MAX_COMMAND_BYTES = 1024 * 1024;
const MAX_COMMANDS = 1_000;
const MAX_QUEUE_BYTES = 48 * 1024 * 1024;
const DELIVERY_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class HostQueueStore {
  readonly #filePath: string | undefined;
  readonly #commands = new Map<string, HostQueuedCommand>();
  #writeChain = Promise.resolve();

  private constructor(filePath?: string) {
    this.#filePath = filePath;
  }

  static async open(filePath?: string): Promise<HostQueueStore> {
    const store = new HostQueueStore(filePath);
    if (filePath === undefined) return store;
    const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) return store;
    const parsed = JSON.parse(raw) as unknown;
    if (!isQueueFile(parsed)) throw new Error("Invalid host queue store");
    if (parsed.commands.reduce((total, command) => total + commandBytes(command.params), 0) > MAX_QUEUE_BYTES) {
      throw new Error("Host queue byte capacity exceeded");
    }
    for (const command of parsed.commands) {
      // A missing response after turn/start is ambiguous. Preserve uncertain
      // state so dispatch reconciliation checks clientUserMessageId first.
      store.#commands.set(command.commandId, structuredClone(command));
    }
    store.#purgeDeliveryReceipts();
    return store;
  }

  async put(input: { commandId: string; remoteThreadId: string; method: string; params: Record<string, unknown>; createdAt?: number }): Promise<HostQueuedCommand> {
    this.#purgeDeliveryReceipts();
    const commandId = requiredId(input.commandId, "commandId");
    const remoteThreadId = requiredId(input.remoteThreadId, "remoteThreadId");
    if (input.method !== "turn/start") throw new Error("Only turn/start can be queued");
    validateParams(commandId, remoteThreadId, input.params);
    const existing = this.#commands.get(commandId);
    if (existing !== undefined) {
      if (stableJson(existing.params) !== stableJson(input.params) || existing.remoteThreadId !== remoteThreadId) {
        throw new Error("Queue command id already exists with a different payload");
      }
      return structuredClone(existing);
    }
    const receiptsToPurge = this.#capacityPlan(commandBytes(input.params), 1);
    for (const receiptId of receiptsToPurge) this.#commands.delete(receiptId);
    const now = Date.now();
    const command: HostQueuedCommand = {
      commandId,
      remoteThreadId,
      method: "turn/start",
      params: structuredClone(input.params),
      state: "queued",
      order: Math.max(0, ...[...this.#commands.values()].map((candidate) => candidate.order)) + 1,
      createdAt: Number.isSafeInteger(input.createdAt) ? input.createdAt as number : now,
      updatedAt: now,
      lastError: null,
    };
    this.#commands.set(commandId, command);
    await this.#persist();
    return structuredClone(command);
  }

  list(remoteThreadId?: string): HostQueuedCommand[] {
    return [...this.#commands.values()]
      .filter((command) => remoteThreadId === undefined || command.remoteThreadId === remoteThreadId)
      .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt)
      .map((command) => structuredClone(command));
  }

  readyHeads(): HostQueuedCommand[] {
    const heads = new Map<string, HostQueuedCommand>();
    for (const command of this.list()) {
      if (command.state === "failed" || command.state === "delivered" || heads.has(command.remoteThreadId)) continue;
      heads.set(command.remoteThreadId, command);
    }
    return [...heads.values()];
  }

  async editText(commandId: string, text: string): Promise<HostQueuedCommand> {
    const command = this.#editable(commandId);
    const normalized = text.trim();
    if (normalized.length < 1 || normalized.length > 1_000_000) throw new Error("Queued text must be 1-1000000 characters");
    const input = Array.isArray(command.params.input) ? structuredClone(command.params.input) as Array<Record<string, unknown>> : [];
    const textIndex = input.findIndex((item) => item.type === "text");
    if (textIndex < 0) throw new Error("Queued command has no text input");
    input[textIndex] = {
      ...input[textIndex],
      text: normalized,
      text_elements: Array.isArray(input[textIndex]?.text_elements) ? input[textIndex]?.text_elements : [],
    };
    const nextParams = { ...command.params, input };
    validateParams(command.commandId, command.remoteThreadId, nextParams);
    const receiptsToPurge = this.#capacityPlan(commandBytes(nextParams) - commandBytes(command.params), 0);
    for (const receiptId of receiptsToPurge) this.#commands.delete(receiptId);
    command.params = nextParams;
    command.updatedAt = Date.now();
    await this.#persist();
    return structuredClone(command);
  }

  async cancel(commandId: string): Promise<boolean> {
    const command = this.#commands.get(commandId);
    if (command === undefined || (command.state !== "queued" && command.state !== "failed")) return false;
    this.#commands.delete(commandId);
    await this.#persist();
    return true;
  }

  async move(commandId: string, direction: -1 | 1): Promise<boolean> {
    const command = this.#editable(commandId);
    const sameThread = this.list(command.remoteThreadId).filter((candidate) => candidate.state === "queued");
    const index = sameThread.findIndex((candidate) => candidate.commandId === commandId);
    const neighbor = sameThread[index + direction];
    if (index < 0 || neighbor === undefined) return false;
    const neighborStored = this.#commands.get(neighbor.commandId);
    if (neighborStored === undefined) return false;
    [command.order, neighborStored.order] = [neighborStored.order, command.order];
    command.updatedAt = Date.now();
    neighborStored.updatedAt = command.updatedAt;
    await this.#persist();
    return true;
  }

  /** Places a queued command before another command in the same thread.
   * Unlike a relative direction, this operation is idempotent after an
   * ambiguous network response and is therefore safe for a durable client.
   */
  async place(commandId: string, beforeCommandId: string | null): Promise<boolean> {
    const command = this.#editable(commandId);
    const sameThread = this.list(command.remoteThreadId).filter((candidate) => candidate.state === "queued");
    const withoutCurrent = sameThread.filter((candidate) => candidate.commandId !== commandId);
    const insertAt = beforeCommandId === null
      ? withoutCurrent.length
      : withoutCurrent.findIndex((candidate) => candidate.commandId === beforeCommandId);
    if (insertAt < 0) throw new Error("Queued placement target does not exist");
    withoutCurrent.splice(insertAt, 0, command);
    const orderSlots = sameThread.map((candidate) => candidate.order).sort((left, right) => left - right);
    let changed = false;
    withoutCurrent.forEach((candidate, index) => {
      const stored = this.#commands.get(candidate.commandId);
      const order = orderSlots[index];
      if (stored === undefined || order === undefined || stored.order === order) return;
      stored.order = order;
      stored.updatedAt = Date.now();
      changed = true;
    });
    if (changed) await this.#persist();
    return changed;
  }

  async markUncertain(commandId: string): Promise<void> {
    const command = this.#commands.get(commandId);
    if (command === undefined || command.state === "failed") return;
    command.state = "uncertain";
    command.updatedAt = Date.now();
    command.lastError = null;
    await this.#persist();
  }

  async markQueued(commandId: string, lastError: string | null = null): Promise<void> {
    const command = this.#commands.get(commandId);
    if (command === undefined || command.state === "failed") return;
    command.state = "queued";
    command.updatedAt = Date.now();
    command.lastError = lastError?.slice(0, 500) ?? null;
    await this.#persist();
  }

  async markFailed(commandId: string, error: string): Promise<void> {
    const command = this.#commands.get(commandId);
    if (command === undefined) return;
    command.state = "failed";
    command.updatedAt = Date.now();
    command.lastError = error.slice(0, 500);
    await this.#persist();
  }

  async markDelivered(commandId: string): Promise<void> {
    const command = this.#commands.get(commandId);
    if (command === undefined) return;
    command.state = "delivered";
    command.updatedAt = Date.now();
    command.lastError = null;
    await this.#persist();
  }

  async remove(commandId: string): Promise<void> {
    if (!this.#commands.delete(commandId)) return;
    await this.#persist();
  }

  async close(): Promise<void> {
    await this.#writeChain;
  }

  #purgeDeliveryReceipts(): void {
    const cutoff = Date.now() - DELIVERY_RECEIPT_TTL_MS;
    for (const [commandId, command] of this.#commands) {
      if (command.state === "delivered" && command.updatedAt < cutoff) this.#commands.delete(commandId);
    }
  }

  #editable(commandId: string): HostQueuedCommand {
    const command = this.#commands.get(commandId);
    if (command === undefined || command.state !== "queued") throw new Error("Queued command is already dispatching or no longer exists");
    return command;
  }

  #capacityPlan(additionalBytes: number, additionalCommands: number): string[] {
    let projectedCommands = this.#commands.size + additionalCommands;
    let projectedBytes = [...this.#commands.values()].reduce((total, command) => total + commandBytes(command.params), 0) + additionalBytes;
    const purge: string[] = [];
    const receipts = [...this.#commands.values()]
      .filter((command) => command.state === "delivered")
      .sort((left, right) => left.updatedAt - right.updatedAt);
    for (const receipt of receipts) {
      if (projectedCommands <= MAX_COMMANDS && projectedBytes <= MAX_QUEUE_BYTES) break;
      purge.push(receipt.commandId);
      projectedCommands -= 1;
      projectedBytes -= commandBytes(receipt.params);
    }
    if (projectedCommands > MAX_COMMANDS) throw new Error("Host queue capacity exceeded");
    if (projectedBytes > MAX_QUEUE_BYTES) throw new Error("Host queue byte capacity exceeded");
    return purge;
  }

  async #persist(): Promise<void> {
    if (this.#filePath === undefined) return;
    const snapshot: QueueFile = { version: 1, commands: this.list() };
    const filePath = this.#filePath;
    const temporary = `${filePath}.tmp`;
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
      await rename(temporary, filePath);
      await chmod(filePath, 0o600);
    });
    await this.#writeChain;
  }
}

function validateParams(commandId: string, threadId: string, params: Record<string, unknown>): void {
  if (params.threadId !== threadId) throw new Error("Queued thread id does not match params");
  if (params.clientUserMessageId !== commandId) throw new Error("Queued client message id does not match command id");
  if (!Array.isArray(params.input) || params.input.length < 1) throw new Error("Queued input is required");
  if (Buffer.byteLength(JSON.stringify(params)) > MAX_COMMAND_BYTES) throw new Error("Queued command is too large");
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512 || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function commandBytes(params: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(params));
}

function isQueueFile(value: unknown): value is QueueFile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<QueueFile>;
  return candidate.version === 1 && Array.isArray(candidate.commands) && candidate.commands.length <= MAX_COMMANDS && candidate.commands.every(isCommand);
}

function isCommand(value: unknown): value is HostQueuedCommand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<HostQueuedCommand>;
  try {
    if (typeof candidate.commandId !== "string" || typeof candidate.remoteThreadId !== "string" || candidate.method !== "turn/start") return false;
    if (candidate.params === null || typeof candidate.params !== "object" || Array.isArray(candidate.params)) return false;
    validateParams(candidate.commandId, candidate.remoteThreadId, candidate.params as Record<string, unknown>);
    return (candidate.state === "queued" || candidate.state === "uncertain" || candidate.state === "failed" || candidate.state === "delivered") && Number.isSafeInteger(candidate.order) && Number.isSafeInteger(candidate.createdAt) && Number.isSafeInteger(candidate.updatedAt) && (candidate.lastError === null || typeof candidate.lastError === "string");
  } catch {
    return false;
  }
}
