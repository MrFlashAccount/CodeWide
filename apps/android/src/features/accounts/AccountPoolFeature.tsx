import { useEvent } from "../../react/useEvent";
import type { AccountPoolProps } from "./accountCapabilities";
import { useAccountLogin } from "./accountLogin";
import { AccountLoginSheet } from "./AccountLoginSheet";
import { AccountProfileRow } from "./AccountProfileRow";
/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { accountPoolOwner } from "../../data/agentProviders";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { SettingsGroupHeader } from "../../ui/SettingsGroupHeader";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";

export function AccountPoolEditor({
  accountPool,
  agentProviders,
  connectionId,
  onActivate,
  onCancelLogin,
  onConsumeResetCredit,
  onRefresh,
  onRemove,
  onStartLogin,
  onUpdate,
}: AccountPoolProps) {
  const dialog = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useSelector(() => accountPoolOwner(agentProviders?.state$[connectionId]?.get()));
  const profiles = accountPool?.profiles ?? [];
  const profileIds = profiles
    .map((profile) => profile.id)
    .sort()
    .join("|");
  const {
    addAccount,
    closeAccountLogin,
    codeCopied,
    copyAccountCode,
    loginActionBusy,
    openAccountSignIn,
    pendingAccountLogin,
  } = useAccountLogin({ connectionId, onCancelLogin, onStartLogin }, profileIds, setError);

  const run = useEvent((operation: () => Promise<unknown>): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    operation().then(
      () => {
        setBusy(false);
      },
      (error: unknown) => {
        setError(error instanceof Error ? error.message : "Account operation failed");
        setBusy(false);
      },
    );
  });
  const refreshAccounts = useEvent(() => {
    run(async () => onRefresh(connectionId));
  });
  const explainFallback = useEvent(() => {
    dialog.alert(
      "Account switching",
      "New turns use the active account. When it reaches a usage limit, CodeWide switches to the next backup account automatically.",
      [{ text: "OK" }],
    );
  });
  const startAddingAccount = useEvent(() => {
    run(addAccount);
  });
  return (
    <>
      <View style={styles.accountPoolEditor}>
        <SettingsGroupHeader
          leading={
            owner === null ? undefined : (
              <ProviderIcon color={colors.textMuted} provider={owner.id} size={iconSize.inline} />
            )
          }
          title={`${owner?.name ?? "Codex"} accounts`}
          trailing={
            <>
              <Pressable
                accessibilityLabel="How account switching works"
                onPress={explainFallback}
                style={styles.connectionMiniButton}
              >
                <Ionicons
                  color={colors.textMuted}
                  name="information-circle-outline"
                  size={iconSize.action}
                />
              </Pressable>
              <Pressable
                accessibilityLabel="Refresh Codex accounts"
                disabled={busy}
                onPress={refreshAccounts}
                style={[styles.connectionMiniButton, busy && styles.disabled]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.textMuted} size="small" />
                ) : (
                  <Ionicons color={colors.textMuted} name="refresh" size={iconSize.action} />
                )}
              </Pressable>
            </>
          }
        />
        {profiles.length === 0 && (
          <Text style={styles.menuNotice}>
            {accountPool === null
              ? "Account data is not available yet. Refresh to try again."
              : "No Codex accounts connected."}
          </Text>
        )}
        {accountPool?.allExhausted === true && (
          <Text style={styles.errorText}>All configured accounts are exhausted.</Text>
        )}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
        {profiles.map((profile, index) => (
          <AccountProfileRow
            busy={busy}
            connectionId={connectionId}
            count={profiles.length}
            index={index}
            key={profile.id}
            onActivate={onActivate}
            onConsumeResetCredit={onConsumeResetCredit}
            onRemove={onRemove}
            onUpdate={onUpdate}
            profile={profile}
            run={run}
          />
        ))}
        <AppListRow
          accessibilityLabel="Add Codex account"
          disabled={busy}
          fixedHeight={listRowHeight.single}
          leadingIcon={{ color: colors.textMuted, name: "add", size: iconSize.action }}
          onPress={startAddingAccount}
          position={profiles.length === 0 ? "only" : "last"}
          testID="add-codex-account"
          title="Add Codex account"
        />
      </View>
      {pendingAccountLogin !== null && (
        <AccountLoginSheet
          closeAccountLogin={closeAccountLogin}
          codeCopied={codeCopied}
          copyAccountCode={copyAccountCode}
          loginActionBusy={loginActionBusy}
          openAccountSignIn={openAccountSignIn}
          userCode={pendingAccountLogin.userCode}
        />
      )}
    </>
  );
}
