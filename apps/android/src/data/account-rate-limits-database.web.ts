import type { AccountRateLimitsDatabase } from "./account-rate-limits-database.native";

export type { AccountRateLimitsDatabase } from "./account-rate-limits-database.native";

export function createAccountRateLimitsDatabase(): AccountRateLimitsDatabase {
  throw new Error("Account rate-limit database is Android only");
}
