import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/** Matches AppButton's disabled feedback. */
const DISABLED_OPACITY = 0.5;

export const reviewDockStyles = StyleSheet.create({
  danger: {
    color: colors.error,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  dock: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  main: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radii.medium,
    borderTopLeftRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  mainLabel: {
    ...typeScale.body,
    color: colors.onPrimary,
    fontWeight: typeWeight.medium,
  },
  mainSolo: {
    borderBottomRightRadius: radii.medium,
    borderTopRightRadius: radii.medium,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  split: {
    columnGap: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexShrink: 0,
  },
  summary: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
  toggle: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderBottomRightRadius: radii.medium,
    borderTopRightRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    width: controlSize.regular,
  },
});
