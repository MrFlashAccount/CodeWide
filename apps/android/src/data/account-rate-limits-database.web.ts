import type { AccountRateLimitsDatabase } from "./account-rate-limits-database-contract";

export type { AccountRateLimitsDatabase } from "./account-rate-limits-database-contract";

export function createAccountRateLimitsDatabase(): AccountRateLimitsDatabase {
  throw new Error("Account rate-limit database is Android only");
}
