/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { PairingSession } from "./pairingSession";

export function PairingSuccess({
  emoji,
  displayName,
}: Pick<PairingSession, "emoji" | "displayName">) {
  return (
    <View style={styles.pairingSuccess}>
      <View style={styles.pairingSuccessIcon}>
        <Ionicons name="checkmark" size={iconSize.illustration} color={colors.onPrimary} />
      </View>
      <Text numberOfLines={2} ellipsizeMode="tail" style={styles.pairingSuccessTitle}>
        {emoji} {displayName}
      </Text>
      <Text style={styles.pairingHint}>Connected. Syncing your threads now.</Text>
    </View>
  );
}
