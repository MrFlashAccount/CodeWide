import { View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { formatNumber } from "./number-format";
import { AppText as Text } from "./Typography";

export { compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./number-format";

export function AnimatedNumber({
  value,
  format,
  prefix = "",
  suffix = "",
  style,
  containerStyle,
  accessibilityLabel,
  testID,
}: {
  value: number;
  format?: Intl.NumberFormatOptions;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  animate?: boolean;
}) {
  const renderedText = `${prefix}${formatNumber(value, format)}${suffix}`;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? renderedText} testID={testID} style={containerStyle}>
      <Text style={style}>{renderedText}</Text>
    </View>
  );
}
