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
  connectionId,
  accountPool,
  onRefresh,
  onStartLogin,
  onCancelLogin,
  onActivate,
  onUpdate,
  onRemove,
}: AccountPoolProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profiles = accountPool?.profiles ?? [];
  const profileIds = profiles
    .map((profile) => profile.id)
    .sort()
    .join("|");
  const {
    pendingAccountLogin,
    codeCopied,
    loginActionBusy,
    addAccount,
    closeAccountLogin,
    copyAccountCode,
    openAccountSignIn,
  } = useAccountLogin({ connectionId, onStartLogin, onCancelLogin }, profileIds, setError);

  const run = useEvent(async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account operation failed");
    }
    setBusy(false);
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
            onPress={() => void run(async () => await onRefresh(connectionId))}
            style={[styles.connectionMiniButton, busy && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Ionicons name="refresh" size={iconSize.action} color={colors.textMuted} />
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
            key={profile.id}
            profile={profile}
            index={index}
            count={profiles.length}
            busy={busy}
            connectionId={connectionId}
            onActivate={onActivate}
            onUpdate={onUpdate}
            onRemove={onRemove}
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
          onPress={() => void run(addAccount)}
          style={[styles.secondaryButton, styles.accountPoolAddButton, busy && styles.disabled]}
        >
          <Ionicons name="person-add-outline" size={iconSize.inline} color={colors.text} />
          <Text style={styles.secondaryButtonText}>Add Codex account</Text>
        </Pressable>
      </View>
      {pendingAccountLogin !== null && (
        <AccountLoginSheet
          userCode={pendingAccountLogin.userCode}
          codeCopied={codeCopied}
          loginActionBusy={loginActionBusy}
          closeAccountLogin={closeAccountLogin}
          copyAccountCode={copyAccountCode}
          openAccountSignIn={openAccountSignIn}
        />
      )}
    </>
  );
}
