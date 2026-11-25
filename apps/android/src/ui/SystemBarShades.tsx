import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../theme";

const TOP = ["top"] as const;
const BOTTOM = ["bottom"] as const;

/** Tints the system insets of the containing window without covering its controls or taking input. */
export function SystemBarShades(): React.JSX.Element {
  return (
    <>
      <SafeAreaView edges={TOP} pointerEvents="none" style={[styles.shade, styles.top]} />
      <SafeAreaView edges={BOTTOM} pointerEvents="none" style={[styles.shade, styles.bottom]} />
    </>
  );
}

const styles = StyleSheet.create({
  bottom: { bottom: 0 },
  shade: {
    backgroundColor: colors.systemBarShade,
    // Both shades span the window, including split-screen and foldable panes.
    left: 0,
    position: "absolute",
    right: 0,
  },
  top: { top: 0 },
});
