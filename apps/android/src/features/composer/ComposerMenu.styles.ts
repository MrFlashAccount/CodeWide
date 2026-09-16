import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingBottom: spacing.xs,
    paddingTop: spacing.md,
    textTransform: "uppercase",
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  expandedSheetPage: { flex: 1 },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  menuScroll: {
    flex: 1,
    minHeight: 0,
  },
  menuScrollContent: { paddingBottom: spacing.sm },
  menuTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  sheetPage: {
    minHeight: 0,
    width: "100%",
  },

  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
