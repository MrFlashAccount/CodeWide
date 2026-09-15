import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize, spacing } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./JumpToLatest.styles";
import type { JumpToLatestProps } from "./JumpToLatestContract";

export function JumpToLatest({
  newItemCount,
  bottomChromeHeight,
  jumpTimelineToLatest,
}: JumpToLatestProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        newItemCount > 0 ? `Jump to latest, ${newItemCount} new turns` : "Jump to latest"
      }
      testID="jump-to-latest"
      style={({ pressed }) => [
        styles.jumpToLatest,
        { bottom: bottomChromeHeight + spacing.xs },
        pressed && styles.pressed,
      ]}
      onPress={jumpTimelineToLatest}
    >
      <Ionicons name="chevron-down" size={iconSize.navigation} color={colors.onPrimaryContainer} />
      {newItemCount > 0 && (
        <View style={styles.jumpToLatestBadge}>
          <Text accessibilityLiveRegion="polite" style={styles.jumpToLatestBadgeText}>
            {newItemCount > 99 ? "99+" : newItemCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
