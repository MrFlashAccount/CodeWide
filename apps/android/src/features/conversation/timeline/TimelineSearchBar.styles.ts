import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../../presentation/input/searchLayout";
import { colors, controlSize, spacing, typeScale } from "../../../theme";
export const styles = StyleSheet.create({
  searchInput: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.body, paddingVertical: 0 },
  threadSearchBar: {
    ...searchFieldLayout,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xxs,
  },
  searchAction: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  threadSearchCount: {
    color: colors.textMuted,
    ...typeScale.label,
    minWidth: 34,
    textAlign: "right",
  },
});
