/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { accountProfileLabel, type AccountPoolSnapshot } from "../../data/account-pool";
import { selectWeeklyRateLimit } from "../../data/account-rate-limits";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";

import type { AccountPoolProps } from "./accountCapabilities";

export function AccountProfileRow({
  profile,
  index,
  count,
  busy,
  connectionId,
  onActivate,
  onUpdate,
  onRemove,
  run,
}: Pick<AccountPoolProps, "connectionId" | "onActivate" | "onUpdate" | "onRemove"> & {
  profile: AccountPoolSnapshot["profiles"][number];
  index: number;
  count: number;
  busy: boolean;
  run(operation: () => Promise<unknown>): Promise<void>;
}) {
  const label = accountProfileLabel(profile, index);
  const weekly = selectWeeklyRateLimit(profile.rateLimits);
  const limitLabel =
    weekly !== null
      ? `${Math.round(weekly.remainingPercent)}% left`
      : profile.exhaustedIndefinitely
        ? "Limit reached"
        : "Usage pending";
  const actions: ActionMenuItem[] = [
    {
      id: "activate",
      label: profile.active ? "Active account" : "Switch to account",
      icon: "person-circle-outline",
      selected: profile.active,
      disabled: profile.active || !profile.enabled,
    },
    ...(index === 0
      ? []
      : [{ id: "make-primary", label: "Make primary", icon: "star-outline" as const }]),
    ...(count > 2 && index > 0
      ? [{ id: "move-up", label: "Move earlier", icon: "arrow-up" as const }]
      : []),
    ...(count > 2 && index < count - 1
      ? [{ id: "move-down", label: "Move later", icon: "arrow-down" as const }]
      : []),
    {
      id: "toggle-enabled",
      label: profile.enabled ? "Disable fallback" : "Enable fallback",
      icon: profile.enabled ? "pause-circle-outline" : "play-circle-outline",
      selected: profile.enabled,
    },
    ...(!profile.active
      ? [
          {
            id: "remove",
            label: "Remove account",
            icon: "trash-outline" as const,
            destructive: true,
          },
        ]
      : []),
  ];
  const handleAction = (id: string) => {
    if (id === "activate") void run(async () => await onActivate(connectionId, profile.id));
    else if (id === "make-primary")
      void run(async () => await onUpdate(connectionId, profile.id, { priority: 0 }));
    else if (id === "move-up")
      void run(async () => await onUpdate(connectionId, profile.id, { priority: index - 1 }));
    else if (id === "move-down")
      void run(async () => await onUpdate(connectionId, profile.id, { priority: index + 1 }));
    else if (id === "toggle-enabled")
      void run(async () => await onUpdate(connectionId, profile.id, { enabled: !profile.enabled }));
    else if (id === "remove") void run(async () => await onRemove(connectionId, profile.id));
  };
  return (
    <AppListRow
      title={label}
      position={listRowPosition(index, count)}
      fixedHeight={listRowHeight.double}
      description={`${profile.planType ?? "Plan pending"} · ${index === 0 ? "Primary" : `Backup ${index}`}${profile.active ? " · Active" : ""}${profile.enabled ? "" : " · disabled"}`}
      leading={
        <View
          style={[
            styles.connectionStateDot,
            {
              backgroundColor: profile.active
                ? colors.green
                : profile.exhaustedUntil !== null || profile.exhaustedIndefinitely
                  ? colors.red
                  : colors.textDim,
            },
          ]}
        />
      }
      trailing={
        <>
          <Text
            numberOfLines={1}
            style={[styles.accountPoolLimit, weekly === null && styles.accountPoolLimitPending]}
          >
            {limitLabel}
          </Text>
          <ActionMenu
            accessibilityLabel={`Actions for ${label}`}
            actions={actions}
            onSelect={handleAction}
            style={styles.accountPoolMenuAnchor}
          >
            <Pressable
              accessibilityLabel={`Actions for ${label}`}
              disabled={busy}
              style={[styles.connectionMiniButton, busy && styles.disabled]}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={iconSize.action}
                color={colors.textMuted}
              />
            </Pressable>
          </ActionMenu>
        </>
      }
    />
  );
}
