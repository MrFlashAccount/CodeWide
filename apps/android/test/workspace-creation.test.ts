import { describe, expect, it } from "vitest";

import {
  parseCreatedWorkspace,
  parseWorkspaceSupport,
  startThreadInCreatedWorkspace,
  WORKSPACE_CREATE_CAPABILITY,
} from "../src/data/workspace-creation";

describe("workspace creation contract", () => {
  it("keeps unsupported repositories capability-free", () => {
    expect(parseWorkspaceSupport({ support: null })).toBeNull();
  });

  it("parses provider capability metadata", () => {
    expect(parseWorkspaceSupport({
      support: {
        capability: WORKSPACE_CREATE_CAPABILITY,
        provider: "git",
        displayName: "Git worktree",
        repositoryRoot: "/work/repo",
      },
    })).toEqual({
      capability: WORKSPACE_CREATE_CAPABILITY,
      provider: "git",
      displayName: "Git worktree",
      repositoryRoot: "/work/repo",
    });
  });

  it("rejects a provider result outside the versioned contract", () => {
    expect(() => parseCreatedWorkspace({
      workspace: {
        capability: "workspace.create@2",
        provider: "git",
        repositoryRoot: "/work/repo",
        cwd: "/work/repo",
        created: true,
      },
    })).toThrow("invalid created workspace");
  });

  it("starts the session in the provider-returned cwd", async () => {
    const observedCwds: string[] = [];
    const workspace = {
      capability: WORKSPACE_CREATE_CAPABILITY,
      provider: "git",
      repositoryRoot: "/work/repo",
      cwd: "/worktrees/request/repo/packages/app",
      created: true,
    } as const;

    const result = await startThreadInCreatedWorkspace({
      createWorkspace: async () => workspace,
      startThread: async (cwd) => {
        observedCwds.push(cwd);
        return "thread-1";
      },
    });

    expect(observedCwds).toEqual([workspace.cwd]);
    expect(result).toEqual({ threadId: "thread-1", workspace });
  });
});
