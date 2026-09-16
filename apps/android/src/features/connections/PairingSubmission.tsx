/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { ConnectionSheetSessionProps } from "./connectionSheetContract";
import type { PairingSession } from "./pairingSession";

/** Shared retry and admission affordance for reviewed and manual pairing. */
export function PairingSubmission({
  accessibilityLabel,
  error,
  localError,
  localReady,
  onRetryStartup,
  save,
  saving,
}: Pick<PairingSession, "error" | "save"> &
  Pick<ConnectionSheetSessionProps, "localError" | "onRetryStartup" | "saving" | "localReady"> & {
    accessibilityLabel: string;
  }) {
  return (
    <>
      {(error ?? localError) !== null && (
        <View style={styles.pairingError}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={iconSize.action} />
          <Text style={[styles.errorText, styles.flex]}>{error ?? localError}</Text>
          {localError !== null && (
            <Pressable
              accessibilityLabel="Retry local startup"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => void onRetryStartup()}
            >
              <Ionicons color={colors.text} name="refresh" size={iconSize.action} />
            </Pressable>
          )}
        </View>
      )}
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={saving || !localReady}
        onPress={() => void save()}
        style={[styles.pairingPrimaryAction, (saving || !localReady) && styles.disabled]}
      >
        {saving ? (
          <ActivityIndicator color={colors.onPrimary} size="small" />
        ) : (
          <Ionicons color={colors.onPrimary} name="link" size={iconSize.action} />
        )}
        <Text style={styles.pairingPrimaryText}>
          {saving
            ? "Securing this device…"
            : localReady
              ? "Connect"
              : localError === null
                ? "Preparing local storage…"
                : "Local storage unavailable"}
        </Text>
      </Pressable>
    </>
  );
}
