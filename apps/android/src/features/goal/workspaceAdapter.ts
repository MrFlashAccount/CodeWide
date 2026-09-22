import type {
  ThreadGoal,
  ThreadGoalGetResponse,
  ThreadGoalSetResponse,
} from "@codewide/codex-protocol/v0.155.1/v2";
import type {
  ThreadGoalInput,
  WorkspaceResourceDatabase,
} from "../../data/workspace-resource-database";
import { threadResourceKey } from "../../data/workspace-resource-keys";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { GoalWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts goal intents using retained lower authorities. */
export function createGoalWorkspaceAdapter({
  getResources,
  getSession,
  rpcAfterAttach,
}: {
  getResources: () => WorkspaceResourceDatabase;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): GoalWorkspaceCapabilities {
  const getThreadGoal = async (
    connectionId: string,
    threadId: string,
  ): Promise<ThreadGoal | null> => {
    const key = threadResourceKey(connectionId, threadId);
    const previous = getResources().threadGoals.get(key);
    getResources().putThreadGoal({
      connectionId,
      error: null,
      goal: previous?.goal ?? null,
      id: key,
      status: "loading",
      threadId,
    });
    const session = getSession(connectionId);
    try {
      if (session === undefined) {
        throw new Error("Connection is not enabled");
      }
      const response = await rpcAfterAttach<ThreadGoalGetResponse>(session, "thread/goal/get", {
        threadId,
      });
      getResources().putThreadGoal({
        connectionId,
        error: null,
        goal: response.goal,
        id: key,
        status: "ready",
        threadId,
      });
      return response.goal;
    } catch (error) {
      getResources().putThreadGoal({
        connectionId,
        error: errorMessage(error),
        goal: previous?.goal ?? null,
        id: key,
        status: "error",
        threadId,
      });
      throw error;
    }
  };

  const setThreadGoal = async (
    connectionId: string,
    threadId: string,
    input: ThreadGoalInput,
  ): Promise<ThreadGoal> => {
    const objective = input.objective.trim();
    if (objective.length < 1 || objective.length > 100_000) {
      throw new Error("Goal objective must be 1–100000 characters");
    }
    if (
      input.tokenBudget !== undefined &&
      input.tokenBudget !== null &&
      (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1)
    ) {
      throw new Error("Token budget must be a positive integer");
    }
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<ThreadGoalSetResponse>(session, "thread/goal/set", {
      objective,
      status: input.status,
      threadId,
      // JSON transport omits undefined (keep) while preserving null (clear).
      tokenBudget: input.tokenBudget,
    });
    getResources().putThreadGoal({
      connectionId,
      error: null,
      goal: response.goal,
      id: threadResourceKey(connectionId, threadId),
      status: "ready",
      threadId,
    });
    return response.goal;
  };

  const clearThreadGoal = async (connectionId: string, threadId: string): Promise<boolean> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<{ cleared: boolean }>(session, "thread/goal/clear", {
      threadId,
    });
    if (response.cleared) {
      getResources().putThreadGoal({
        connectionId,
        error: null,
        goal: null,
        id: threadResourceKey(connectionId, threadId),
        status: "ready",
        threadId,
      });
    }
    return response.cleared;
  };
  return { clearThreadGoal, getThreadGoal, setThreadGoal };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
