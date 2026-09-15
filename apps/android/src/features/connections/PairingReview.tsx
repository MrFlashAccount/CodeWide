import { PairingSubmission } from "./PairingSubmission";
/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { ConnectionSheetSessionProps } from "./connectionSheetContract";
import type { PairingSession } from "./pairingSession";

export function PairingReview({
  emoji,
  displayName,
  setEmoji,
  setDisplayName,
  endpointLabel,
  minutesLeft,
  error,
  localError,
  onRetryStartup,
  saving,
  localReady,
  save,
  setMode,
}: Pick<
  PairingSession,
  | "emoji"
  | "displayName"
  | "setEmoji"
  | "setDisplayName"
  | "endpointLabel"
  | "minutesLeft"
  | "error"
  | "save"
  | "setMode"
> &
  Pick<ConnectionSheetSessionProps, "localError" | "onRetryStartup" | "saving" | "localReady">) {
  return (
    <View style={styles.pairingBody}>
      <View style={styles.pairingReviewCard}>
        <View style={styles.pairingIdentityRow}>
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
            selectTextOnFocus
            style={styles.pairingNameInput}
          />
        </View>
        <View style={styles.pairingServerMeta}>
          <Ionicons name="lock-closed-outline" size={iconSize.inline} color={colors.green} />
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.pairingEndpoint}>
            {endpointLabel}
          </Text>
        </View>
        <View style={styles.pairingServerMeta}>
          <Ionicons name="time-outline" size={iconSize.inline} color={colors.textMuted} />
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.pairingMetaText}>
            {minutesLeft === null ? "One-time connection" : `Code expires in ${minutesLeft} min`}
          </Text>
        </View>
      </View>
      <PairingSubmission
        error={error}
        localError={localError}
        onRetryStartup={onRetryStartup}
        saving={saving}
        localReady={localReady}
        save={save}
        accessibilityLabel="Connect server"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit connection details"
        disabled={saving}
        onPress={() => setMode("manual")}
        style={styles.pairingTextAction}
      >
        <Text style={styles.pairingTextActionLabel}>Edit details</Text>
        <Ionicons name="options-outline" size={iconSize.inline} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}
