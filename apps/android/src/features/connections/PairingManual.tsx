import { PairingSubmission } from "./PairingSubmission";
/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { colors } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { ConnectionSheetSessionProps } from "./connectionSheetContract";
import type { PairingSession } from "./pairingSession";
import { ServerIconPicker } from "./ServerIconPicker";

export function PairingManual({
  displayName,
  endpoint,
  error,
  iconId,
  localError,
  localReady,
  onRetryStartup,
  save,
  saving,
  setDisplayName,
  setEndpoint,
  setIconId,
  setTlsPinSha256,
  setToken,
  tlsPinSha256,
  token,
}: Pick<
  PairingSession,
  | "iconId"
  | "displayName"
  | "setIconId"
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
        <ServerIconPicker
          accessibilityLabel="Choose server icon"
          iconId={iconId}
          onSelect={setIconId}
        />
        <TextInput
          accessibilityLabel="Server name"
          onChangeText={setDisplayName}
          placeholder="Home workstation"
          placeholderTextColor={colors.textDim}
          style={[styles.fieldInput, styles.flex]}
          value={displayName}
        />
      </View>
      <Text style={styles.fieldLabel}>Secure endpoint</Text>
      <TextInput
        accessibilityLabel="Server endpoint"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setEndpoint}
        placeholder="wss://host.example/v1/sync"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
        value={endpoint}
      />
      <Text style={styles.fieldLabel}>One-time pairing token</Text>
      <TextInput
        accessibilityLabel="One-time pairing token"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setToken}
        placeholder="Paste token"
        placeholderTextColor={colors.textDim}
        secureTextEntry
        style={styles.fieldInput}
        value={token}
      />
      <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
      <TextInput
        accessibilityLabel="TLS certificate pin"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setTlsPinSha256}
        placeholder="sha256/base64…"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
        value={tlsPinSha256}
        voiceInput={false}
      />
      <PairingSubmission
        accessibilityLabel="Connect server manually"
        error={error}
        localError={localError}
        localReady={localReady}
        onRetryStartup={onRetryStartup}
        save={save}
        saving={saving}
      />
    </View>
  );
}
