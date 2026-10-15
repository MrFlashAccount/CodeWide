/** The square Fast mode switch that sits beside a model row. */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";

import { colors, iconSize, layoutSize, radii } from "../theme";

/** Switches Fast mode; `enabled` is the shown state, `onToggle` flips it. */
export function FastModeToggle({
  enabled,
  onToggle,
}: {
  readonly enabled: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityLabel="Fast mode"
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      onPress={onToggle}
      style={[styles.button, enabled && styles.buttonActive]}
    >
      <Ionicons
        color={enabled ? colors.onPrimary : colors.textMuted}
        name={enabled ? "flash" : "flash-outline"}
        size={iconSize.action}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    height: layoutSize.header,
    justifyContent: "center",
    width: layoutSize.header,
  },
  buttonActive: {
    backgroundColor: colors.accent,
  },
});
