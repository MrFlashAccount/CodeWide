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
  busy,
  connectionId,
  count,
  index,
  onActivate,
  onRemove,
  onUpdate,
  profile,
  run,
}: Pick<AccountPoolProps, "connectionId" | "onActivate" | "onUpdate" | "onRemove"> & {
  busy: boolean;
  count: number;
  index: number;
  profile: AccountPoolSnapshot["profiles"][number];
  run: (operation: () => Promise<unknown>) => void;
}) {
  const label = accountProfileLabel(profile, index);
  const weekly = selectWeeklyRateLimit(profile.rateLimits);
  const limitLabel =
    weekly !== null
      ? `${String(Math.round(weekly.remainingPercent))}% left`
      : profile.exhaustedIndefinitely
        ? "Limit reached"
        : "Usage pending";
  const actions: ActionMenuItem[] = [
    {
      disabled: profile.active || !profile.enabled,
      icon: "person-circle-outline",
      id: "activate",
      label: profile.active ? "Active account" : "Switch to account",
      selected: profile.active,
    },
    ...(index === 0
      ? []
      : [{ icon: "star-outline" as const, id: "make-primary", label: "Make primary" }]),
    ...(count > 2 && index > 0
      ? [{ icon: "arrow-up" as const, id: "move-up", label: "Move earlier" }]
      : []),
    ...(count > 2 && index < count - 1
      ? [{ icon: "arrow-down" as const, id: "move-down", label: "Move later" }]
      : []),
    {
      icon: profile.enabled ? "pause-circle-outline" : "play-circle-outline",
      id: "toggle-enabled",
      label: profile.enabled ? "Disable fallback" : "Enable fallback",
      selected: profile.enabled,
    },
    ...(!profile.active
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
  const handleAction = (id: string) => {
    if (id === "activate") {
      run(async () => onActivate(connectionId, profile.id));
    } else if (id === "make-primary") {
      run(async () => onUpdate(connectionId, profile.id, { priority: 0 }));
    } else if (id === "move-up") {
      run(async () => onUpdate(connectionId, profile.id, { priority: index - 1 }));
    } else if (id === "move-down") {
      run(async () => onUpdate(connectionId, profile.id, { priority: index + 1 }));
    } else if (id === "toggle-enabled") {
      run(async () => onUpdate(connectionId, profile.id, { enabled: !profile.enabled }));
    } else if (id === "remove") {
      run(async () => onRemove(connectionId, profile.id));
    }
  };
  return (
    <AppListRow
      description={`${profile.planType ?? "Plan pending"} · ${index === 0 ? "Primary" : `Backup ${String(index)}`}${profile.active ? " · Active" : ""}${profile.enabled ? "" : " · disabled"}`}
      fixedHeight={listRowHeight.double}
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
      position={listRowPosition(index, count)}
      title={label}
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
                color={colors.textMuted}
                name="ellipsis-horizontal"
                size={iconSize.action}
              />
            </Pressable>
          </ActionMenu>
        </>
      }
    />
  );
}
