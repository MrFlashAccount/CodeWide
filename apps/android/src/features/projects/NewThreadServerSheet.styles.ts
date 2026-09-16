import { StyleSheet } from "react-native";
import { colors, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  flex: { flex: 1 },
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
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
