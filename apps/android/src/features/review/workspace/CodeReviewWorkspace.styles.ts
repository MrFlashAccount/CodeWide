import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  attachButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  attachLabel: {
    ...typeScale.body,
    color: colors.onPrimary,
  },
  body: {
    ...typeScale.body,
    color: colors.text,
  },
  chrome: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    gap: spacing.xxs,
    height: controlSize.touch,
  },
  disabled: { opacity: 0.4 },
  hint: {
    ...typeScale.body,
    color: colors.textMuted,
    padding: spacing.md,
  },
  iconButton: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  location: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  note: {
    flex: 1,
    gap: spacing.xxs,
    padding: spacing.sm,
  },
  noteRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  review: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    height: controlSize.touch,
    justifyContent: "center",
    minWidth: controlSize.touch,
  },
  right: {
    alignItems: "center",
    flexDirection: "row",
    paddingRight: spacing.xxs,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
  },
  sheetBackdrop: {
    backgroundColor: colors.scrim,
    inset: 0,
    position: "absolute",
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    ...typeScale.title,
    color: colors.text,
    fontWeight: typeWeight.semibold,
    padding: spacing.sm,
  },
});
