import type { GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.147.0/v2";

export type AccountPoolProfile = {
  id: string;
  email: string | null;
  planType: string | null;
  priority: number;
  enabled: boolean;
  active: boolean;
  exhaustedUntil: number | null;
  exhaustedIndefinitely: boolean;
  rateLimits: GetAccountRateLimitsResponse | null;
  rateLimitsUpdatedAt: number | null;
  rateLimitsError: string | null;
  lastUsedAt: number | null;
};

export type AccountPoolSnapshot = {
  activeProfileId: string | null;
  profiles: AccountPoolProfile[];
  nextResetAt: number | null;
  allExhausted: boolean;
};

export type AccountLoginStart = {
  type: "chatgptDeviceCode";
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

export function accountProfileLabel(profile: AccountPoolProfile, index: number): string {
  return profile.email ?? `Account ${index + 1}`;
}
