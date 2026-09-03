/** Semantic aliases over the generated executable Sync V2 contract. */
export type {
  V2Attachment,
  V2CatalogAnchor,
  V2CatalogScope,
  V2Error,
  V2Effort,
  V2Id,
  V2InputBlock,
  V2Item,
  V2OperationId,
  V2PendingRequest,
  V2ProjectionChange,
  V2SequencedChange,
  V2SnapshotLimits,
  V2ThreadSettings,
  V2ThreadSummary,
  V2ThreadWindow,
  V2Timestamp,
  V2TurnView,
  V2U64,
} from "./contract.generated";

import type { V2ThreadSummary, V2TurnView } from "./contract.generated";

export type V2ThreadState = V2ThreadSummary["state"];
export type V2TurnState = V2TurnView["state"];
