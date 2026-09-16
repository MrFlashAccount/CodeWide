import type { AccountRateLimitsRow } from "./account-rate-limits";
import type { AccountUsageSource } from "./account-usage-presentation";

export interface AccountUsageServer {
  readonly id: string;
  readonly name: string;
}

/** Selects the account rows represented by a single-server or aggregate thread list. */
export function threadListAccountUsageSources(
  servers: readonly AccountUsageServer[],
  selectedServerId: string | null,
  rateLimits: readonly AccountRateLimitsRow[],
): AccountUsageSource[] {
  const result: AccountUsageSource[] = [];
  for (const server of servers) {
    if (selectedServerId !== null && server.id !== selectedServerId) {
      continue;
    }
    result.push({
      id: server.id,
      name: server.name,
      rateLimits: rateLimits.find((row) => row.connectionId === server.id) ?? null,
    });
  }
  return result;
}
