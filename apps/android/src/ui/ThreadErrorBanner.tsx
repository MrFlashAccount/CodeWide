import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "./AppText";

/** Non-modal failure details; expanding them never covers or disables the composer. */
export function ThreadErrorBanner({
  acceptsInput,
  message,
}: {
  acceptsInput: boolean;
  message: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.root} testID="thread-error-banner">
      <AppText accessibilityRole="alert" style={styles.title}>
        Response failed
      </AppText>
      {expanded && (
        <ScrollView nestedScrollEnabled style={styles.details}>
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
          onPress={() => {
            setExpanded(!expanded);
          }}
          style={styles.action}
        >
          <AppText style={styles.actionText}>{expanded ? "Hide details" : "Details"}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.xxs,
  },
  actionText: {
    ...typeScale.label,
    color: colors.text,
  },
  details: { maxHeight: typeScale.body.lineHeight * 6 },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  hint: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
  message: {
    ...typeScale.body,
    color: colors.text,
  },
  root: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.red,
    borderRadius: radii.medium,
    borderWidth: 1,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.inputInset,
  },
  title: {
    ...typeScale.body,
    color: colors.red,
    fontWeight: typeWeight.semibold,
    marginBottom: spacing.xxs,
  },
});
