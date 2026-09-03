import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../domain/ids";
import type { V2PublicFailure } from "../domain/failure";

type CommandCorrelationSurface = "commandAction" | "newThread" | "threadComposer";
export type CommandCorrelationState =
  | "allocating"
  | "durable"
  | "durableReleased"
  | "completed"
  | "failed"
  | "indeterminate"
  | "notCreated";

export interface CommandCorrelation {
  correlationId: string;
  operationId: string;
  savedServerId: SavedServerId;
  surface: CommandCorrelationSurface;
  threadId: string | null;
  state: CommandCorrelationState;
  createdAtMs: number;
  updatedAtMs: number;
}

export type CommandCorrelationScope = Pick<
  CommandCorrelation,
  "savedServerId" | "surface" | "threadId"
>;

export type CommandSettlement =
  | {
      kind: "notCreated";
      correlationId: string;
      operationId: string;
      failure: V2PublicFailure;
      recovered?: true;
    }
  | {
      kind: "terminal";
      correlationId: string;
      operationId: string;
      frame: V2CommandTerminalFrame;
      recovered?: true;
    }
  | {
      kind: "durableUnsettled";
      correlationId: string;
      operationId: string;
      failure: V2PublicFailure;
      recovered?: true;
    };

/** The durable store found a quarantined or otherwise invalid row for this exact scope. */
export class CommandCorrelationScopeBlockedError extends Error {
  constructor() {
    super("Saved command recovery needs an explicit user decision");
    this.name = "CommandCorrelationScopeBlockedError";
  }
}

/** Content-free durable bridge between one explicit UI activation and one operation id. */
export interface CommandCorrelationStore {
  /** Atomically claims a scope or returns the older blocking activation already owning it. */
  begin(record: CommandCorrelation): Promise<CommandCorrelation>;
  markDurable(correlationId: string, updatedAtMs?: number): Promise<void>;
  release(correlationId: string, updatedAtMs?: number): Promise<void>;
  releaseScope(scope: CommandCorrelationScope, updatedAtMs?: number): Promise<void>;
  settle(
    correlationId: string,
    state: Exclude<CommandCorrelationState, "allocating" | "durable" | "durableReleased">,
    updatedAtMs?: number,
  ): Promise<void>;
  get(correlationId: string): Promise<CommandCorrelation | null>;
  listUnsettled(scope: CommandCorrelationScope): Promise<CommandCorrelation[]>;
  deleteSavedServer(savedServerId: SavedServerId): Promise<void>;
}

export function isCommandCorrelation(value: unknown): value is CommandCorrelation {
  if (!isRecord(value)) return false;
  return (
    validIdentifier(value.correlationId, 512) &&
    validIdentifier(value.operationId, 512) &&
    isCommandCorrelationState(value.state) &&
    validTimestamp(value.createdAtMs) &&
    validTimestamp(value.updatedAtMs) &&
    isCommandCorrelationScope(value)
  );
}

export function isCommandCorrelationScope(value: unknown): value is CommandCorrelationScope {
  if (!isRecord(value) || !validIdentifier(value.savedServerId, 256)) return false;
  if (value.surface === "newThread") return value.threadId === null;
  if (value.surface === "threadComposer") return validIdentifier(value.threadId, 512);
  return value.surface === "commandAction" && validIdentifier(value.threadId, 2048);
}

function isCommandCorrelationState(value: unknown): value is CommandCorrelationState {
  return (
    value === "allocating" ||
    value === "durable" ||
    value === "durableReleased" ||
    value === "completed" ||
    value === "failed" ||
    value === "indeterminate" ||
    value === "notCreated"
  );
}

function validIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
