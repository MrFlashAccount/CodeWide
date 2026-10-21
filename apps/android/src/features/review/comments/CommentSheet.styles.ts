import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/** Matches AppButton's disabled feedback. */
const DISABLED_OPACITY = 0.5;
/** Focused field outline, as the focus-visible ring (N-04). */
const FOCUS_RING_WIDTH = 2;
/** Three body lines of room before the field grows. */
const INPUT_MIN_HEIGHT = 72;

export const commentSheetStyles = StyleSheet.create({
  content: {
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  error: {
    ...typeScale.body,
    color: colors.error,
  },
  explanation: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  footer: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  input: {
    ...typeScale.body,
    borderColor: colors.primary,
    borderRadius: radii.small,
    borderWidth: FOCUS_RING_WIDTH,
    color: colors.text,
    minHeight: INPUT_MIN_HEIGHT,
    padding: spacing.sm,
    textAlignVertical: "top",
  },
  label: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  path: {
    ...typeScale.code,
    color: colors.textMuted,
  },
  segment: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  segmentLabel: {
    ...typeScale.label,
    color: colors.text,
  },
  segments: {
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  segmentSelected: {
    backgroundColor: colors.surfaceContainerHighest,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
});
