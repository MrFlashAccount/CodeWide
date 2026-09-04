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

export function timelineDateSeparatorLabel(
  timestampMs: number,
  previousTimestampMs: number | null,
): string | null {
  if (!Number.isFinite(timestampMs)) return null;
  const current = new Date(timestampMs);
  if (!Number.isFinite(current.getTime())) return null;
  if (previousTimestampMs !== null && Number.isFinite(previousTimestampMs)) {
    const previous = new Date(previousTimestampMs);
    if (sameLocalDate(current, previous)) return null;
  }
  return current.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function sameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

const styles = StyleSheet.create({
  label: { ...typeScale.caption, flexShrink: 0 },
  line: { backgroundColor: colors.borderSoft, flex: 1, height: 1 },
  root: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    width: "100%",
  },
});
