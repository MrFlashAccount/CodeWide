import { Pressable, StyleSheet, View } from "react-native";
import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Bounded recovery surface for invalid, expired, or removed V1 route resources. */
export function RouteUnavailable({
  actionLabel = "Back",
  message,
  onBack,
  title,
}: {
  readonly actionLabel?: string;
  readonly message: string;
  readonly onBack: () => void;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View accessibilityLiveRegion="polite" style={styles.root}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.action}>
        <Text style={styles.actionText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: colors.surface,
    // WHY: This route recovery control preserves the established compact 10dp action radius.
    // oxlint-disable-next-line eslint/no-magic-numbers
    borderRadius: 10,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  actionText: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  message: {
    color: colors.textMuted,
    ...typeScale.body,
    textAlign: "center",
  },
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    ...typeScale.heading,
  },
});
