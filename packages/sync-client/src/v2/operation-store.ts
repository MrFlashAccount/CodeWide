import { fingerprintV2Command, type V2SavedServerId } from "./canonical";
import type { V2Command, V2OperationState, V2PersistedOperation } from "./operations";

export const V2_OPERATION_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export type V2OperationUpdate = Partial<Pick<V2PersistedOperation, "state" | "acceptedAt">>;

/** Minimal operation state is partitioned by the stable saved-server record id. */
export interface V2OperationStore {
  create(savedServerId: V2SavedServerId, operationId: string, command: V2Command, nowMs?: number): Promise<V2PersistedOperation>;
  get(savedServerId: V2SavedServerId, operationId: string): Promise<V2PersistedOperation | null>;
  transition(savedServerId: V2SavedServerId, operationId: string, expected: readonly V2OperationState[], update: V2OperationUpdate, nowMs?: number): Promise<V2PersistedOperation>;
  recoverable(savedServerId: V2SavedServerId, nowMs?: number): Promise<V2PersistedOperation[]>;
  prune(savedServerId: V2SavedServerId, nowMs?: number): Promise<void>;
  hasSavedServerData(savedServerId: V2SavedServerId): Promise<boolean>;
  deleteSavedServer(savedServerId: V2SavedServerId): Promise<void>;
}

export class MemoryV2OperationStore implements V2OperationStore {
  readonly #operations = new Map<string, Map<string, V2PersistedOperation>>();

  async create(savedServerId: V2SavedServerId, operationId: string, command: V2Command, nowMs = Date.now()): Promise<V2PersistedOperation> {
    await this.prune(savedServerId, nowMs);
    const operations = this.#partition(savedServerId);
    const fingerprint = fingerprintV2Command(command);
    const existing = operations.get(operationId);
    if (existing !== undefined) {
      if (existing.commandFingerprint !== fingerprint) throw new Error("Sync V2 operation id is already bound to a different canonical command");
      return clone(existing);
    }
    const operation: V2PersistedOperation = {
      operationId,
      command: clone(command),
      commandKind: command.kind,
      commandFingerprint: fingerprint,
      state: "created",
      terminalClass: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      acceptedAt: null,
    };
    operations.set(operationId, operation);
    return clone(operation);
  }

  async get(savedServerId: V2SavedServerId, operationId: string): Promise<V2PersistedOperation | null> {
    const operation = this.#operations.get(savedServerId)?.get(operationId);
    return operation === undefined ? null : clone(operation);
  }

  async transition(savedServerId: V2SavedServerId, operationId: string, expected: readonly V2OperationState[], update: V2OperationUpdate, nowMs = Date.now()): Promise<V2PersistedOperation> {
    const operations = this.#operations.get(savedServerId);
    const operation = operations?.get(operationId);
    if (operation === undefined) throw new Error("Unknown Sync V2 operation id");
    if (!expected.includes(operation.state)) throw new Error(`Sync V2 operation transition rejected from ${operation.state}`);
    const next = applyOperationUpdate(operation, update, nowMs);
    operations!.set(operationId, next);
    return clone(next);
  }

  async recoverable(savedServerId: V2SavedServerId, nowMs = Date.now()): Promise<V2PersistedOperation[]> {
    await this.prune(savedServerId, nowMs);
    return [...(this.#operations.get(savedServerId)?.values() ?? [])]
      .filter((operation) => operation.state === "sent" && operation.command !== null)
      .map(clone);
  }

  async prune(savedServerId: V2SavedServerId, nowMs = Date.now()): Promise<void> {
    const operations = this.#operations.get(savedServerId);
    if (operations === undefined) return;
    for (const [operationId, operation] of operations) {
      if (nowMs - retentionStart(operation) < V2_OPERATION_RECEIPT_MAX_AGE_MS) continue;
      operations.delete(operationId);
    }
  }

  async deleteSavedServer(savedServerId: V2SavedServerId): Promise<void> {
    this.#operations.delete(savedServerId);
  }

  async hasSavedServerData(savedServerId: V2SavedServerId): Promise<boolean> {
    return (this.#operations.get(savedServerId)?.size ?? 0) > 0;
  }

  #partition(savedServerId: V2SavedServerId): Map<string, V2PersistedOperation> {
    let operations = this.#operations.get(savedServerId);
    if (operations === undefined) {
      operations = new Map();
      this.#operations.set(savedServerId, operations);
    }
    return operations;
  }
}

export function applyOperationUpdate(operation: V2PersistedOperation, update: V2OperationUpdate, nowMs: number): V2PersistedOperation {
  const next = { ...operation, ...clone(update), updatedAtMs: nowMs };
  if (next.state !== "created" && next.state !== "sent") next.command = null;
  if (["completed", "failed", "indeterminate", "rejected", "expired"].includes(next.state)) {
    next.terminalClass = next.state as NonNullable<V2PersistedOperation["terminalClass"]>;
  }
  return next;
}

function retentionStart(operation: V2PersistedOperation): number {
  if (operation.acceptedAt === null) return operation.createdAtMs;
  const accepted = Date.parse(operation.acceptedAt);
  return Number.isNaN(accepted) ? operation.createdAtMs : accepted;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
