import type {
  AccountRateLimitsUpdatedNotification,
  GetAccountRateLimitsResponse,
} from "@codewide/codex-protocol/v0.155.1/v2";
import type { Collection } from "@tanstack/react-db";
import type { AccountRateLimitsRow } from "./account-rate-limits";
import type { AccountPoolSnapshot } from "./account-pool";

/** Persists and projects rate-limit snapshots for each connected account. */
export type AccountRateLimitsDatabase = {
  close: () => void;
  collection: Collection<AccountRateLimitsRow, string>;
  get: (connectionId: string) => AccountRateLimitsRow | null;
  markError: (connectionId: string, error: string) => void;
  markLoading: (connectionId: string) => void;
  mergeUpdate: (connectionId: string, update: AccountRateLimitsUpdatedNotification) => void;
  putAccountPool: (connectionId: string, accountPool: AccountPoolSnapshot) => void;
  putSnapshot: (connectionId: string, snapshot: GetAccountRateLimitsResponse) => void;
  remove: (connectionId: string) => void;
};
