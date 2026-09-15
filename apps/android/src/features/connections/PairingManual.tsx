import { PairingSubmission } from "./PairingSubmission";
/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { colors } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { ConnectionSheetSessionProps } from "./connectionSheetContract";
import type { PairingSession } from "./pairingSession";

export function PairingManual({
  emoji,
  displayName,
  setEmoji,
  setDisplayName,
  endpoint,
  setEndpoint,
  token,
  setToken,
  tlsPinSha256,
  setTlsPinSha256,
  error,
  localError,
  onRetryStartup,
  saving,
  localReady,
  save,
}: Pick<
  PairingSession,
  | "emoji"
  | "displayName"
  | "setEmoji"
  | "setDisplayName"
  | "endpoint"
  | "setEndpoint"
  | "token"
  | "setToken"
  | "tlsPinSha256"
  | "setTlsPinSha256"
  | "error"
  | "save"
> &
  Pick<ConnectionSheetSessionProps, "localError" | "onRetryStartup" | "saving" | "localReady">) {
  return (
    <View style={styles.pairingBody}>
      <Text style={styles.pairingHint}>
        Use this only when QR and connection links are unavailable.
      </Text>
      <View style={styles.pairingIdentityFields}>
        <TextInput
          voiceInput={false}
          accessibilityLabel="Server emoji"
          value={emoji}
          onChangeText={setEmoji}
          style={styles.pairingEmojiInput}
        />
        <TextInput
          accessibilityLabel="Server name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Home workstation"
          placeholderTextColor={colors.textDim}
          style={[styles.fieldInput, styles.flex]}
        />
      </View>
      <Text style={styles.fieldLabel}>Secure endpoint</Text>
      <TextInput
        accessibilityLabel="Server endpoint"
        value={endpoint}
        onChangeText={setEndpoint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="wss://host.example/v1/sync"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldLabel}>One-time pairing token</Text>
      <TextInput
        accessibilityLabel="One-time pairing token"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="Paste token"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
      <TextInput
        voiceInput={false}
        accessibilityLabel="TLS certificate pin"
        value={tlsPinSha256}
        onChangeText={setTlsPinSha256}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="sha256/base64…"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
      />
      <PairingSubmission
        error={error}
        localError={localError}
        onRetryStartup={onRetryStartup}
        saving={saving}
        localReady={localReady}
        save={save}
        accessibilityLabel="Connect server manually"
      />
    </View>
  );
}
