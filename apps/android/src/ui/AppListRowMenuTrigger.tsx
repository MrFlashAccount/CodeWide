import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, type GestureResponderEvent } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, touchTarget } from "../theme";

/** Standard overflow trigger for independently actionable list-row menus. */
export function AppListRowMenuTrigger({
  accessibilityLabel,
  onPress,
}: {
  readonly accessibilityLabel: string;
  readonly onPress?: (event: GestureResponderEvent) => void;
}): React.JSX.Element {
  const press = useEvent((event: GestureResponderEvent): void => {
    onPress?.(event);
  });
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress === undefined ? undefined : press}
      style={styles.button}
    >
      <Ionicons color={colors.textDim} name="ellipsis-vertical" size={iconSize.action} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
});
