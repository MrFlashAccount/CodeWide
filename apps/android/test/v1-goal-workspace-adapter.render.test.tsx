import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/cache/",
  getInfoAsync: async () => ({ exists: false }),
}));

import { createWorkspaceResourceDatabase } from "../src/data/workspace-resource-database";
import { threadResourceKey } from "../src/data/workspace-resource-keys";
import { createGoalWorkspaceAdapter } from "../src/features/goal/workspaceAdapter";

describe("goal workspace command adapter", () => {
  it("updates only the lifecycle status and publishes the authoritative goal", async () => {
    const resources = createWorkspaceResourceDatabase();
    const rpcAfterAttach = jest.fn(async () => ({ goal: pausedGoal() }));
    const adapter = createGoalWorkspaceAdapter({
      getResources: () => resources,
      getSession: () => ({ rpc: jest.fn(), stop: jest.fn() }),
      rpcAfterAttach,
    });

    await expect(adapter.setThreadGoalStatus("connection", "thread", "paused")).resolves.toEqual(
      pausedGoal(),
    );
    expect(rpcAfterAttach).toHaveBeenCalledTimes(1);
    expect(rpcAfterAttach).toHaveBeenCalledWith(expect.anything(), "thread/goal/set", {
      status: "paused",
      threadId: "thread",
    });
    expect(resources.threadGoals.get(threadResourceKey("connection", "thread"))?.goal).toEqual(
      pausedGoal(),
    );
  });
});

function pausedGoal(): ThreadGoal {
  return {
    createdAt: 1,
    objective: "Keep the release healthy",
    status: "paused",
    threadId: "thread",
    timeUsedSeconds: 90,
    tokenBudget: null,
    tokensUsed: 1_000,
    updatedAt: 2,
  };
}
