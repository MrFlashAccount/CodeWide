import { StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";

import { surfaceToneCanvasColor, useSurfaceTone } from "./surfaceTone";

interface ConversationPanelUnderlayProps {
  style?: StyleProp<ViewStyle>;
  surfaceColor?: ColorValue;
}

/** Opaque chrome surface that keeps scrolling content visually stable. */
export function ConversationPanelUnderlay(
  props: ConversationPanelUnderlayProps,
): React.JSX.Element {
  const tone = useSurfaceTone();
  const { style, surfaceColor = surfaceToneCanvasColor(tone) } = props;
  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={[styles.root, { backgroundColor: surfaceColor }, style]}
    />
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden" },
});
