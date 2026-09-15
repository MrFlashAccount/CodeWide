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
  error,
  localError,
  onRetryStartup,
  saving,
  localReady,
  save,
  accessibilityLabel,
}: Pick<PairingSession, "error" | "save"> &
  Pick<ConnectionSheetSessionProps, "localError" | "onRetryStartup" | "saving" | "localReady"> & {
    accessibilityLabel: string;
  }) {
  return (
    <>
      {(error ?? localError) !== null && (
        <View style={styles.pairingError}>
          <Ionicons name="alert-circle-outline" size={iconSize.action} color={colors.red} />
          <Text style={[styles.errorText, styles.flex]}>{error ?? localError}</Text>
          {localError !== null && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry local startup"
              hitSlop={8}
              onPress={() => void onRetryStartup()}
            >
              <Ionicons name="refresh" size={iconSize.action} color={colors.text} />
            </Pressable>
          )}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        disabled={saving || !localReady}
        onPress={() => void save()}
        style={[styles.pairingPrimaryAction, (saving || !localReady) && styles.disabled]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Ionicons name="link" size={iconSize.action} color={colors.onPrimary} />
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
