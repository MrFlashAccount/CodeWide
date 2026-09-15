import { StyleSheet } from "react-native";
import { colors, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.heading },
  menuTitleRow: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  menuScroll: { flex: 1, minHeight: 0 },
  menuScrollContent: { paddingBottom: spacing.sm },
  errorText: { color: colors.red, ...typeScale.body },
});
