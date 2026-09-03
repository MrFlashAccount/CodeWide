import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";

import type {
  EditPriorTurnReady,
  ForkThroughTurnResult,
  InterruptTurnResult,
  RollbackThreadResult,
  TurnActionAvailability,
  TurnActionAvailabilityInput,
  TurnActions,
  TurnActionsInput,
} from "./turnActionTypes";

/**
 * Creates authoritative turn actions without mirroring command results into the timeline.
 * The projection remains the sole owner of visible thread state after every command settles.
 */
export function createTurnActions(input: TurnActionsInput): TurnActions {
  const { commands, owner, presentation } = input;

  return {
    async editPriorTurn(request): Promise<void> {
      await rollbackThread(commands, owner, request.rollbackThroughTurnId);
      const ready: EditPriorTurnReady = {
        draftInput: request.draftInput,
        sourceTurnId: request.sourceTurnId,
      };
      presentation.openPriorTurnEditor(ready);
    },

    async forkThroughTurn(turnId): Promise<ForkThroughTurnResult> {
      const frame = await commands.execute(owner.savedServerId, {
        kind: "thread.fork",
        threadId: owner.threadId,
        throughTurnId: turnId,
      });
      return forkResult(frame);
    },

    async interruptTurn(turnId): Promise<InterruptTurnResult> {
      const frame = await commands.execute(owner.savedServerId, {
        kind: "turn.interrupt",
        threadId: owner.threadId,
        turnId,
      });
      return interruptResult(frame, owner.threadId, turnId);
    },

    async reviewResponse(request): Promise<void> {
      await presentation.openResponseReview({
        itemId: request.itemId,
        owner,
        turnId: request.turnId,
      });
    },

    async rollbackThroughTurn(turnId): Promise<RollbackThreadResult> {
      return rollbackThread(commands, owner, turnId);
    },
  };
}

export function turnActionAvailability(input: TurnActionAvailabilityInput): TurnActionAvailability {
  const terminal =
    input.state === "completed" || input.state === "failed" || input.state === "interrupted";
  return {
    canFork: terminal,
    canInterrupt: input.state === "queued" || input.state === "running",
    canReview: terminal && input.hasAssistantResponse,
    canRollback: terminal && input.hasRollbackBoundary,
  };
}

async function rollbackThread(
  commands: TurnActionsInput["commands"],
  owner: TurnActionsInput["owner"],
  turnId: string | null,
): Promise<RollbackThreadResult> {
  const frame = await commands.execute(owner.savedServerId, {
    dropFollowingTurns: true,
    kind: "thread.rollback",
    threadId: owner.threadId,
    throughTurnId: turnId,
  });
  return rollbackResult(frame, owner.threadId);
}

function interruptResult(
  frame: V2CommandTerminalFrame,
  threadId: string,
  turnId: string,
): InterruptTurnResult {
  const result = completedResult(frame);
  if (
    result.kind !== "turn.interrupt" ||
    result.threadId !== threadId ||
    result.turnId !== turnId
  ) {
    throw new Error("The server returned a mismatched interrupt result");
  }
  return result;
}

function forkResult(frame: V2CommandTerminalFrame): ForkThroughTurnResult {
  const result = completedResult(frame);
  if (result.kind !== "thread.fork") {
    throw new Error("The server returned a mismatched fork result");
  }
  return { kind: "thread.fork", thread: result.thread };
}

function rollbackResult(frame: V2CommandTerminalFrame, threadId: string): RollbackThreadResult {
  const result = completedResult(frame);
  if (result.kind !== "thread.rollback" || result.thread.id !== threadId) {
    throw new Error("The server returned a mismatched rollback result");
  }
  return result;
}

function completedResult(frame: V2CommandTerminalFrame) {
  if (frame.type === "commandCompleted") return frame.result;
  throw new Error(frame.error.message);
}
