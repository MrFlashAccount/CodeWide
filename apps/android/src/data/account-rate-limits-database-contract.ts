import type {
  AccountRateLimitsUpdatedNotification,
  GetAccountRateLimitsResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { Collection } from "@tanstack/react-db";
import type { AccountRateLimitsRow } from "./account-rate-limits";
import type { AccountPoolSnapshot } from "./account-pool";

/** Persists and projects rate-limit snapshots for each connected account. */
export type AccountRateLimitsDatabase = {
  collection: Collection<AccountRateLimitsRow, string>;
  get(connectionId: string): AccountRateLimitsRow | null;
  markLoading(connectionId: string): void;
  putSnapshot(connectionId: string, snapshot: GetAccountRateLimitsResponse): void;
  putAccountPool(connectionId: string, accountPool: AccountPoolSnapshot): void;
  mergeUpdate(connectionId: string, update: AccountRateLimitsUpdatedNotification): void;
  markError(connectionId: string, error: string): void;
  remove(connectionId: string): void;
  close(): void;
};
