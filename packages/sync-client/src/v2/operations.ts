export type {
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
  readonly operationId: V2OperationId;
  readonly command: V2Command | null;
  readonly commandKind: V2Command["kind"];
  readonly commandFingerprint: string;
  readonly state: V2OperationState;
  readonly terminalClass: Exclude<V2OperationState, "created" | "sent" | "accepted"> | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly acceptedAt: string | null;
};

/** Content-free operation status published to application observers. */
export type V2OperationStatus = Pick<
  V2PersistedOperation,
  "operationId" | "commandKind" | "state" | "terminalClass" | "createdAtMs" | "updatedAtMs" | "acceptedAt"
>;
