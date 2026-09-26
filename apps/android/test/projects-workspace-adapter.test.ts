import { describe, expect, it, vi } from "vitest";
import type { ThreadStartResponse } from "@codewide/codex-protocol/v0.155.1/v2";
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import { createProjectsWorkspaceAdapter } from "../src/features/projects/workspaceAdapter";
import type { TurnControlsValue } from "../src/data/turn-controls-types";
import { createV1TestThread } from "./fixtures/v1Thread";

function started(cwd: string): ThreadStartResponse {
  const thread = createV1TestThread("created", null, 1, []);
  thread.cwd = cwd;
  return {
    thread, model: "selected-model", modelProvider: "openai", serviceTier: null, cwd,
    runtimeWorkspaceRoots: [], instructionSources: [], approvalPolicy: "on-request",
    approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null, reasoningEffort: "high", multiAgentMode: "explicitRequestOnly",
  };
}
function binding() {
  const rpcAfterAttach = vi.fn();
  const imported = vi.fn().mockResolvedValue(undefined);
  const summarized = vi.fn().mockResolvedValue(undefined);
  const controls = Promise.withResolvers<TurnControlsValue>();
  const loadTurnControls = vi.fn().mockReturnValue(controls.promise);
  const session = { rpc: vi.fn(), stop: vi.fn() };
  const adapter = createProjectsWorkspaceAdapter({
    getSession: () => session,
    getSummaries: () => ({ insertStartedThread: summarized }),
    getDetails: () => ({ importThreadSnapshot: imported }),
    rpcAfterAttach, loadTurnControls,
  });
  return { adapter, rpcAfterAttach, imported, summarized, loadTurnControls };
}
describe("projects workspace command adapter", () => {
  it("makes project addition an explicit pin command", async () => {
    const test = binding();
    const project = {
      addedAt: 1,
      lastUsedAt: 1,
      name: "project",
      path: "/project",
      pinned: true,
    };
    test.rpcAfterAttach.mockResolvedValue({ project });

    await expect(test.adapter.addProject("server", "/project")).resolves.toEqual(project);
    expect(test.rpcAfterAttach).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "companion/project/add",
      { path: "/project", pinned: true },
    );
  });
  it("publishes the authoritative empty thread and settings before control catalogs finish", async () => {
    const test = binding();
    test.rpcAfterAttach.mockResolvedValue(started("/project"));
    expect(await test.adapter.startThread("server", "/project")).toBe("created");
    expect(test.imported).toHaveBeenCalledOnce();
    expect(test.summarized).toHaveBeenCalledOnce();
    const importedThread = test.imported.mock.calls[0]?.[1];
    expect(projectedThreadExecutionSettings(importedThread)).toMatchObject({
      model: "selected-model", effort: "high", approvalPolicy: "on-request", sandboxPolicy: "readOnly",
    });
    expect(test.summarized.mock.calls[0]?.[1]).toBe(importedThread);
    expect(test.imported.mock.invocationCallOrder[0]).toBeLessThan(test.summarized.mock.invocationCallOrder[0]!);
    expect(test.loadTurnControls).toHaveBeenCalledWith("server", "/project");
  });
  it("starts the thread in the provider's effective workspace and preserves the request id", async () => {
    const test = binding();
    test.rpcAfterAttach.mockResolvedValueOnce({
      workspace: { capability: "workspace.create@1", provider: "git", repositoryRoot: "/project", cwd: "/isolated", created: true },
    }).mockResolvedValueOnce(started("/isolated"));
    expect(await test.adapter.startThreadInWorkspace("server", "/project", "activation")).toBe("created");
    expect(test.rpcAfterAttach.mock.calls.map(call => [call[1], call[2]])).toEqual([
      ["companion/workspace/create", { workspace: "/project", requestId: "activation" }],
      ["thread/start", { cwd: "/isolated" }],
    ]);
  });
  it("stops before thread creation when the provider's workspace result is invalid", async () => {
    const test = binding();
    test.rpcAfterAttach.mockResolvedValue({ workspace: { cwd: "" } });
    await expect(test.adapter.startThreadInWorkspace("server", "/project", "activation")).rejects.toThrow("invalid created workspace");
    expect(test.rpcAfterAttach).toHaveBeenCalledOnce();
    expect(test.imported).not.toHaveBeenCalled();
    expect(test.summarized).not.toHaveBeenCalled();
  });
});
