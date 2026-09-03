import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { colors, radii, touchTarget } from "../../theme";

interface BrowserToolbarButtonProps {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  pending?: boolean;
  selected?: boolean;
}

export function BrowserToolbarButton(props: BrowserToolbarButtonProps): React.JSX.Element {
  const { disabled = false, icon, label, onPress, pending = false, selected = false } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, selected && styles.selected, disabled && styles.disabled]}
    >
      <Ionicons color={selected ? colors.accent : colors.textMuted} name={icon} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  disabled: { opacity: 0.34 },
  selected: { backgroundColor: colors.surfaceRaised },
});
