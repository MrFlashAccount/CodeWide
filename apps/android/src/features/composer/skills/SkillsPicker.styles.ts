import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../../presentation/input/searchLayout";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";
import { listRowHeight } from "../../../ui/AppListRow.types";

export const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingBottom: spacing.xs,
  },
  search: { ...searchFieldLayout, flex: 1, minWidth: 0 },
  input: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  searchAction: {
    width: controlSize.compact,
    height: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
  },
  filter: {
    width: controlSize.regular,
    height: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    right: spacing.xs,
    top: spacing.xs,
    width: spacing.xxs,
    height: spacing.xxs,
    borderRadius: radii.compact,
    backgroundColor: colors.accent,
  },
  activeFilter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  filterLabel: { ...typeScale.label, color: colors.textMuted },
  list: { flex: 1, minHeight: 0 },
  content: { paddingBottom: spacing.md },
  notice: { ...typeScale.label, color: colors.textMuted, paddingVertical: spacing.sm },
  error: { ...typeScale.label, color: colors.red, paddingVertical: spacing.sm },
  groupHeader: {
    height: listRowHeight.single,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  groupTitle: { ...typeScale.label, color: colors.text, flex: 1, minWidth: 0 },
  count: { ...typeScale.label, color: colors.textDim },
  row: {
    height: listRowHeight.double,
    overflow: "hidden",
    backgroundColor: colors.surfaceContainer,
  },
  firstRow: { borderTopLeftRadius: radii.medium, borderTopRightRadius: radii.medium },
  lastRow: { borderBottomLeftRadius: radii.medium, borderBottomRightRadius: radii.medium },
  separator: {
    position: "absolute",
    bottom: 0,
    left: spacing.sm,
    right: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});
