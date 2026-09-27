/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

import type { PairingSession } from "./pairingSession";
import { ServerIcon } from "./ServerIcon";

export function PairingSuccess({
  displayName,
  iconId,
}: Pick<PairingSession, "iconId" | "displayName">) {
  return (
    <View style={styles.pairingSuccess}>
      <View style={styles.pairingSuccessIcon}>
        <Ionicons color={colors.onPrimary} name="checkmark" size={iconSize.illustration} />
      </View>
      <View style={styles.pairingSuccessIdentity}>
        <ServerIcon color={colors.text} iconId={iconId} metric="title" />
        <Text ellipsizeMode="tail" numberOfLines={2} style={styles.pairingSuccessTitle}>
          {displayName}
        </Text>
      </View>
      <Text style={styles.pairingHint}>Connected. Syncing your threads now.</Text>
    </View>
  );
}
