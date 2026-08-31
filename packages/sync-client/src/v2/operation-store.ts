import { fingerprintV2Command, type V2SavedServerId } from "./canonical";
import type {
  V2Command,
  V2OperationState,
  V2OperationStatus,
  V2PersistedOperation,
} from "./operations";
import type { V2StoreUnsubscribe } from "./projection";

export const V2_OPERATION_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export type V2OperationUpdate = Partial<Pick<V2PersistedOperation, "state" | "acceptedAt">>;

/**
 * Minimal operation state is partitioned by the stable saved-server record id.
 * `create` resolves only after its row is atomically committed. Rejection is
 * deliberately ambiguous: callers must read the candidate id before deciding
 * whether retry is safe because conflict or commit acknowledgement can fail
 * while a row already exists.
 */
export interface V2OperationStore {
  create(
    savedServerId: V2SavedServerId,
    operationId: string,
    command: V2Command,
    nowMs?: number,
  ): Promise<V2PersistedOperation>;
  get(savedServerId: V2SavedServerId, operationId: string): Promise<V2PersistedOperation | null>;
  list(savedServerId: V2SavedServerId): Promise<V2OperationStatus[]>;
  subscribe(savedServerId: V2SavedServerId, listener: () => void): V2StoreUnsubscribe;
  transition(
    savedServerId: V2SavedServerId,
    operationId: string,
    expected: readonly V2OperationState[],
    update: V2OperationUpdate,
    nowMs?: number,
  ): Promise<V2PersistedOperation>;
  recoverable(savedServerId: V2SavedServerId, nowMs?: number): Promise<V2PersistedOperation[]>;
  prune(savedServerId: V2SavedServerId, nowMs?: number): Promise<void>;
  hasSavedServerData(savedServerId: V2SavedServerId): Promise<boolean>;
  deleteSavedServer(savedServerId: V2SavedServerId): Promise<void>;
}

export class MemoryV2OperationStore implements V2OperationStore {
  readonly #operations = new Map<string, Map<string, V2PersistedOperation>>();
  readonly #listeners = new Map<string, Set<() => void>>();

  async create(
    savedServerId: V2SavedServerId,
    operationId: string,
    command: V2Command,
    nowMs = Date.now(),
  ): Promise<V2PersistedOperation> {
    await this.prune(savedServerId, nowMs);
    const operations = this.#partition(savedServerId);
    const fingerprint = fingerprintV2Command(command);
    const existing = operations.get(operationId);
    if (existing !== undefined) {
      if (existing.commandFingerprint !== fingerprint)
        throw new Error("Sync V2 operation id is already bound to a different canonical command");
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
    this.#publish(savedServerId);
    return clone(operation);
  }

  async get(
    savedServerId: V2SavedServerId,
    operationId: string,
  ): Promise<V2PersistedOperation | null> {
    const operation = this.#operations.get(savedServerId)?.get(operationId);
    return operation === undefined ? null : clone(operation);
  }

  async list(savedServerId: V2SavedServerId): Promise<V2OperationStatus[]> {
    return [...(this.#operations.get(savedServerId)?.values() ?? [])].map(publicOperationStatus);
  }

  subscribe(savedServerId: V2SavedServerId, listener: () => void): V2StoreUnsubscribe {
    let listeners = this.#listeners.get(savedServerId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(savedServerId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(savedServerId);
    };
  }

  async transition(
    savedServerId: V2SavedServerId,
    operationId: string,
    expected: readonly V2OperationState[],
    update: V2OperationUpdate,
    nowMs = Date.now(),
  ): Promise<V2PersistedOperation> {
    const operations = this.#operations.get(savedServerId);
    const operation = operations?.get(operationId);
    if (operation === undefined) throw new Error("Unknown Sync V2 operation id");
    if (!expected.includes(operation.state))
      throw new Error(`Sync V2 operation transition rejected from ${operation.state}`);
    const next = applyOperationUpdate(operation, update, nowMs);
    operations!.set(operationId, next);
    this.#publish(savedServerId);
    return clone(next);
  }

  async recoverable(
    savedServerId: V2SavedServerId,
    nowMs = Date.now(),
  ): Promise<V2PersistedOperation[]> {
    await this.prune(savedServerId, nowMs);
    return [...(this.#operations.get(savedServerId)?.values() ?? [])]
      .filter((operation) => ["created", "sent", "accepted"].includes(operation.state))
      .map(clone);
  }

  async prune(savedServerId: V2SavedServerId, nowMs = Date.now()): Promise<void> {
    const operations = this.#operations.get(savedServerId);
    if (operations === undefined) return;
    let changed = false;
    for (const [operationId, operation] of operations) {
      if (operation.terminalClass === null) continue;
      if (nowMs - retentionStart(operation) < V2_OPERATION_RECEIPT_MAX_AGE_MS) continue;
      operations.delete(operationId);
      changed = true;
    }
    if (changed) this.#publish(savedServerId);
  }

  async deleteSavedServer(savedServerId: V2SavedServerId): Promise<void> {
    if (this.#operations.delete(savedServerId)) this.#publish(savedServerId);
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

  #publish(savedServerId: V2SavedServerId): void {
    for (const listener of this.#listeners.get(savedServerId) ?? []) {
      try {
        listener();
      } catch {
        // Observation is advisory and must never roll back a committed mutation.
      }
    }
  }
}

export function publicOperationStatus(operation: V2PersistedOperation): V2OperationStatus {
  const { operationId, commandKind, state, terminalClass, createdAtMs, updatedAtMs, acceptedAt } =
    operation;
  return {
    operationId,
    commandKind,
    state,
    terminalClass,
    createdAtMs,
    updatedAtMs,
    acceptedAt,
  };
}

export function applyOperationUpdate(
  operation: V2PersistedOperation,
  update: V2OperationUpdate,
  nowMs: number,
): V2PersistedOperation {
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
