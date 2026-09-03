import type {
  V2Command,
  V2CommandTerminalFrame,
  V2ThreadGoalStatus,
  V2ThreadGoalUpdate,
} from "@codewide/sync-client/v2";

import type { SavedServerId, ThreadId } from "../../domain/ids";

interface ThreadGoalCommandPort {
  execute(savedServerId: SavedServerId, command: V2Command): Promise<V2CommandTerminalFrame>;
}

interface UpdateThreadGoalInput {
  commands: ThreadGoalCommandPort;
  goal: V2ThreadGoalUpdate | null;
  savedServerId: SavedServerId;
  threadId: ThreadId;
}

export function validateThreadGoal(
  objective: string,
  tokenBudget = "",
  status: V2ThreadGoalStatus = "active",
): V2ThreadGoalUpdate {
  const normalizedObjective = objective.trim();
  if (normalizedObjective === "") throw new Error("Goal objective is required");
  if (normalizedObjective.length > 1_048_576) {
    throw new Error("Goal objective exceeds the server limit");
  }
  const normalizedBudget = tokenBudget.trim();
  if (normalizedBudget === "") {
    return { objective: normalizedObjective, status, tokenBudget: null };
  }
  const budget = Number(normalizedBudget);
  if (!Number.isSafeInteger(budget) || budget < 1) {
    throw new Error("Token budget must be a positive integer");
  }
  return { objective: normalizedObjective, status, tokenBudget: budget };
}

/** Applies a goal mutation and waits for the typed authoritative command result. */
export async function updateThreadGoal(input: UpdateThreadGoalInput): Promise<void> {
  const frame = await input.commands.execute(input.savedServerId, {
    change: { goal: input.goal, kind: "goal" },
    kind: "thread.update",
    threadId: input.threadId,
  });
  if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
  if (frame.result.kind !== "thread.update" || frame.result.thread.id !== input.threadId) {
    throw new Error("Server returned an invalid goal update result");
  }
}
