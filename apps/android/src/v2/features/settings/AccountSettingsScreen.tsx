import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTransition } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { V2QueryResult } from "@codewide/sync-client/v2";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  typeTracking,
} from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";

interface AccountSettingsScreenProps {
  savedServerId: SavedServerId;
}

type AccountsResult = Extract<V2QueryResult, { kind: "accounts.list" }>;
type AccountProfile = AccountsResult["profiles"][number];

interface AccountListProps extends AccountSettingsScreenProps {
  result: AccountsResult;
  onRefresh(): Promise<void>;
}

interface AccountRowProps extends AccountSettingsScreenProps {
  active: boolean;
  index: number;
  onRefresh(): Promise<void>;
  profile: AccountProfile;
  profilesCount: number;
}

export function AccountSettingsScreen(props: AccountSettingsScreenProps): React.JSX.Element {
  const { savedServerId } = props;
  return (
    <V2QueryBoundary
      chrome="none"
      query={{ kind: "accounts.list" }}
      savedServerId={savedServerId}
      title="Accounts"
    >
      {(result, refresh) => {
        if (result.kind !== "accounts.list") return null;
        return <AccountList onRefresh={refresh} result={result} savedServerId={savedServerId} />;
      }}
    </V2QueryBoundary>
  );
}

function AccountList(props: AccountListProps): React.JSX.Element {
  const { onRefresh, result, savedServerId } = props;
  const [refreshing, startRefresh] = useTransition();
  const refresh = useEvent(() => startRefresh(() => onRefresh()));
  const close = useEvent(() => router.back());
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close Codex accounts"
          onPress={close}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="arrow-back" size={21} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Codex accounts</Text>
          <Text style={styles.subtitle}>Manual selection · automatic fallback on limit</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh Codex accounts"
          disabled={refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          {refreshing ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <Ionicons color={colors.textMuted} name="refresh" size={18} />
          )}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {result.profiles.map((profile, index) => (
          <AccountRow
            key={profile.id}
            active={profile.id === result.activeProfileId}
            index={index}
            onRefresh={onRefresh}
            profile={profile}
            profilesCount={result.profiles.length}
            savedServerId={savedServerId}
          />
        ))}
        {result.profiles.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons color={colors.textDim} name="people-outline" size={28} />
            <Text style={styles.notice}>No Codex accounts configured.</Text>
          </View>
        ) : null}
        {result.allExhausted ? (
          <Text style={styles.error}>All configured accounts are exhausted.</Text>
        ) : null}
        <Pressable accessibilityState={{ disabled: true }} disabled style={styles.addButton}>
          <Ionicons color={colors.textDim} name="person-add-outline" size={17} />
          <Text style={styles.addButtonText}>Add Codex account</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function AccountRow(props: AccountRowProps): React.JSX.Element {
  const { active, index, onRefresh, profile, profilesCount, savedServerId } = props;
  const runtime = useV2Runtime();
  const [busy, startAction] = useTransition();
  const label = profile.email ?? `Account ${index + 1}`;
  const select = useEvent((id: string) => {
    startAction(async () => {
      if (id === "activate") {
        await runtime.commands.execute(savedServerId, {
          change: { kind: "activate", profileId: profile.id },
          kind: "account.update",
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
        await runtime.commands.execute(savedServerId, {
          change: { kind: "remove", profileId: profile.id },
          kind: "account.update",
        });
      }
      await onRefresh();
    });
  });
  const actions: ActionMenuItem[] = [
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
        {limitLabel(profile)}
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.textMuted} size="small" />
      ) : (
        <ActionMenu
          accessibilityLabel={`Actions for ${label}`}
          actions={actions}
          onSelect={select}
          style={styles.menuAnchor}
        >
          <Pressable accessibilityLabel={`Actions for ${label}`} style={styles.iconButton}>
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
  await runtime.commands.execute(savedServerId, {
    change: { enabled, kind: "configure", priority, profileId: profile.id },
    kind: "account.update",
  });
}

function accountColor(active: boolean, profile: AccountProfile): string {
  if (active) return colors.green;
  if (profile.exhaustedUntil !== null || profile.exhaustedIndefinitely) return colors.red;
  return colors.textDim;
}

function limitLabel(profile: AccountProfile): string {
  if (profile.weeklyLimit !== null)
    return `${Math.round(profile.weeklyLimit.remainingPercent)}% left`;
  if (profile.exhaustedIndefinitely) return "Limit reached";
  return "Usage pending";
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    borderColor: colors.borderSoft,
    borderRadius: radii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: touchTarget,
    opacity: 0.5,
  },
  addButtonText: { color: colors.textMuted, ...typeScale.body },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  divider: { borderTopColor: colors.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
  dot: { borderRadius: 4, height: 8, width: 8 },
  empty: { alignItems: "center", gap: spacing.sm, justifyContent: "center", minHeight: 160 },
  error: { color: colors.red, paddingVertical: spacing.sm },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  headerText: { flex: 1, minWidth: 0 },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  limit: { color: colors.textMuted, ...typeScale.caption },
  menuAnchor: { height: touchTarget, width: touchTarget },
  notice: { color: colors.textMuted, ...typeScale.body },
  role: {
    color: colors.textDim,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
  },
  roleActive: { color: colors.green },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
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
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  title: { color: colors.text, ...typeScale.title },
});
