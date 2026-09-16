import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  flex: { flex: 1 },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
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
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
