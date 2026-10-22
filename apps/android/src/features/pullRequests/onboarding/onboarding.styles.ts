import { StyleSheet } from "react-native";

import { colors, radii, spacing, typeScale, typeTracking, typeWeight } from "../../../theme";

/** A connect button keeps a readable width on tablets instead of spanning the card. */
const PRIMARY_BUTTON_MAX_WIDTH = 360;

/** Shared geometry of onboarding cards: 16dp inset, 12dp inner rhythm, no nested cards. */
export const onboardingStyles = StyleSheet.create({
  actions: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  body: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.md,
  },
  code: {
    ...typeScale.heading,
    color: colors.text,
    fontFamily: "monospace",
    letterSpacing: typeTracking.pairingCode,
  },
  codeBox: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.small,
    paddingVertical: spacing.sm,
  },
  // Sibling actions share the row width equally, so their edges align.
  equalAction: {
    flex: 1,
    minWidth: 0,
  },
  equalActions: {
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  error: {
    ...typeScale.body,
    color: colors.error,
  },
  fill: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  list: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  primaryButton: {
    alignSelf: "flex-start",
    maxWidth: PRIMARY_BUTTON_MAX_WIDTH,
  },
  section: {
    gap: spacing.sm,
  },
  // The sheet surface already insets its content; a sheet list adds only rhythm.
  sheetList: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  step: {
    ...typeScale.body,
    color: colors.text,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
  },
  weightMedium: {
    fontWeight: typeWeight.medium,
  },
});
