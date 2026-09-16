import { View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { formatNumber } from "./number-format";
import { AppText as Text } from "./Typography";

export { compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./number-format";

export function AnimatedNumber({
  accessibilityLabel,
  containerStyle,
  format,
  prefix = "",
  style,
  suffix = "",
  testID,
  value,
}: {
  accessibilityLabel?: string;
  animate?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  format?: Intl.NumberFormatOptions;
  prefix?: string;
  style?: StyleProp<TextStyle>;
  suffix?: string;
  testID?: string;
  value: number;
}) {
  const renderedText = `${prefix}${formatNumber(value, format)}${suffix}`;
  return (
    <View
      accessibilityLabel={accessibilityLabel ?? renderedText}
      accessibilityRole="text"
      accessible
      style={containerStyle}
      testID={testID}
    >
      <Text style={style}>{renderedText}</Text>
    </View>
  );
}
