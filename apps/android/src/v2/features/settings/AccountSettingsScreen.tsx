import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useLiveQuery } from "../../application/react/useLiveQuery";
import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { V2QueryBoundary, type V2QueryAvailability } from "../shared/V2QueryBoundary";
import { AccountLoginControl } from "./AccountLoginControl";
import { AccountSettingsRow } from "./AccountSettingsRow";
import { accountLoginSupported } from "./accountSettingsPresentation";

interface AccountSettingsScreenProps {
  copyLoginCode(value: string): Promise<void>;
  openLoginUrl(value: string): Promise<void>;
  savedServerId: SavedServerId;
}

type AccountsResult = Extract<V2QueryResult, { kind: "accounts.list" }>;

interface AccountListProps extends AccountSettingsScreenProps {
  actionable: boolean;
  canStartLogin: boolean;
  loginActionable: boolean;
  loginCapabilityPending: boolean;
  onRefresh(): Promise<void>;
  result: AccountsResult;
}

const CAPABILITIES_QUERY = { kind: "capabilities.read" } as const;

export function AccountSettingsScreen(props: AccountSettingsScreenProps): React.JSX.Element {
  const { copyLoginCode, openLoginUrl, savedServerId } = props;
  const runtime = useV2Runtime();
  const capabilities = useLiveQuery(runtime, savedServerId, CAPABILITIES_QUERY);
  const canStartLogin = accountLoginSupported(capabilities.value);
  const renderAccounts = (
    result: AccountsResult,
    refresh: () => Promise<void>,
    availability: V2QueryAvailability,
  ) => {
    return (
      <AccountList
        actionable={availability.actionable}
        canStartLogin={canStartLogin}
        copyLoginCode={copyLoginCode}
        loginActionable={availability.actionable && capabilities.authority === "live"}
        loginCapabilityPending={capabilities.status === "loading"}
        onRefresh={refresh}
        openLoginUrl={openLoginUrl}
        result={result}
        savedServerId={savedServerId}
      />
    );
  };
  return (
    <V2QueryBoundary
      chrome="none"
      query={{ kind: "accounts.list" }}
      savedServerId={savedServerId}
      title="Accounts"
    >
      {renderAccounts}
    </V2QueryBoundary>
  );
}

function AccountList(props: AccountListProps): React.JSX.Element {
  const {
    actionable,
    canStartLogin,
    copyLoginCode,
    loginCapabilityPending,
    loginActionable,
    onRefresh,
    openLoginUrl,
    result,
    savedServerId,
  } = props;
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = useEvent(() => {
    setError(null);
    startRefresh(async () => {
      try {
        await onRefresh();
      } catch {
        setError("Could not refresh Codex accounts");
      }
    });
  });
  const close = useEvent(() => router.back());
  const showError = useEvent((message: string) => setError(message));
  const profileIds = result.profiles
    .map((profile) => profile.id)
    .toSorted()
    .join("\u001F");
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
          {refreshing ? (
            <ShimmerText style={styles.title} text="Codex accounts" />
          ) : (
            <Text style={styles.title}>Codex accounts</Text>
          )}
          <Text style={styles.subtitle}>Manual selection · automatic fallback on limit</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh Codex accounts"
          disabled={refreshing}
          onPress={refresh}
          style={styles.iconButton}
        >
          <Ionicons color={colors.textMuted} name="refresh" size={18} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {result.profiles.map((profile, index) => (
          <AccountSettingsRow
            actionable={actionable}
            key={profile.id}
            active={profile.id === result.activeProfileId}
            index={index}
            onError={showError}
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
        {error === null ? null : (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        )}
        {canStartLogin ? (
          <AccountLoginControl
            disabled={!loginActionable}
            key={profileIds}
            copyLoginCode={copyLoginCode}
            openLoginUrl={openLoginUrl}
            savedServerId={savedServerId}
          />
        ) : (
          <Text style={styles.notice}>
            {loginCapabilityPending
              ? "Checking account sign-in support…"
              : "Adding Codex accounts is unavailable on this server."}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
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
  notice: { color: colors.textMuted, ...typeScale.body },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  title: { color: colors.text, ...typeScale.title },
});
