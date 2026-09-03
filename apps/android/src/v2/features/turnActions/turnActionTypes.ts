import type {
  V2Command,
  V2CommandResult,
  V2CommandTerminalFrame,
  V2InputBlock,
  V2ThreadSummary,
  V2TurnView,
} from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";

export type InterruptTurnResult = Extract<V2CommandResult, { kind: "turn.interrupt" }>;
export type RollbackThreadResult = Extract<V2CommandResult, { kind: "thread.rollback" }>;

export interface ForkThroughTurnResult {
  kind: "thread.fork";
  thread: V2ThreadSummary;
}

export interface TurnActionCommandPort {
  execute(savedServerId: SavedServerId, command: V2Command): Promise<V2CommandTerminalFrame>;
}

interface EditPriorTurnRequest {
  draftInput: V2InputBlock[];
  rollbackThroughTurnId: string | null;
  sourceTurnId: string;
}

export interface EditPriorTurnReady {
  draftInput: V2InputBlock[];
  sourceTurnId: string;
}

export interface ReviewResponseRequest {
  itemId: string;
  turnId: string;
}

export interface TurnActionPresentationPort {
  openPriorTurnEditor(request: EditPriorTurnReady): void;
  openResponseReview(
    request: ReviewResponseRequest & { owner: QualifiedThread },
  ): Promise<void> | void;
}

export interface TurnActionsInput {
  commands: TurnActionCommandPort;
  owner: QualifiedThread;
  presentation: TurnActionPresentationPort;
}

export interface TurnActions {
  editPriorTurn(request: EditPriorTurnRequest): Promise<void>;
  forkThroughTurn(turnId: string): Promise<ForkThroughTurnResult>;
  interruptTurn(turnId: string): Promise<InterruptTurnResult>;
  reviewResponse(request: ReviewResponseRequest): Promise<void>;
  rollbackThroughTurn(turnId: string): Promise<RollbackThreadResult>;
}

export interface TurnActionAvailability {
  canFork: boolean;
  canInterrupt: boolean;
  canReview: boolean;
  canRollback: boolean;
}

export interface TurnActionAvailabilityInput {
  hasAssistantResponse: boolean;
  hasRollbackBoundary: boolean;
  state: V2TurnView["state"];
}
