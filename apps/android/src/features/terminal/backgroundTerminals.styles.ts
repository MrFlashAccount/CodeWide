import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.heading },
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
  errorText: { color: colors.red, ...typeScale.body },
});
