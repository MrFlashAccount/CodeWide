import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../../presentation/input/searchLayout";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";
import { listRowHeight } from "../../../ui/AppListRow.types";

export const styles = StyleSheet.create({
  activeFilter: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  content: { paddingBottom: spacing.md },
  count: {
    ...typeScale.label,
    color: colors.textDim,
  },
  error: {
    ...typeScale.label,
    color: colors.red,
    paddingVertical: spacing.sm,
  },
  filter: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  filterDot: {
    backgroundColor: colors.accent,
    borderRadius: radii.compact,
    height: spacing.xxs,
    position: "absolute",
    right: spacing.xs,
    top: spacing.xs,
    width: spacing.xxs,
  },
  filterLabel: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  firstRow: {
    borderTopLeftRadius: radii.medium,
    borderTopRightRadius: radii.medium,
  },
  groupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    height: listRowHeight.single,
    paddingBottom: spacing.xs,
    paddingTop: spacing.md,
  },
  groupTitle: {
    ...typeScale.label,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  lastRow: {
    borderBottomLeftRadius: radii.medium,
    borderBottomRightRadius: radii.medium,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  notice: {
    ...typeScale.label,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  root: {
    flex: 1,
    minHeight: 0,
  },
  row: {
    backgroundColor: colors.surfaceContainer,
    height: listRowHeight.double,
    overflow: "hidden",
  },
  search: {
    ...searchFieldLayout,
    flex: 1,
    minWidth: 0,
  },
  searchAction: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.compact,
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    paddingBottom: spacing.xs,
  },
  separator: {
    backgroundColor: colors.border,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
});
