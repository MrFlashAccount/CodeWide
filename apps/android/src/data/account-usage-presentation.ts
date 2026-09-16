import type { AccountPoolProfile } from "./account-pool";
import { accountProfileLabel } from "./account-pool";
import type { AccountRateLimitsRow } from "./account-rate-limits";

export interface AccountUsageSource {
  readonly id: string;
  readonly name: string;
  readonly rateLimits: AccountRateLimitsRow | null;
}

export interface AccountUsageProfile {
  readonly detail: string;
  readonly id: string;
  readonly label: string;
  readonly profile: AccountPoolProfile;
}

export function accountUsageProfiles(
  sources: readonly AccountUsageSource[],
): AccountUsageProfile[] {
  const aggregate = sources.length > 1;
  const result: AccountUsageProfile[] = [];
  for (const source of sources) {
    const profiles = source.rateLimits?.accountPool?.profiles ?? [];
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      if (profile === undefined) {
        continue;
      }
      result.push({
        detail: accountPlanLabel(profile.planType),
        id: JSON.stringify([source.id, profile.id]),
        label: `${accountProfileLabel(profile, index)}${aggregate ? ` · ${source.name}` : ""}`,
        profile,
      });
    }
  }
  return result;
}

function accountPlanLabel(plan: string | null): string {
  if (plan === null || plan === "unknown") {
    return "Plan unavailable";
  }
  const normalized = plan.replaceAll("_", " ");
  return normalized.replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());
}
