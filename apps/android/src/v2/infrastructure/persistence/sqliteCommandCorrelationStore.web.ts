import type {
  CommandCorrelation,
  CommandCorrelationScope,
  CommandCorrelationState,
  CommandCorrelationStore,
} from "../../application/commandCorrelation";

export function createCommandCorrelationStore(): CommandCorrelationStore {
  const records = new Map<string, CommandCorrelation>();
  return {
    async begin(record) {
      const existing = records.get(record.correlationId);
      if (existing !== undefined && !sameIdentity(existing, record)) {
        throw new Error("Command correlation identity is immutable");
      }
      records.set(record.correlationId, { ...record });
    },
    async deleteSavedServer(savedServerId) {
      for (const [id, record] of records) {
        if (record.savedServerId === savedServerId) records.delete(id);
      }
    },
    async get(correlationId) {
      const record = records.get(correlationId);
      return record === undefined ? null : { ...record };
    },
    async listUnsettled(scope) {
      const result: CommandCorrelation[] = [];
      for (const record of records.values()) {
        if (isUnsettled(record.state) && sameScope(record, scope)) {
          result.push({ ...record });
        }
      }
      return result;
    },
    async markDurable(correlationId, updatedAtMs = Date.now()) {
      update(records, correlationId, "durable", updatedAtMs);
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
  return state === "allocating" || state === "durable";
}
