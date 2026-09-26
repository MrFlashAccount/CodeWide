import { describe, expect, it, vi } from "vitest";

import { RpcResponseError } from "@codewide/sync-client";

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

it("reconciles through the server's exact-source catalog, including an empty continuation", async () => {
  const session = sessionFixture();
  const rpcAfterAttach = vi.fn(async (_session, _method, params) =>
    params.archived
      ? { data: [], nextCursor: null }
      : params.cursor === null
        ? { data: [], nextCursor: "next" }
        : {
            data: [{ id: "home", threadSource: "codewide-global-supervisor:token" }],
            nextCursor: null,
          },
  );
  const remote = createGlobalSupervisorThreadRemote({
    getSession: () => session,
    personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
    rpcAfterAttach,
  });
  await expect(
    remote.findThreadsBySource("home", "codewide-global-supervisor:token"),
  ).resolves.toEqual(["home"]);
  expect(rpcAfterAttach).toHaveBeenCalledWith(
    session,
    "companion/supervisor/threadList",
    expect.objectContaining({ threadSource: "codewide-global-supervisor:token", cursor: "next" }),
  );
  expect(
    rpcAfterAttach.mock.calls.every((call) => call[1] === "companion/supervisor/threadList"),
  ).toBe(true);
});

it("checks the old supervisor thread with a bounded metadata-only read", async () => {
  const session = sessionFixture();
  const rpcAfterAttach = vi.fn(async () => ({
    thread: { id: "prior-home", threadSource: "codewide-global-supervisor:old-token" },
  }));
  const remote = createGlobalSupervisorThreadRemote({
    getSession: () => session,
    personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
    rpcAfterAttach,
  });

  await expect(remote.readThreadSource("new-profile", "prior-home")).resolves.toBe(
    "codewide-global-supervisor:old-token",
  );
  expect(rpcAfterAttach).toHaveBeenCalledWith(session, "thread/read", {
    includeTurns: false,
    threadId: "prior-home",
  });
});

it("does not treat a missing prior thread as a recoverable supervisor", async () => {
  const remote = createGlobalSupervisorThreadRemote({
    getSession: sessionFixture,
    personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
    rpcAfterAttach: async () => {
      throw new RpcResponseError(-32_061, "Thread unavailable");
    },
  });

  await expect(remote.readThreadSource("new-profile", "prior-home")).resolves.toBeNull();
});
