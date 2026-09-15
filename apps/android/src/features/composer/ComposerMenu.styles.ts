import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.heading },
  sheetPage: { width: "100%", minHeight: 0 },
  expandedSheetPage: { flex: 1 },
  menuTitleRow: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  menuNotice: { color: colors.textMuted, ...typeScale.body, paddingVertical: spacing.xs },
  menuScroll: { flex: 1, minHeight: 0 },
  menuScrollContent: { paddingBottom: spacing.sm },
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },

  errorText: { color: colors.red, ...typeScale.body },
});
