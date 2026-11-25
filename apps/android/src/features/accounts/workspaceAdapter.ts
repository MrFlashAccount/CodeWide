import type {
  AccountLoginStart,
  AccountPoolSnapshot,
  AccountResetCreditConsumption,
} from "../../data/account-pool";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import {
  parseProviderResetConsumption,
  PROVIDER_RATE_LIMIT_RESET_CONSUME_METHOD,
  type ProviderResetConsumption,
} from "../../data/agentProviders";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { AccountsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts accounts intents using retained lower authorities. */
export function createAccountsWorkspaceAdapter({
  getAccountRateLimits,
  getSession,
  refreshAccountRateLimits,
  refreshAgentProviders,
  rpcAfterAttach,
}: {
  getAccountRateLimits: () => AccountRateLimitsDatabase | null;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  refreshAccountRateLimits: AccountsWorkspaceCapabilities["refreshAccountRateLimits"];
  refreshAgentProviders: (connectionId: string) => Promise<void>;
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

  const consumeProviderRateLimitReset = async (
    connectionId: string,
    providerId: string,
    grantId: string,
  ): Promise<void> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const result = parseProviderResetConsumption(
      await rpcAfterAttach<unknown>(session, PROVIDER_RATE_LIMIT_RESET_CONSUME_METHOD, {
        grantId,
        providerId,
      }),
    );
    if (result === null) {
      throw new Error("The server sent an invalid reset result");
    }
    if (result.outcome !== "reset") {
      throw new Error(providerResetFailure(result.outcome));
    }
    // The provider also emits a durable status change. This read closes the
    // gap for older connections that attached after that notification.
    await refreshAgentProviders(connectionId).catch(() => undefined);
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
    consumeProviderRateLimitReset,
    refreshAccountPool,
    refreshAccountRateLimits,
    removeAccountProfile,
    startAccountLogin,
    updateAccountProfile,
  };
}

type ProviderResetFailure = Exclude<ProviderResetConsumption["outcome"], "reset">;

const PROVIDER_RESET_FAILURES: Readonly<Record<ProviderResetFailure, string>> = {
  alreadyUsed: "This reset was already used",
  authError: "The provider sign-in must be refreshed on the server",
  cooldown: "The provider reset is still cooling down",
  error: "The provider could not use this reset",
  ineligible: "This provider account is not eligible for the reset",
  notLimited: "The provider can use this reset only after a usage limit is reached",
  rateLimited: "The provider rejected too many reset attempts; try again later",
  unavailable: "This provider reset is not available now",
};

function providerResetFailure(outcome: ProviderResetFailure): string {
  return PROVIDER_RESET_FAILURES[outcome];
}
