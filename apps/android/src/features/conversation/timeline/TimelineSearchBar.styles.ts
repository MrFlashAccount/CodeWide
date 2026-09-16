import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../../presentation/input/searchLayout";
import { colors, controlSize, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  searchAction: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    paddingVertical: 0,
  },
  threadSearchBar: {
    ...searchFieldLayout,
    marginBottom: spacing.xxs,
    marginHorizontal: spacing.md,
  },
  threadSearchCount: {
    color: colors.textMuted,
    ...typeScale.label,
    minWidth: 34,
    textAlign: "right",
  },
});
