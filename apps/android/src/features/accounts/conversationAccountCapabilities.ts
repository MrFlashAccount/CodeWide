import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
/** Qualified capabilities consumed by the accounts owner in conversation composition. */
export type ConversationAccountCapabilities = {
  accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
  onRefreshAccountRateLimits: (() => Promise<unknown>) | undefined;
};
