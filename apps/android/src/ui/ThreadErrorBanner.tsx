import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "./AppText";

/** Non-modal failure details; expanding them never covers or disables the composer. */
export function ThreadErrorBanner({
  message,
  acceptsInput,
}: {
  message: string;
  acceptsInput: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View testID="thread-error-banner" style={styles.root}>
      <AppText accessibilityRole="alert" style={styles.title}>
        Response failed
      </AppText>
      {expanded && (
        <ScrollView style={styles.details} nestedScrollEnabled>
          <AppText selectable style={styles.message}>
            {message}
          </AppText>
        </ScrollView>
      )}
      {!expanded && (
        <AppText numberOfLines={2} style={styles.message}>
          {message}
        </AppText>
      )}
      <View style={styles.footer}>
        <AppText style={styles.hint}>
          {acceptsInput
            ? "You can send a new message."
            : "This message was not automatically retried."}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={styles.action}
        >
          <AppText style={styles.actionText}>{expanded ? "Hide details" : "Details"}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.inputInset,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.red,
    borderWidth: 1,
  },
  title: {
    ...typeScale.body,
    color: colors.red,
    fontWeight: typeWeight.semibold,
    marginBottom: spacing.xxs,
  },
  message: {
    ...typeScale.body,
    color: colors.text,
  },
  details: { maxHeight: typeScale.body.lineHeight * 6 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  hint: {
    ...typeScale.label,
    flex: 1,
    color: colors.textMuted,
  },
  action: {
    minHeight: controlSize.touch,
    justifyContent: "center",
    paddingHorizontal: spacing.xxs,
  },
  actionText: {
    ...typeScale.label,
    color: colors.text,
  },
});
