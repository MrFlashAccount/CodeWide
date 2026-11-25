import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable } from "react-native";
import type { ActionMenuIconName } from "../../ui/ActionMenu.types";
import { colors, controlHitSlop, iconSize } from "../../theme";
import { styles } from "./DownloadsSheet.styles";

/** Compact icon action with its own accessible touch target. */
export function DownloadIconButton({
  icon,
  label,
  onPress,
}: {
  readonly icon: ActionMenuIconName;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons color={colors.textMuted} name={icon} size={iconSize.action} />
    </Pressable>
  );
}
