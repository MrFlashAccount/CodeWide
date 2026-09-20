import type {
  AccountLoginStart,
  AccountPoolSnapshot,
  AccountResetCreditConsumption,
} from "../../data/account-pool";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { AccountsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts accounts intents using retained lower authorities. */
export function createAccountsWorkspaceAdapter({
  getAccountRateLimits,
  getSession,
  refreshAccountRateLimits,
  rpcAfterAttach,
}: {
  getAccountRateLimits: () => AccountRateLimitsDatabase | null;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  refreshAccountRateLimits: AccountsWorkspaceCapabilities["refreshAccountRateLimits"];
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): AccountsWorkspaceCapabilities {
  const refreshAccountPool = async (connectionId: string): Promise<AccountPoolSnapshot> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(
      session,
      "companion/accountPool/refresh",
      {},
    );
    getAccountRateLimits()?.putAccountPool(connectionId, snapshot);
    return snapshot;
  };

  const startAccountLogin = async (connectionId: string): Promise<AccountLoginStart> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return rpcAfterAttach<AccountLoginStart>(session, "companion/accountPool/add/start", {});
  };

  const cancelAccountLogin = async (connectionId: string, loginId: string): Promise<void> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    await rpcAfterAttach(session, "companion/accountPool/add/cancel", { loginId });
  };

  const consumeAccountResetCredit = async (
    connectionId: string,
    profileId: string,
    creditId: string | null,
  ): Promise<AccountResetCreditConsumption> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const result = await rpcAfterAttach<AccountResetCreditConsumption>(
      session,
      "companion/accountPool/profile/resetCredit/consume",
      { creditId, profileId },
    );
    getAccountRateLimits()?.putAccountPool(connectionId, result.accountPool);
    return result;
  };

  const activateAccountProfile = async (
    connectionId: string,
    profileId: string,
  ): Promise<AccountPoolSnapshot> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(
      session,
      "companion/accountPool/profile/activate",
      { profileId },
    );
    getAccountRateLimits()?.putAccountPool(connectionId, snapshot);
    return snapshot;
  };

  const updateAccountProfile = async (
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ): Promise<AccountPoolSnapshot> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(
      session,
      "companion/accountPool/profile/update",
      { profileId, ...update },
    );
    getAccountRateLimits()?.putAccountPool(connectionId, snapshot);
    return snapshot;
  };

  const removeAccountProfile = async (
    connectionId: string,
    profileId: string,
  ): Promise<AccountPoolSnapshot> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(
      session,
      "companion/accountPool/profile/remove",
      { profileId },
    );
    getAccountRateLimits()?.putAccountPool(connectionId, snapshot);
    return snapshot;
  };
  return {
    activateAccountProfile,
    cancelAccountLogin,
    consumeAccountResetCredit,
    refreshAccountPool,
    refreshAccountRateLimits,
    removeAccountProfile,
    startAccountLogin,
    updateAccountProfile,
  };
}
