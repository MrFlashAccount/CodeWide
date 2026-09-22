import type {
  ConsumeAccountRateLimitResetCreditOutcome,
  GetAccountRateLimitsResponse,
} from "@codewide/codex-protocol/v0.155.1/v2";

export type AccountPoolProfile = {
  active: boolean;
  email: string | null;
  enabled: boolean;
  exhaustedIndefinitely: boolean;
  exhaustedUntil: number | null;
  id: string;
  lastUsedAt: number | null;
  planType: string | null;
  priority: number;
  rateLimits: GetAccountRateLimitsResponse | null;
  rateLimitsError: string | null;
  rateLimitsUpdatedAt: number | null;
};

export type AccountPoolSnapshot = {
  activeProfileId: string | null;
  allExhausted: boolean;
  nextResetAt: number | null;
  profiles: AccountPoolProfile[];
};

export type AccountResetCreditConsumption = {
  accountPool: AccountPoolSnapshot;
  outcome: ConsumeAccountRateLimitResetCreditOutcome;
};

export type AccountLoginStart = {
  loginId: string;
  type: "chatgptDeviceCode";
  userCode: string;
  verificationUrl: string;
};

export function accountProfileLabel(profile: AccountPoolProfile, index: number): string {
  return profile.email ?? `Account ${String(index + 1)}`;
}
