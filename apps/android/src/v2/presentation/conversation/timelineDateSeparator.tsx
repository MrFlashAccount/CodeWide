import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";

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
  timestamp: string | null,
  previousTimestamp: string | null,
): string | null {
  const current = parseTimestamp(timestamp);
  if (current === null) return null;
  const previous = parseTimestamp(previousTimestamp);
  if (previous !== null && sameLocalDate(current, previous)) return null;
  return current.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function parseTimestamp(value: string | null): Date | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
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
