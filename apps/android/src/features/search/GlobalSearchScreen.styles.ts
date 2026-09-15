import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  list: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.optical,
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingBottom: spacing.xs,
  },
  searchBar: {
    ...searchFieldLayout,
    height: controlSize.regular,
    flex: 1,
    minWidth: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: controlSize.regular,
    padding: 0,
    ...typeScale.body,
    color: colors.text,
  },
  filterButton: {
    width: controlSize.touch,
    minHeight: controlSize.touch,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainerLow,
  },
  icon: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    right: spacing.xs,
    top: spacing.xs,
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  reset: {
    minHeight: controlSize.regular,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  apply: {
    minHeight: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
    margin: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
  },
  empty: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  pagination: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  label: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
  resultTitle: {
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    color: colors.text,
  },
  resultHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  caption: {
    ...typeScale.caption,
    color: colors.textDim,
    flexShrink: 0,
  },
  notice: {
    ...typeScale.caption,
    color: colors.textMuted,
    margin: spacing.md,
  },
  error: {
    ...typeScale.caption,
    color: colors.error,
    margin: spacing.md,
  },
  partialNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  partialNoticeText: {
    flex: 1,
    minWidth: 0,
    ...typeScale.caption,
    color: colors.textMuted,
  },
  result: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  highlight: {
    color: colors.text,
    backgroundColor: colors.warningContainer,
  },
});
