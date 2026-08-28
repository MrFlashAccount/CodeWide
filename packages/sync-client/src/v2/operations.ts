export type {
  V2Action,
  V2ActionResult,
  V2Command,
  V2CommandResult,
  V2Project,
  V2Query,
  V2QueryResult,
  V2QueueItem,
} from "./contract.generated";

import type { V2Command, V2OperationId } from "./contract.generated";

export type V2OperationState = "created" | "sent" | "accepted" | "completed" | "failed" | "indeterminate" | "rejected" | "expired";

export type V2PersistedOperation = {
  operationId: V2OperationId;
  command: V2Command | null;
  commandKind: V2Command["kind"];
  commandFingerprint: string;
  state: V2OperationState;
  terminalClass: Exclude<V2OperationState, "created" | "sent" | "accepted"> | null;
  createdAtMs: number;
  updatedAtMs: number;
  acceptedAt: string | null;
};
