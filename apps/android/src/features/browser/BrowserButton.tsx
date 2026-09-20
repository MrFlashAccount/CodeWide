import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { styles } from "./InternalBrowser.styles";

export function BrowserButton({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={colors.textMuted} name={icon} size={iconSize.action} />
    </Pressable>
  );
}
