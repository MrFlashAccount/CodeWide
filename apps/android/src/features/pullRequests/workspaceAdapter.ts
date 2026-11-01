import { randomUUID } from "expo-crypto";

import { parseAccountResult, parseAuthStart, parseSubmitToken } from "../../data/forgeContract";
import { requireParsed, type ForgeResources } from "../../data/forgeResources";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";
import type { PullRequestsWorkspaceCapabilities } from "./workspaceCapabilities";

/** Binds Pull requests catalog mutations to the existing session authority. */
export function createPullRequestsWorkspaceAdapter({
  forge,
  getSession,
  rpcAfterAttach,
}: {
  readonly forge: Pick<ForgeResources, "accounts" | "lists">;
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): PullRequestsWorkspaceCapabilities {
  const session = (connectionId: string): WorkspaceSyncSession => {
    const current = getSession(connectionId);
    if (current === undefined) {
      throw new Error("The server is not connected");
    }
    return current;
  };
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> =>
    rpcAfterAttach<unknown>(session(connectionId), method, params);
  const refreshAccounts = async (connectionId: string): Promise<void> => {
    await forge.accounts.refresh({ connectionId });
  };
  return {
    async cancelAuth(connectionId, flowId) {
      await call(connectionId, "companion/forge/auth/cancel", { flowId });
    },
    checkAgain: refreshAccounts,
    async disconnect(connectionId, { account, confirmation, mode }) {
      await call(connectionId, "companion/forge/account/disconnect", {
        account,
        confirmation,
        mode,
      });
    },
    async setAccountEnabled(connectionId, account, enabled) {
      const updated = requireParsed(
        parseAccountResult(
          await call(connectionId, "companion/forge/account/setEnabled", { account, enabled }),
        ),
        "account",
      );
      // The acknowledgement is authoritative for this one account; the
      // Companion's accounts invalidation reconciles everything else.
      forge.accounts.patch({ connectionId }, (snapshot) => ({
        ...snapshot,
        accounts: snapshot.accounts.map((candidate) =>
          candidate.account === updated.account ? updated : candidate,
        ),
      }));
      return updated;
    },
    async startAuth(connectionId, request) {
      const result = requireParsed(
        parseAuthStart(
          await call(connectionId, "companion/forge/auth/start", {
            host: request.host,
            idempotencyKey: randomUUID(),
            login: request.login,
            methodId: request.methodId,
            pluginId: request.pluginId,
          }),
        ),
        "auth start",
      );
      // The start acknowledgement already carries the authoritative flow or
      // connected account. Do not hold that UI-critical result behind a
      // second accounts read: the Companion publishes an accounts invalidation
      // for durable reconciliation, and the query also resynchronizes.
      return result;
    },
    async submitToken(connectionId, request) {
      // WHY direct `rpc`: `rpcAfterAttach` records request lifecycle telemetry. The token
      // request goes straight to the session so nothing but the transport ever sees it.
      const response: unknown = await session(connectionId).rpc<unknown>(
        "companion/forge/auth/submitToken",
        {
          host: request.host,
          idempotencyKey: randomUUID(),
          pluginId: request.pluginId,
          token: request.token,
        },
      );
      const account = requireParsed(parseSubmitToken(response), "token result");
      return account;
    },
  };
}
