import { Ionicons } from "@expo/vector-icons";
import { useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, spacing, touchTarget, typeScale, typeTracking, typeWeight } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { updateAccount } from "./accountCommands";
import {
  accountActions,
  accountColor,
  accountLimitLabel,
  type AccountProfile,
} from "./accountSettingsPresentation";

interface AccountSettingsRowProps {
  actionable: boolean;
  active: boolean;
  index: number;
  onError(message: string): void;
  onRefresh(): Promise<void>;
  profile: AccountProfile;
  profilesCount: number;
  savedServerId: SavedServerId;
}

export function AccountSettingsRow(props: AccountSettingsRowProps): React.JSX.Element {
  const { actionable, active, index, onError, onRefresh, profile, profilesCount, savedServerId } =
    props;
  const runtime = useV2Runtime();
  const [busy, startAction] = useTransition();
  const label = profile.email ?? `Account ${index + 1}`;
  const select = useEvent((id: string) => {
    if (!actionable) return;
    startAction(async () => {
      try {
        if (id === "activate") {
          await updateAccount(runtime.commandActivations, savedServerId, {
            kind: "activate",
            profileId: profile.id,
          });
        } else if (id === "make-primary") {
          await configure(runtime, savedServerId, profile, profile.enabled, 0);
        } else if (id === "move-up") {
          await configure(runtime, savedServerId, profile, profile.enabled, index - 1);
        } else if (id === "move-down") {
          await configure(runtime, savedServerId, profile, profile.enabled, index + 1);
        } else if (id === "toggle-enabled") {
          await configure(runtime, savedServerId, profile, !profile.enabled, profile.priority);
        } else if (id === "remove") {
          await updateAccount(runtime.commandActivations, savedServerId, {
            kind: "remove",
            profileId: profile.id,
          });
        }
        await onRefresh();
      } catch (cause) {
        onError(errorMessage(cause));
      }
    });
  });
  const actions = accountActions(active, index, profile, profilesCount).map((action) => ({
    ...action,
    disabled: !actionable || action.disabled === true,
  }));
  return (
    <View style={[styles.row, index > 0 && styles.divider]}>
      <View style={[styles.dot, { backgroundColor: accountColor(active, profile) }]} />
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {label}
          </Text>
          <Text style={[styles.role, active && styles.roleActive]}>
            {index === 0
              ? `PRIMARY${active ? " · ACTIVE" : ""}`
              : `BACKUP ${index}${active ? " · ACTIVE" : ""}`}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.rowSubtitle}>
          {profile.plan ?? "Plan pending"}
          {profile.enabled ? "" : " · disabled"}
        </Text>
      </View>
      <Text numberOfLines={1} style={styles.limit}>
        {accountLimitLabel(profile)}
      </Text>
      {busy ? (
        <ShimmerText style={styles.busyText} text="Updating" />
      ) : (
        <ActionMenu
          accessibilityLabel={`Actions for ${label}`}
          actions={actions}
          onSelect={select}
          style={styles.menuAnchor}
        >
          <Pressable
            accessibilityLabel={`Actions for ${label}`}
            accessibilityState={{ disabled: !actionable }}
            disabled={!actionable}
            style={styles.iconButton}
          >
            <Ionicons color={colors.textMuted} name="ellipsis-horizontal" size={19} />
          </Pressable>
        </ActionMenu>
      )}
    </View>
  );
}

async function configure(
  runtime: ReturnType<typeof useV2Runtime>,
  savedServerId: SavedServerId,
  profile: AccountProfile,
  enabled: boolean,
  priority: number,
): Promise<void> {
  await updateAccount(runtime.commandActivations, savedServerId, {
    enabled,
    kind: "configure",
    priority,
    profileId: profile.id,
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "Could not update Codex account";
}

const styles = StyleSheet.create({
  busyText: { color: colors.textMuted, ...typeScale.caption },
  divider: { borderTopColor: colors.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
  dot: { borderRadius: 4, height: 8, width: 8 },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  limit: { color: colors.textMuted, ...typeScale.caption },
  menuAnchor: { height: touchTarget, width: touchTarget },
  role: {
    color: colors.textDim,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
  },
  roleActive: { color: colors.green },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.xs,
  },
  rowSubtitle: { color: colors.textMuted, ...typeScale.caption },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, flexShrink: 1, ...typeScale.body, fontWeight: typeWeight.medium },
  rowTitleLine: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
});
