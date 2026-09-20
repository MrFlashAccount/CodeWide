import { describe, expect, it, vi } from "vitest";

import { createGlobalSupervisorThreadRemote } from "../src/data/globalSupervisorThreadRemote";
import { unknownRecord } from "../src/data/unknownRecord";
import type { WorkspaceSyncSession } from "../src/data/workspace-session";

function sessionFixture(): WorkspaceSyncSession {
  const value = { connectionId: "home", rpc: vi.fn(), stop: vi.fn() };
  // WHY: RpcClient is an external concrete class, while this boundary test exercises only the
  // WorkspaceSyncSession identity passed to the injected app-server RPC adapter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as WorkspaceSyncSession;
}

describe("Global Supervisor thread RPC boundary", () => {
  it("sends the current behavioral personality when creating a hidden supervisor thread", async () => {
    const session = sessionFixture();
    const personality = vi.fn(async () => ({
      character: "Calm and candid",
      communicationStyle: "Keep spoken answers concise",
      rules: "Always answer in Russian",
    }));
    const rpcAfterAttach = vi.fn(async () => ({ thread: { id: "supervisor" } }));
    const remote = createGlobalSupervisorThreadRemote({
      getSession: () => session,
      personality,
      rpcAfterAttach,
    });

    await expect(remote.startThread("home", "codewide-global-supervisor:token")).resolves.toBe(
      "supervisor",
    );

    expect(personality).toHaveBeenCalledOnce();
    expect(rpcAfterAttach).toHaveBeenCalledOnce();
    expect(rpcAfterAttach).toHaveBeenCalledWith(
      session,
      "thread/start",
      expect.objectContaining({
        developerInstructions: expect.stringMatching(
          /every standard Codex capability[\s\S]*Rules:\nAlways answer in Russian/u,
        ),
        threadSource: "codewide-global-supervisor:token",
      }),
    );
    const payload = unknownRecord(rpcAfterAttach.mock.calls[0]?.[2]);
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty("voice");
    expect(payload).not.toHaveProperty("personality");
  });
});
