import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../domain/ids";
import type { V2PublicFailure } from "../domain/failure";

export type CommandCorrelationSurface = "newThread" | "threadComposer";
export type CommandCorrelationState =
  | "allocating"
  | "durable"
  | "completed"
  | "failed"
  | "indeterminate"
  | "notCreated";

export type CommandCorrelation = {
  correlationId: string;
  operationId: string;
  savedServerId: SavedServerId;
  surface: CommandCorrelationSurface;
  threadId: string | null;
  state: CommandCorrelationState;
  createdAtMs: number;
  updatedAtMs: number;
};

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
    }
  | {
      kind: "terminal";
      correlationId: string;
      operationId: string;
      frame: V2CommandTerminalFrame;
    }
  | {
      kind: "durableUnsettled";
      correlationId: string;
      operationId: string;
      failure: V2PublicFailure;
    };

/** Content-free durable bridge between one explicit UI activation and one operation id. */
export interface CommandCorrelationStore {
  begin(record: CommandCorrelation): Promise<void>;
  markDurable(correlationId: string, updatedAtMs?: number): Promise<void>;
  settle(
    correlationId: string,
    state: Exclude<CommandCorrelationState, "allocating" | "durable">,
    updatedAtMs?: number,
  ): Promise<void>;
  get(correlationId: string): Promise<CommandCorrelation | null>;
  listUnsettled(scope: CommandCorrelationScope): Promise<CommandCorrelation[]>;
  deleteSavedServer(savedServerId: SavedServerId): Promise<void>;
}
