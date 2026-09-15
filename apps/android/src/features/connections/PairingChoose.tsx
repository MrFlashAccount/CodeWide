/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { PairingSession } from "./pairingSession";

export function PairingChoose({
  error,
  openPairingScanner,
  pasteCode,
  setMode,
  setError,
}: Pick<PairingSession, "error" | "openPairingScanner" | "pasteCode" | "setMode" | "setError">) {
  return (
    <View style={styles.pairingBody}>
      <View style={styles.pairingHeroIcon}>
        <Ionicons name="link" size={iconSize.illustration} color={colors.primary} />
      </View>
      <Text style={styles.pairingLead}>
        Connect this phone to Codex running on another machine.
      </Text>
      <Text style={styles.pairingHint}>
        On the host, run <Text style={styles.pairingCode}>codewide-host pair</Text>. Then scan or
        paste the one-time link.
      </Text>
      <View style={styles.pairingActionStack}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan pairing QR"
          onPress={() => void openPairingScanner()}
          style={styles.pairingPrimaryAction}
        >
          <Ionicons name="qr-code-outline" size={iconSize.navigation} color={colors.onPrimary} />
          <Text style={styles.pairingPrimaryText}>Scan QR code</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste connection link"
          onPress={() => void pasteCode()}
          style={styles.pairingSecondaryAction}
        >
          <Ionicons name="clipboard-outline" size={iconSize.action} color={colors.text} />
          <Text style={styles.pairingSecondaryText}>Paste connection link</Text>
        </Pressable>
      </View>
      {error !== null && (
        <View style={styles.pairingError}>
          <Ionicons name="alert-circle-outline" size={iconSize.action} color={colors.red} />
          <Text style={[styles.errorText, styles.flex]}>{error}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open manual server setup"
        onPress={() => {
          setMode("manual");
          setError(null);
        }}
        style={styles.pairingTextAction}
      >
        <Text style={styles.pairingTextActionLabel}>Advanced manual setup</Text>
        <Ionicons name="chevron-forward" size={iconSize.inline} color={colors.textMuted} />
      </Pressable>
      <View style={styles.pairingSafety}>
        <Ionicons name="shield-checkmark-outline" size={iconSize.inline} color={colors.green} />
        <Text style={styles.pairingSafetyText}>
          One-time code · device-bound credentials · revocable access
        </Text>
      </View>
    </View>
  );
}
