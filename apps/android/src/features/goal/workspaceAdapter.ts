import type {
  ThreadGoal,
  ThreadGoalGetResponse,
  ThreadGoalSetResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { threadResourceKey } from "../../data/workspace-resource-keys";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { GoalWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts goal intents using retained lower authorities. */
export function createGoalWorkspaceAdapter({
  getResources,
  getSession,
  rpcAfterAttach,
}: {
  getResources(): WorkspaceResourceDatabase;
  getSession(connectionId: string): WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): GoalWorkspaceCapabilities {
  const getThreadGoal = async (
    connectionId: string,
    threadId: string,
  ): Promise<ThreadGoal | null> => {
    const key = threadResourceKey(connectionId, threadId);
    const previous = getResources().threadGoals.get(key);
    getResources().putThreadGoal({
      id: key,
      connectionId,
      threadId,
      status: "loading",
      goal: previous?.goal ?? null,
      error: null,
    });
    const session = getSession(connectionId);
    try {
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ThreadGoalGetResponse>(session, "thread/goal/get", {
        threadId,
      });
      getResources().putThreadGoal({
        id: key,
        connectionId,
        threadId,
        status: "ready",
        goal: response.goal,
        error: null,
      });
      return response.goal;
    } catch (cause) {
      getResources().putThreadGoal({
        id: key,
        connectionId,
        threadId,
        status: "error",
        goal: previous?.goal ?? null,
        error: errorMessage(cause),
      });
      throw cause;
    }
  };

  const setThreadGoal = async (
    connectionId: string,
    threadId: string,
    input: ThreadGoalInput,
  ): Promise<ThreadGoal> => {
    const objective = input.objective.trim();
    if (objective.length < 1 || objective.length > 100_000)
      throw new Error("Goal objective must be 1–100000 characters");
    if (
      input.tokenBudget !== null &&
      (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1)
    ) {
      throw new Error("Token budget must be a positive integer");
    }
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const response = await rpcAfterAttach<ThreadGoalSetResponse>(session, "thread/goal/set", {
      threadId,
      objective,
      status: input.status,
      tokenBudget: input.tokenBudget,
    });
    getResources().putThreadGoal({
      id: threadResourceKey(connectionId, threadId),
      connectionId,
      threadId,
      status: "ready",
      goal: response.goal,
      error: null,
    });
    return response.goal;
  };

  const clearThreadGoal = async (connectionId: string, threadId: string): Promise<boolean> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const response = await rpcAfterAttach<{ cleared: boolean }>(session, "thread/goal/clear", {
      threadId,
    });
    if (response.cleared)
      getResources().putThreadGoal({
        id: threadResourceKey(connectionId, threadId),
        connectionId,
        threadId,
        status: "ready",
        goal: null,
        error: null,
      });
    return response.cleared;
  };
  return { getThreadGoal, setThreadGoal, clearThreadGoal };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
