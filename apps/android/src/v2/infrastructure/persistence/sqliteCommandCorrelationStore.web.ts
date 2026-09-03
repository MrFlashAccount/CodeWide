import type {
  CommandCorrelation,
  CommandCorrelationScope,
  CommandCorrelationState,
  CommandCorrelationStore,
} from "../../application/commandCorrelation";
import {
  CommandCorrelationScopeBlockedError,
  isCommandCorrelation,
  isCommandCorrelationScope,
} from "../../application/commandCorrelation";

export function createCommandCorrelationStore(): CommandCorrelationStore {
  const records = new Map<string, CommandCorrelation>();
  const quarantinedScopes = new Set<string>();
  return {
    async begin(record) {
      if (!isCommandCorrelation(record)) throw new Error("Command correlation is invalid");
      const key = scopeKey(record);
      if (quarantinedScopes.has(key)) throw new CommandCorrelationScopeBlockedError();
      const existing = records.get(record.correlationId);
      if (existing !== undefined && !sameIdentity(existing, record)) {
        throw new Error("Command correlation identity is immutable");
      }
      if (existing !== undefined) return { ...existing };
      for (const candidate of records.values()) {
        if (!isCommandCorrelation(candidate)) {
          if (sameUncheckedScope(candidate, record)) {
            quarantinedScopes.add(key);
            throw new CommandCorrelationScopeBlockedError();
          }
          continue;
        }
        if (isBlocking(candidate.state) && sameScope(candidate, record)) return { ...candidate };
      }
      records.set(record.correlationId, { ...record });
      return { ...record };
    },
    async deleteSavedServer(savedServerId) {
      for (const [id, record] of records) {
        if (record.savedServerId === savedServerId) records.delete(id);
      }
      for (const key of quarantinedScopes) {
        if (key.startsWith(`${JSON.stringify(savedServerId)}:`)) quarantinedScopes.delete(key);
      }
    },
    async get(correlationId) {
      const record = records.get(correlationId);
      if (record === undefined) return null;
      if (!isCommandCorrelation(record)) {
        if (isScopeLike(record)) quarantinedScopes.add(scopeKey(record));
        throw new CommandCorrelationScopeBlockedError();
      }
      return { ...record };
    },
    async listUnsettled(scope) {
      if (!isCommandCorrelationScope(scope))
        throw new Error("Command correlation scope is invalid");
      const key = scopeKey(scope);
      if (quarantinedScopes.has(key)) throw new CommandCorrelationScopeBlockedError();
      const result: CommandCorrelation[] = [];
      for (const record of records.values()) {
        if (!isCommandCorrelation(record)) {
          if (sameUncheckedScope(record, scope)) {
            quarantinedScopes.add(key);
            throw new CommandCorrelationScopeBlockedError();
          }
          continue;
        }
        if (isUnsettled(record.state) && sameScope(record, scope)) {
          result.push({ ...record });
        }
      }
      return result;
    },
    async markDurable(correlationId, updatedAtMs = Date.now()) {
      const record = records.get(correlationId);
      if (record?.state !== "durableReleased") {
        update(records, correlationId, "durable", updatedAtMs);
      }
    },
    async release(correlationId, updatedAtMs = Date.now()) {
      update(records, correlationId, "durableReleased", updatedAtMs);
    },
    async releaseScope(scope, updatedAtMs = Date.now()) {
      if (!isCommandCorrelationScope(scope))
        throw new Error("Command correlation scope is invalid");
      quarantinedScopes.delete(scopeKey(scope));
      for (const [id, record] of records) {
        if (isBlocking(record.state) && sameScope(record, scope)) {
          update(records, id, "durableReleased", updatedAtMs);
        }
      }
    },
    async settle(correlationId, state, updatedAtMs = Date.now()) {
      update(records, correlationId, state, updatedAtMs);
    },
  };
}

function update(
  records: Map<string, CommandCorrelation>,
  correlationId: string,
  state: CommandCorrelationState,
  updatedAtMs: number,
): void {
  const record = records.get(correlationId);
  if (record === undefined) throw new Error("Unknown command correlation");
  records.set(correlationId, { ...record, state, updatedAtMs });
}

function sameIdentity(left: CommandCorrelation, right: CommandCorrelation): boolean {
  return left.operationId === right.operationId && sameScope(left, right);
}

function sameScope(left: CommandCorrelation, right: CommandCorrelationScope): boolean {
  return (
    left.savedServerId === right.savedServerId &&
    left.surface === right.surface &&
    left.threadId === right.threadId
  );
}

function isUnsettled(state: CommandCorrelationState): boolean {
  return state === "allocating" || state === "durable" || state === "durableReleased";
}

function isBlocking(state: CommandCorrelationState): boolean {
  return state === "allocating" || state === "durable";
}

function scopeKey(scope: CommandCorrelationScope): string {
  return `${JSON.stringify(scope.savedServerId)}:${JSON.stringify(scope.surface)}:${JSON.stringify(scope.threadId)}`;
}

function sameUncheckedScope(left: unknown, right: CommandCorrelationScope): boolean {
  if (!isRecord(left)) return false;
  return (
    Reflect.get(left, "savedServerId") === right.savedServerId &&
    Reflect.get(left, "surface") === right.surface &&
    Reflect.get(left, "threadId") === right.threadId
  );
}

function isScopeLike(value: unknown): value is CommandCorrelationScope {
  if (!isRecord(value)) return false;
  return (
    typeof Reflect.get(value, "savedServerId") === "string" &&
    typeof Reflect.get(value, "surface") === "string" &&
    (Reflect.get(value, "threadId") === null || typeof Reflect.get(value, "threadId") === "string")
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
