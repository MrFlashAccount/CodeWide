import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../theme";
import { ProductText } from "../presentation/text/ProductText";

interface TimelineDateSeparatorProps {
  label: string;
}

export function TimelineDateSeparator(props: TimelineDateSeparatorProps): React.JSX.Element {
  const { label } = props;
  return (
    <View accessibilityLabel={label} style={styles.root} testID="timeline-date-separator">
      <View style={styles.line} />
      <ProductText numberOfLines={1} style={styles.label} tone="dim" weight="semibold">
        {label}
      </ProductText>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.caption,
    flexShrink: 0,
  },
  line: {
    backgroundColor: colors.borderSoft,
    flex: 1,
    height: 1,
  },
  root: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    width: "100%",
  },
});
