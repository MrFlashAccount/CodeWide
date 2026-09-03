import type { V2QueryResult } from "@codewide/sync-client/v2";

import { colors } from "../../theme";
import type { ActionMenuItem } from "../../ui/ActionMenu";

type AccountsResult = Extract<V2QueryResult, { kind: "accounts.list" }>;
export type AccountProfile = AccountsResult["profiles"][number];

export function accountLoginSupported(result: V2QueryResult | null): boolean {
  if (result?.kind !== "capabilities.read") return false;
  return (
    result.commands.includes("account.login.start") &&
    result.commands.includes("account.login.cancel")
  );
}

export function accountActions(
  active: boolean,
  index: number,
  profile: AccountProfile,
  profilesCount: number,
): ActionMenuItem[] {
  return [
    {
      disabled: active || !profile.enabled,
      icon: "person-circle-outline",
      id: "activate",
      label: active ? "Active account" : "Switch to account",
      selected: active,
    },
    ...(index === 0
      ? []
      : [{ icon: "star-outline" as const, id: "make-primary", label: "Make primary" }]),
    ...(profilesCount > 2 && index > 0
      ? [{ icon: "arrow-up" as const, id: "move-up", label: "Move earlier" }]
      : []),
    ...(profilesCount > 2 && index < profilesCount - 1
      ? [{ icon: "arrow-down" as const, id: "move-down", label: "Move later" }]
      : []),
    {
      icon: profile.enabled ? "pause-circle-outline" : "play-circle-outline",
      id: "toggle-enabled",
      label: profile.enabled ? "Disable fallback" : "Enable fallback",
      selected: profile.enabled,
    },
    ...(!active
      ? [
          {
            destructive: true,
            icon: "trash-outline" as const,
            id: "remove",
            label: "Remove account",
          },
        ]
      : []),
  ];
}

export function accountColor(active: boolean, profile: AccountProfile): string {
  if (active) return colors.green;
  if (profile.exhaustedUntil !== null || profile.exhaustedIndefinitely) return colors.red;
  return colors.textDim;
}

export function accountLimitLabel(profile: AccountProfile): string {
  if (profile.weeklyLimit !== null)
    return `${Math.round(profile.weeklyLimit.remainingPercent)}% left`;
  if (profile.exhaustedIndefinitely) return "Limit reached";
  return "Usage pending";
}
