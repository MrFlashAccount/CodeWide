import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";

const DISABLED_OPACITY = 0.5;
const PRESSED_OPACITY = 0.72;

export const pullRequestReviewChatStyles = StyleSheet.create({
  draftPane: {
    flex: 1,
  },
  scenario: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  scenarioDisabled: {
    opacity: DISABLED_OPACITY,
  },
  scenarioError: {
    ...typeScale.caption,
    color: colors.error,
    textAlign: "center",
  },
  scenarioPressed: {
    opacity: PRESSED_OPACITY,
  },
  scenarioStart: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  scenarioStartLabel: {
    ...typeScale.body,
    color: colors.onPrimary,
    fontWeight: typeWeight.medium,
  },
  scenarioText: {
    ...typeScale.body,
    color: colors.text,
    textAlign: "center",
  },
});
