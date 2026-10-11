import { StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "./AppText";

/** Persistent state of a conversation another app is running; it replaces the composer. */
export function ThreadOpenElsewhereNotice(): React.JSX.Element {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={styles.root}
      testID="thread-open-elsewhere-notice"
    >
      <AppText style={styles.title}>Conversation open elsewhere</AppText>
      <AppText style={styles.message}>
        Another app is running this conversation. You can read it here and send once it finishes.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  message: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  root: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.inputInset,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.semibold,
    marginBottom: spacing.xxs,
  },
});
