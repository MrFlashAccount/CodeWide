import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { colors, controlHitSlop, controlSize, iconSize } from "../../../theme";

/** Previous or next stop; a compact control with hit slop up to a 48dp target. */
export function StripNav({
  direction,
  enabled,
  onPress,
}: {
  readonly direction: "back" | "forward";
  readonly enabled: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={direction === "back" ? "Previous stop" : "Next stop"}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={styles.nav}
    >
      <Ionicons
        color={enabled ? colors.text : colors.textDim}
        name={direction === "back" ? "chevron-back" : "chevron-forward"}
        size={iconSize.action}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
});
