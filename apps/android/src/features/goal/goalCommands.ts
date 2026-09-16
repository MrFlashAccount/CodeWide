import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";

/** Remote commands available to the thread-goal feature. */
export type GoalCommands = {
  clearThreadGoal: (connectionId: string, threadId: string) => Promise<boolean>;
  getThreadGoal: (connectionId: string, threadId: string) => Promise<ThreadGoal | null>;
  setThreadGoal: (
    connectionId: string,
    threadId: string,
    input: ThreadGoalInput,
  ) => Promise<ThreadGoal>;
};
export function useGoalCommands(
  remote: GoalCommands,
  activeConnectionId: string,
  activeRemoteThreadId: string | null,
) {
  const requireThreadId = useEvent(() => {
    if (activeRemoteThreadId === null) {
      throw new Error("No thread selected");
    }
    return activeRemoteThreadId;
  });
  const onGetGoal = useEvent(async () =>
    remote.getThreadGoal(activeConnectionId, requireThreadId()),
  );
  const onSetGoal = useEvent(async (input: ThreadGoalInput) =>
    remote.setThreadGoal(activeConnectionId, requireThreadId(), input),
  );
  const onClearGoal = useEvent(async () =>
    remote.clearThreadGoal(activeConnectionId, requireThreadId()),
  );
  return { onClearGoal, onGetGoal, onSetGoal };
}
