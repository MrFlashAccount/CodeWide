import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, View } from "react-native";
import { colors, iconSize, spacing } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./JumpToLatest.styles";
import type { JumpToLatestProps } from "./JumpToLatestContract";

export function JumpToLatest({
  bottomChromeHeight,
  jumpTimelineToLatest,
  jumpVisibility,
  newItemCount,
}: JumpToLatestProps) {
  const visible = useSelector(jumpVisibility.visible$);
  if (!visible) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={
        newItemCount > 0 ? `Jump to latest, ${String(newItemCount)} new turns` : "Jump to latest"
      }
      accessibilityRole="button"
      onPress={jumpTimelineToLatest}
      style={({ pressed }) => [
        styles.jumpToLatest,
        { bottom: bottomChromeHeight + spacing.xs },
        pressed && styles.pressed,
      ]}
      testID="jump-to-latest"
    >
      <Ionicons color={colors.onPrimaryContainer} name="chevron-down" size={iconSize.navigation} />
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
