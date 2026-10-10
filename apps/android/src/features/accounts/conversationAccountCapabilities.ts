import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import type { AgentProvidersResource } from "../../data/agentProvidersResource";

/** The server whose provider list a conversation reads provider-level limits from. */
export type ProviderLimitsScope = {
  readonly agentProviders: Pick<AgentProvidersResource, "state$">;
  readonly connectionId: string;
};

/** A thread's provider whose subscription limits its usage menu shows (no account pool). */
export type ProviderLimitsSource = ProviderLimitsScope & {
  readonly provider: string;
};

/** Qualified capabilities consumed by the accounts owner in conversation composition. */
export type ConversationAccountCapabilities = {
  accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
  onRefreshAccountRateLimits: (() => Promise<unknown>) | undefined;
  /** `null` when the thread's provider has an account pool, or for a legacy thread. */
  providerLimits: ProviderLimitsSource | null;
};
