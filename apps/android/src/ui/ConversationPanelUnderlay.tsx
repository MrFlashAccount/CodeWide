import { StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "../theme";

interface ConversationPanelUnderlayProps {
  style?: StyleProp<ViewStyle>;
  surfaceColor?: ColorValue;
}

/** Opaque chrome surface that keeps scrolling content visually stable. */
export function ConversationPanelUnderlay(
  props: ConversationPanelUnderlayProps,
): React.JSX.Element {
  const { style, surfaceColor = colors.conversationSurface } = props;
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
