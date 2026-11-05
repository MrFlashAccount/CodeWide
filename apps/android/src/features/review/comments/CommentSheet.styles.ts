import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/** Matches AppButton's disabled feedback. */
const DISABLED_OPACITY = 0.5;
/** Focused field outline, as the focus-visible ring (N-04). */
const FOCUS_RING_WIDTH = 2;
/** Three body lines of room before the field grows. */
const INPUT_MIN_HEIGHT = 72;
/** About eight body lines before the editor scrolls instead of growing. */
const INPUT_MAX_HEIGHT = 180;

export const commentSheetStyles = StyleSheet.create({
  actions: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  content: {
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  editor: {
    borderColor: colors.primary,
    borderRadius: radii.small,
    borderWidth: FOCUS_RING_WIDTH,
    justifyContent: "center",
    minHeight: INPUT_MIN_HEIGHT,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  error: {
    ...typeScale.body,
    color: colors.error,
  },
  explanation: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    maxHeight: INPUT_MAX_HEIGHT,
    minHeight: INPUT_MIN_HEIGHT - spacing.xs - spacing.xs,
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
    alignSelf: "flex-start",
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
