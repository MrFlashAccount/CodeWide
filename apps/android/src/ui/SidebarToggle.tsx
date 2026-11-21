import { Pressable, StyleSheet } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { colors, controlSize, iconSize } from "../theme";
/** The shared outline sidebar control for wide review workspaces. */
export function SidebarToggle({
  onToggle,
  open,
  testID,
}: {
  readonly onToggle: () => void;
  readonly open: boolean;
  readonly testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={open ? "Hide file list" : "Show file list"}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      android_ripple={{ color: colors.surfaceContainerHigh }}
      onPress={onToggle}
      style={styles.button}
      testID={testID}
    >
      <Svg
        fill="none"
        height={iconSize.action}
        stroke={colors.text}
        strokeWidth={2}
        viewBox="0 0 24 24"
        width={iconSize.action}
      >
        <Rect height={16} rx={2} width={19} x={2.5} y={4} />
        <Path d="M9 4v16" />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.regular,
  },
});
