import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { colors, iconSize } from "../../../theme";
import { styles } from "./InternalBrowser.styles";
export function BrowserButton({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={iconSize.action} color={colors.textMuted} />
    </Pressable>
  );
}
