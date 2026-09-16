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
  setError,
  setMode,
}: Pick<PairingSession, "error" | "openPairingScanner" | "pasteCode" | "setMode" | "setError">) {
  return (
    <View style={styles.pairingBody}>
      <View style={styles.pairingHeroIcon}>
        <Ionicons color={colors.primary} name="link" size={iconSize.illustration} />
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
          accessibilityLabel="Scan pairing QR"
          accessibilityRole="button"
          onPress={() => void openPairingScanner()}
          style={styles.pairingPrimaryAction}
        >
          <Ionicons color={colors.onPrimary} name="qr-code-outline" size={iconSize.navigation} />
          <Text style={styles.pairingPrimaryText}>Scan QR code</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Paste connection link"
          accessibilityRole="button"
          onPress={() => void pasteCode()}
          style={styles.pairingSecondaryAction}
        >
          <Ionicons color={colors.text} name="clipboard-outline" size={iconSize.action} />
          <Text style={styles.pairingSecondaryText}>Paste connection link</Text>
        </Pressable>
      </View>
      {error !== null && (
        <View style={styles.pairingError}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={iconSize.action} />
          <Text style={[styles.errorText, styles.flex]}>{error}</Text>
        </View>
      )}
      <Pressable
        accessibilityLabel="Open manual server setup"
        accessibilityRole="button"
        onPress={() => {
          setMode("manual");
          setError(null);
        }}
        style={styles.pairingTextAction}
      >
        <Text style={styles.pairingTextActionLabel}>Advanced manual setup</Text>
        <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
      </Pressable>
      <View style={styles.pairingSafety}>
        <Ionicons color={colors.green} name="shield-checkmark-outline" size={iconSize.inline} />
        <Text style={styles.pairingSafetyText}>
          One-time code · device-bound credentials · revocable access
        </Text>
      </View>
    </View>
  );
}
