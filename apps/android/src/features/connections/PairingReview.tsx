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
  displayName,
  emoji,
  endpointLabel,
  error,
  localError,
  localReady,
  minutesLeft,
  onRetryStartup,
  save,
  saving,
  setDisplayName,
  setEmoji,
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
            accessibilityLabel="Server emoji"
            onChangeText={setEmoji}
            style={styles.pairingEmojiInput}
            value={emoji}
            voiceInput={false}
          />
          <TextInput
            accessibilityLabel="Server name"
            onChangeText={setDisplayName}
            selectTextOnFocus
            style={styles.pairingNameInput}
            value={displayName}
          />
        </View>
        <View style={styles.pairingServerMeta}>
          <Ionicons color={colors.green} name="lock-closed-outline" size={iconSize.inline} />
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.pairingEndpoint}>
            {endpointLabel}
          </Text>
        </View>
        <View style={styles.pairingServerMeta}>
          <Ionicons color={colors.textMuted} name="time-outline" size={iconSize.inline} />
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.pairingMetaText}>
            {minutesLeft === null
              ? "One-time connection"
              : `Code expires in ${String(minutesLeft)} min`}
          </Text>
        </View>
      </View>
      <PairingSubmission
        accessibilityLabel="Connect server"
        error={error}
        localError={localError}
        localReady={localReady}
        onRetryStartup={onRetryStartup}
        save={save}
        saving={saving}
      />
      <Pressable
        accessibilityLabel="Edit connection details"
        accessibilityRole="button"
        disabled={saving}
        onPress={() => {
          setMode("manual");
        }}
        style={styles.pairingTextAction}
      >
        <Text style={styles.pairingTextActionLabel}>Edit details</Text>
        <Ionicons color={colors.textMuted} name="options-outline" size={iconSize.inline} />
      </Pressable>
    </View>
  );
}
