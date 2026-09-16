import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../theme";

export const listRowStyles = StyleSheet.create({
  danger: { color: colors.red },
  description: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  disabled: { opacity: 0.4 },
  first: {
    borderTopLeftRadius: radii.medium,
    borderTopRightRadius: radii.medium,
  },
  last: {
    borderBottomLeftRadius: radii.medium,
    borderBottomRightRadius: radii.medium,
  },
  middle: {},
  only: { borderRadius: radii.medium },
  pressed: { opacity: 0.7 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  selected: { backgroundColor: colors.surfaceContainerHigh },
  separator: {
    backgroundColor: colors.border,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
  slot: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xs,
  },
  supporting: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  supportingText: {
    flex: 1,
    minWidth: 0,
  },
  surface: {
    backgroundColor: colors.surfaceContainer,
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
});
