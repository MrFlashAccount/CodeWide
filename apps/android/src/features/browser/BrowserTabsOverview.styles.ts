import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  gridCell: {
    padding: spacing.xxs,
    width: "50%",
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  list: { padding: spacing.xs },
  listCell: { padding: spacing.xxs },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  title: {
    color: colors.text,
    flex: 1,
    ...typeScale.label,
  },
  wideGridCell: {
    padding: spacing.xxs,
    width: "25%",
  },
});
