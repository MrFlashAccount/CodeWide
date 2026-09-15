import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import { useThreadGoalRow } from "../../data/use-workspace-resource-row";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { useAsyncResource } from "../../rendering/async-resource-store";

export function useGoalResource(
  workspaceResources: WorkspaceResourceDatabase | null,
  goalResourceId: string | null,
  onGetGoal: (() => Promise<ThreadGoal | null>) | undefined,
) {
  const goalResource = useThreadGoalRow(workspaceResources, goalResourceId);
  useAsyncResource<ThreadGoal | null>(
    onGetGoal === undefined || goalResourceId === null ? null : "conversation-thread-goal",
    goalResourceId ?? "inactive",
    async () => (onGetGoal === undefined ? null : await onGetGoal()),
  );

  return goalResource;
}
