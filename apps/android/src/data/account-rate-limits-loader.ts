import type { GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import type { AccountPoolSnapshot } from "./account-pool";
import { accountRateLimitsStale } from "./account-rate-limits";
import type { AccountRateLimitsDatabase } from "./account-rate-limits-database";
import type { createWorkspaceSession } from "./workspace-session";

/** Existing limits projection and authenticated session readers. */
export type AccountRateLimitsAuthority = {
  getDatabase(): Pick<
    AccountRateLimitsDatabase,
    "get" | "markLoading" | "putAccountPool" | "markError"
  > | null;
  getSession(connectionId: string): RpcClient | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
};

/** Shared explicit/background refresh owner, retained at JS module lifetime. */
export function createAccountRateLimitsLoader({
  getDatabase,
  getSession,
  rpcAfterAttach,
}: AccountRateLimitsAuthority) {
  const accountRateLimitsInFlight = new Map<string, Promise<GetAccountRateLimitsResponse>>();
  const refreshAccountRateLimits = async (
    connectionId: string,
    force = false,
  ): Promise<GetAccountRateLimitsResponse> => {
    const database = getDatabase();
    if (database === null) throw new Error("Account limits are not ready");
    const cached = database.get(connectionId);
    if (!force && cached != null && cached.snapshot !== null && !accountRateLimitsStale(cached))
      return cached.snapshot;
    const existing = accountRateLimitsInFlight.get(connectionId);
    if (existing !== undefined) return await existing;
    database.markLoading(connectionId);
    const operation = (async () => {
      const session = getSession(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const accountPool = await rpcAfterAttach<AccountPoolSnapshot>(
        session,
        "companion/accountPool/refresh",
        {},
      );
      database.putAccountPool(connectionId, accountPool);
      const active =
        accountPool.profiles.find((profile) => profile.id === accountPool.activeProfileId) ?? null;
      if (
        active?.rateLimits === null ||
        active?.rateLimits === undefined ||
        active.rateLimitsError !== null
      ) {
        throw new Error(active?.rateLimitsError ?? "Active account limits are unavailable");
      }
      return active.rateLimits;
    })();
    accountRateLimitsInFlight.set(connectionId, operation);
    try {
      return await operation;
    } catch (cause) {
      database.markError(
        connectionId,
        cause instanceof Error ? cause.message : "Remote operation failed",
      );
      throw cause;
    } finally {
      if (accountRateLimitsInFlight.get(connectionId) === operation) {
        accountRateLimitsInFlight.delete(connectionId);
      }
    }
  };

  return refreshAccountRateLimits;
}
