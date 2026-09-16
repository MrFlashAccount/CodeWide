import { useEvent } from "../../react/useEvent";
import type { AccountPoolProps } from "./accountCapabilities";
import { useAccountLogin } from "./accountLogin";
import { AccountLoginSheet } from "./AccountLoginSheet";
import { AccountProfileRow } from "./AccountProfileRow";
/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";

export function AccountPoolEditor({
  accountPool,
  connectionId,
  onActivate,
  onCancelLogin,
  onRefresh,
  onRemove,
  onStartLogin,
  onUpdate,
}: AccountPoolProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <>
      <View style={styles.accountPoolEditor}>
        <View style={styles.accountPoolHeader}>
          <View style={styles.flex}>
            <Text style={styles.fieldLabel}>Codex accounts</Text>
            <Text style={styles.menuActionSubtitle}>
              Manual selection · automatic fallback on limit
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Refresh Codex accounts"
            disabled={busy}
            onPress={() => {
              run(async () => onRefresh(connectionId));
            }}
            style={[styles.connectionMiniButton, busy && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Ionicons color={colors.textMuted} name="refresh" size={iconSize.action} />
            )}
          </Pressable>
        </View>
        {profiles.length === 0 && (
          <Text style={styles.menuNotice}>
            {accountPool === null
              ? "Account data is not available yet. Refresh to try again."
              : "No Codex accounts connected."}
          </Text>
        )}
        {profiles.map((profile, index) => (
          <AccountProfileRow
            busy={busy}
            connectionId={connectionId}
            count={profiles.length}
            index={index}
            key={profile.id}
            onActivate={onActivate}
            onRemove={onRemove}
            onUpdate={onUpdate}
            profile={profile}
            run={run}
          />
        ))}
        {accountPool?.allExhausted === true && (
          <Text style={styles.errorText}>All configured accounts are exhausted.</Text>
        )}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            run(addAccount);
          }}
          style={[styles.secondaryButton, styles.accountPoolAddButton, busy && styles.disabled]}
        >
          <Ionicons color={colors.text} name="person-add-outline" size={iconSize.inline} />
          <Text style={styles.secondaryButtonText}>Add Codex account</Text>
        </Pressable>
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
