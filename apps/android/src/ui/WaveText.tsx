import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { AppText as Text } from "./Typography";

interface WaveTextProps {
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  style: StyleProp<TextStyle>;
  testID?: string;
  text: string;
}

/**
 * Active-state label: ordinary native text with the geometry-neutral shimmer
 * decoration. TextShimmer owns reduced motion and the performance experiment.
 */
export function WaveText(props: WaveTextProps) {
  const { containerStyle, numberOfLines = 1, style, testID = "active-text-shimmer", text } = props;
  return (
    <View
      accessibilityLabel={text}
      accessibilityRole="text"
      accessible
      style={[styles.shell, containerStyle]}
      testID={testID}
    >
      <Text
        accessible={false}
        ellipsizeMode="tail"
        numberOfLines={numberOfLines}
        shimmering
        style={[style, styles.textGeometry]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignSelf: "center",
    flexShrink: 1,
    justifyContent: "center",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  textGeometry: { includeFontPadding: false },
});
