import type { GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.155.1/v2";
import type {
  AccountLoginStart,
  AccountPoolSnapshot,
  AccountResetCreditConsumption,
} from "../../data/account-pool";
/** Qualified accounts operations; transport and persisted state stay with their existing lower owners. */
export type AccountsWorkspaceCapabilities = {
  activateAccountProfile: (connectionId: string, profileId: string) => Promise<AccountPoolSnapshot>;
  cancelAccountLogin: (connectionId: string, loginId: string) => Promise<void>;
  consumeAccountResetCredit: (
    connectionId: string,
    profileId: string,
    creditId: string | null,
  ) => Promise<AccountResetCreditConsumption>;
  refreshAccountPool: (connectionId: string) => Promise<AccountPoolSnapshot>;
  refreshAccountRateLimits: (
    connectionId: string,
    force?: boolean,
  ) => Promise<GetAccountRateLimitsResponse>;
  removeAccountProfile: (connectionId: string, profileId: string) => Promise<AccountPoolSnapshot>;
  startAccountLogin: (connectionId: string) => Promise<AccountLoginStart>;
  updateAccountProfile: (
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ) => Promise<AccountPoolSnapshot>;
};
