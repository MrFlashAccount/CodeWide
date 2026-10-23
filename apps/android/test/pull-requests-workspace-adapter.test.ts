import { describe, expect, it, vi } from "vitest";

import { createForgeResources } from "../src/data/forgeResources";
import type { WorkspaceSyncSession } from "../src/data/workspace-session";
import { createPullRequestsWorkspaceAdapter } from "../src/features/pullRequests/workspaceAdapter";
import {
  connectedAccount,
  githubProvider,
  hostLoginFlow,
  onboardingAccounts,
} from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

vi.mock("expo-crypto", () => ({ randomUUID: () => "auth-start-id" }));

function sessionFixture(rpc = vi.fn()): WorkspaceSyncSession {
  const value = { connectionId: "server", rpc, stop: vi.fn() };
  // WHY: RpcClient is an external concrete class; this adapter test injects RPC and consumes
  // only the session identity required to select the connected Companion.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as WorkspaceSyncSession;
}

function adapterFixture({
  directRpc = vi.fn(),
  response,
}: {
  readonly directRpc?: ReturnType<typeof vi.fn>;
  readonly response: (method: string) => unknown;
}) {
  const session = sessionFixture(directRpc);
  const methods: string[] = [];
  const rpcAfterAttach = async <Result>(
    _session: WorkspaceSyncSession,
    method: string,
  ): Promise<Result> => {
    methods.push(method);
    const value = response(method);
    // WHY: this typed test transport must implement the caller-selected generic RPC result;
    // the production adapter validates every unknown response before returning it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as Result;
  };
  const forge = createForgeResources({
    getSession: () => session,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach,
  });
  return {
    adapter: createPullRequestsWorkspaceAdapter({
      forge,
      getSession: () => session,
      rpcAfterAttach,
    }),
    methods,
  };
}

describe("pull requests workspace adapter", () => {
  it("returns a host-login flow without gating it on a second accounts read", async () => {
    const { adapter, methods } = adapterFixture({
      response: (method) => {
        if (method !== "companion/forge/auth/start") {
          throw new Error(`Unexpected RPC: ${method}`);
        }
        return { flow: hostLoginFlow, kind: "flow" };
      },
    });

    await expect(
      adapter.startAuth("server", {
        host: "github.com",
        login: null,
        methodId: "gh-login",
        pluginId: "github",
      }),
    ).resolves.toMatchObject({ flow: hostLoginFlow, kind: "flow" });
    expect(methods).toEqual(["companion/forge/auth/start"]);
  });

  it("settles acknowledged account mutations without a second accounts read", async () => {
    const { adapter, methods } = adapterFixture({
      response: (method) => {
        if (method === "companion/forge/provider/setEnabled") {
          return { provider: githubProvider };
        }
        if (
          method === "companion/forge/auth/cancel" ||
          method === "companion/forge/account/disconnect"
        ) {
          return {};
        }
        throw new Error(`Unexpected RPC: ${method}`);
      },
    });

    await expect(adapter.cancelAuth("server", hostLoginFlow.flowId)).resolves.toBeUndefined();
    await expect(
      adapter.disconnect("server", {
        account: connectedAccount.account,
        confirmation: "none",
        mode: "unlink",
      }),
    ).resolves.toBeUndefined();
    await expect(adapter.setProviderEnabled("server", "github", true)).resolves.toMatchObject({
      enabled: true,
      pluginId: "github",
    });
    expect(methods).toEqual([
      "companion/forge/auth/cancel",
      "companion/forge/account/disconnect",
      "companion/forge/provider/setEnabled",
    ]);
  });

  it("returns a submitted account without an accounts read or token telemetry", async () => {
    const directRpc = vi.fn().mockResolvedValue({ account: connectedAccount });
    const { adapter, methods } = adapterFixture({
      directRpc,
      response: (method) => {
        throw new Error(`Unexpected attached RPC: ${method}`);
      },
    });

    await expect(
      adapter.submitToken("server", {
        host: "github.com",
        pluginId: "github",
        token: "secret-test-token",
      }),
    ).resolves.toMatchObject(connectedAccount);
    expect(methods).toEqual([]);
    expect(directRpc).toHaveBeenCalledOnce();
    expect(directRpc.mock.calls[0]?.[0]).toBe("companion/forge/auth/submitToken");
  });

  it("keeps Check again as the one explicit blocking accounts read", async () => {
    const { adapter, methods } = adapterFixture({
      response: (method) => {
        if (method === "companion/forge/accounts/read") {
          return onboardingAccounts;
        }
        throw new Error(`Unexpected RPC: ${method}`);
      },
    });

    await expect(adapter.checkAgain("server")).resolves.toBeUndefined();
    expect(methods).toEqual(["companion/forge/accounts/read"]);
  });
});
