import type {
  V2Command,
  V2CommandTerminalFrame,
  V2OperationReceipt,
  V2OperationStatus,
  V2Query,
  V2QueryResult,
} from "@codewide/sync-client/v2";
import {
  SyncV2CommandDurableUnsettledError,
  SyncV2CommandNotCreatedError,
} from "@codewide/sync-client/v2";

import type { SavedServerId } from "../domain/ids";
import { CommandCorrelationScopeBlockedError } from "./commandCorrelation";
import type {
  CommandCorrelation,
  CommandCorrelationScope,
  CommandCorrelationStore,
  CommandSettlement,
} from "./commandCorrelation";

export interface CommandSessionProvider {
  open(savedServerId: string): Promise<{
    session: {
      command(operationId: string, command: V2Command): Promise<V2CommandTerminalFrame>;
      query(query: V2Query): Promise<V2QueryResult>;
      operations(): Promise<V2OperationStatus[]>;
      subscribe(listener: () => void): () => void;
      state: string;
    };
  }>;
}

interface CommandCapabilitiesInput {
  correlationId(): string;
  correlations: CommandCorrelationStore;
  now(): number;
  operationId(): string;
  sessions: CommandSessionProvider;
}

export class CommandCapabilities {
  readonly #sessions: CommandSessionProvider;
  readonly #operationId: () => string;
  readonly #correlationId: () => string;
  readonly #correlations: CommandCorrelationStore;
  readonly #now: () => number;
  readonly #active = new Map<string, Promise<CommandSettlement>>();

  constructor(input: CommandCapabilitiesInput) {
    this.#sessions = input.sessions;
    this.#operationId = input.operationId;
    this.#correlationId = input.correlationId;
    this.#correlations = input.correlations;
    this.#now = input.now;
  }

  async subscribe(savedServerId: SavedServerId, listener: () => void): Promise<() => void> {
    const { session } = await this.#sessions.open(savedServerId);
    return session.subscribe(listener);
  }

  executeCorrelated(
    scope: CommandCorrelationScope,
    command: V2Command,
  ): Promise<CommandSettlement> {
    const correlationId = this.#correlationId();
    const operationId = this.#operationId();
    const createdAtMs = this.#now();
    const record: CommandCorrelation = {
      ...scope,
      correlationId,
      operationId,
      state: "allocating",
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
    // Defer execution one microtask so the activation is locked before even the
    // correlation-store begin can fail.
    const settlement = Promise.resolve()
      .then(() => this.#executeRecord(record, command))
      .catch(() => durableUnsettled(record))
      .finally(() => {
        this.#active.delete(correlationId);
      });
    this.#active.set(correlationId, settlement);
    return settlement;
  }

  async listUnsettled(scope: CommandCorrelationScope): Promise<CommandCorrelation[]> {
    const records = await this.#correlations.listUnsettled(scope);
    let session: Awaited<ReturnType<CommandSessionProvider["open"]>>["session"];
    let statuses: V2OperationStatus[];
    try {
      ({ session } = await this.#sessions.open(scope.savedServerId));
      statuses = await session.operations();
    } catch {
      return records;
    }
    const byId = new Map(statuses.map((status) => [status.operationId, status]));
    const unsettled: CommandCorrelation[] = [];
    for (const record of records) {
      if (this.#active.has(record.correlationId)) {
        unsettled.push(record);
        continue;
      }
      const status = byId.get(record.operationId);
      const settlement =
        status === undefined
          ? await this.#settleMissing(record)
          : await this.#reconcileStatus(record, session, status);
      if (settlement.kind === "durableUnsettled") {
        unsettled.push(await this.#markDurable(record));
      }
    }
    return unsettled;
  }

  async listLocalUnsettled(scope: CommandCorrelationScope): Promise<CommandCorrelation[]> {
    return this.#correlations.listUnsettled(scope);
  }

  async releaseUnsettled(correlationId: string): Promise<void> {
    const correlation = await this.#correlations.get(correlationId);
    if (correlation === null) return;
    if (
      correlation.state !== "allocating" &&
      correlation.state !== "durable" &&
      correlation.state !== "durableReleased"
    ) {
      return;
    }
    await this.#correlations.release(correlationId, this.#now());
  }

  async releaseScope(scope: CommandCorrelationScope): Promise<void> {
    await this.#correlations.releaseScope(scope, this.#now());
  }

  async reconcile(correlationId: string): Promise<CommandSettlement | null> {
    const active = this.#active.get(correlationId);
    if (active !== undefined) return active;
    const correlation = await this.#correlations.get(correlationId);
    if (correlation === null) return null;
    if (correlation.state === "notCreated") return notCreated(correlation);
    let session: Awaited<ReturnType<CommandSessionProvider["open"]>>["session"];
    let status: V2OperationStatus | undefined;
    try {
      ({ session } = await this.#sessions.open(correlation.savedServerId));
      status = (await session.operations()).find((value) => {
        const { operationId } = value;
        return operationId === correlation.operationId;
      });
    } catch {
      return durableUnsettled(correlation);
    }
    if (status === undefined) {
      const settlement = await this.#settleMissing(correlation);
      return settlement;
    }
    return this.#reconcileStatus(correlation, session, status);
  }

  async #executeRecord(record: CommandCorrelation, command: V2Command): Promise<CommandSettlement> {
    let claimed: CommandCorrelation;
    try {
      claimed = await this.#correlations.begin(record);
    } catch (cause: unknown) {
      if (cause instanceof CommandCorrelationScopeBlockedError) return durableUnsettled(record);
      return notCreated(record);
    }
    if (claimed.correlationId !== record.correlationId) {
      const recovered = (await this.reconcile(claimed.correlationId)) ?? durableUnsettled(claimed);
      return { ...recovered, recovered: true };
    }
    let session: Awaited<ReturnType<CommandSessionProvider["open"]>>["session"];
    try {
      ({ session } = await this.#sessions.open(record.savedServerId));
    } catch {
      await this.#trySettle(record.correlationId, "notCreated");
      return notCreated(record);
    }
    try {
      const frame = await session.command(record.operationId, command);
      if (frame.operationId !== record.operationId) {
        await this.#tryMarkDurable(record.correlationId);
        return durableUnsettled(record);
      }
      await this.#tryMarkDurable(record.correlationId);
      await this.#trySettle(record.correlationId, correlationTerminalState(frame));
      return {
        correlationId: record.correlationId,
        frame,
        kind: "terminal",
        operationId: record.operationId,
      };
    } catch (cause: unknown) {
      if (cause instanceof SyncV2CommandNotCreatedError) {
        await this.#trySettle(record.correlationId, "notCreated");
        return notCreated(record);
      }
      if (cause instanceof SyncV2CommandDurableUnsettledError) {
        await this.#tryMarkDurable(record.correlationId);
        return durableUnsettled(record);
      }
      // An untyped command/store failure is ambiguous. It must never authorize
      // a fresh operation id, even when a diagnostic read also fails or is empty.
      await this.#tryMarkDurable(record.correlationId);
      return durableUnsettled(record);
    }
  }

  async #tryMarkDurable(correlationId: string): Promise<void> {
    try {
      await this.#correlations.markDurable(correlationId, this.#now());
    } catch {
      // The caller still receives the non-retryable durable classification.
    }
  }

  async #trySettle(
    correlationId: string,
    state: "completed" | "failed" | "indeterminate" | "notCreated",
  ): Promise<void> {
    try {
      await this.#correlations.settle(correlationId, state, this.#now());
    } catch {
      // The bounded settlement returned to the active control remains visible.
    }
  }

  async #markDurable(record: CommandCorrelation): Promise<CommandCorrelation> {
    if (record.state === "durableReleased") return record;
    const updatedAtMs = this.#now();
    await this.#correlations.markDurable(record.correlationId, updatedAtMs);
    return { ...record, state: "durable", updatedAtMs };
  }

  async #settleMissing(record: CommandCorrelation): Promise<CommandSettlement> {
    // A missing status read after process death is not proof that the
    // operation-store commit never happened. Preserve the same identity until
    // an exact typed settlement arrives.
    await this.#tryMarkDurable(record.correlationId);
    return durableUnsettled(record);
  }

  async #reconcileStatus(
    record: CommandCorrelation,
    session: Awaited<ReturnType<CommandSessionProvider["open"]>>["session"],
    status: V2OperationStatus,
  ): Promise<CommandSettlement> {
    const durable = await this.#markDurable(record);
    if (session.state !== "live") return durableUnsettled(durable);
    if (status.state !== "accepted" && !isTerminalStatus(status)) {
      return durableUnsettled(durable);
    }
    const receipt = await queryReceipt(session, record.operationId);
    if (receipt === null) return durableUnsettled(durable);
    return this.#settleReceipt(durable, receipt);
  }

  async #settleReceipt(
    record: CommandCorrelation,
    receipt: V2OperationReceipt,
  ): Promise<CommandSettlement> {
    if (receipt.state === "admitted") {
      return durableUnsettled(record);
    }
    const frame: V2CommandTerminalFrame =
      receipt.state === "completed"
        ? { operationId: record.operationId, result: receipt.result, type: "commandCompleted" }
        : receipt.state === "failed"
          ? { error: receipt.error, operationId: record.operationId, type: "commandFailed" }
          : receipt.state === "indeterminate"
            ? {
                error: receipt.error,
                operationId: record.operationId,
                type: "commandIndeterminate",
              }
            : {
                error: {
                  code: "operationExpired",
                  recovery: "userAction",
                  message: "Operation receipt expired",
                },
                operationId: record.operationId,
                requestId: record.correlationId,
                type: "commandExpired",
              };
    await this.#correlations.settle(
      record.correlationId,
      correlationTerminalState(frame),
      this.#now(),
    );
    return {
      correlationId: record.correlationId,
      frame,
      kind: "terminal",
      operationId: record.operationId,
    };
  }
}

async function queryReceipt(
  session: Awaited<ReturnType<CommandSessionProvider["open"]>>["session"],
  operationId: string,
): Promise<V2OperationReceipt | null> {
  try {
    const result = await session.query({ kind: "operation.get", operationId });
    return result.kind === "operation.get" && result.operationId === operationId
      ? result.receipt
      : null;
  } catch {
    return null;
  }
}

function isTerminalStatus(status: V2OperationStatus): boolean {
  return status.terminalClass !== null;
}

export class QueryCapabilities {
  readonly #sessions: CommandSessionProvider;

  constructor(sessions: CommandSessionProvider) {
    this.#sessions = sessions;
  }

  async execute(savedServerId: SavedServerId, query: V2Query): Promise<V2QueryResult> {
    const { session } = await this.#sessions.open(savedServerId);
    if (session.state !== "live") {
      throw new Error("This query requires a live V2 connection");
    }
    return session.query(query);
  }
}

function notCreated(record: CommandCorrelation): CommandSettlement {
  return {
    correlationId: record.correlationId,
    failure: {
      code: "notCreated",
      message: "The connection changed before this action was saved. Try again when connected.",
      retryable: true,
    },
    kind: "notCreated",
    operationId: record.operationId,
  };
}

function durableUnsettled(record: CommandCorrelation): CommandSettlement {
  return {
    correlationId: record.correlationId,
    failure: {
      code: "durableUnsettled",
      message: "This action is saved and still waiting for an authoritative result.",
      retryable: false,
    },
    kind: "durableUnsettled",
    operationId: record.operationId,
  };
}

function correlationTerminalState(
  frame: V2CommandTerminalFrame,
): "completed" | "failed" | "indeterminate" {
  if (frame.type === "commandCompleted") return "completed";
  if (frame.type === "commandIndeterminate") return "indeterminate";
  return "failed";
}
