import { StyleSheet } from "react-native";
import {
  filterIconButtonDotLayout,
  filterIconButtonPressed,
} from "../../presentation/input/filterIconButtonLayout";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import { threadListLayout } from "../../ui/thread-list-layout";
import { colors, controlSize, menuContentInset, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  apply: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    justifyContent: "center",
    marginBottom: spacing.xs,
    marginHorizontal: menuContentInset,
    marginTop: spacing.sm,
    minHeight: controlSize.regular,
  },
  caption: {
    ...typeScale.caption,
    color: colors.textDim,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  clearButton: {
    alignItems: "center",
    borderRadius: radii.large,
    flexShrink: 0,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  empty: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  error: {
    ...typeScale.caption,
    color: colors.error,
    marginHorizontal: menuContentInset,
    marginVertical: spacing.md,
  },
  filterDot: {
    ...filterIconButtonDotLayout,
    backgroundColor: colors.primary,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: menuContentInset,
  },
  header: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.optical,
    minWidth: 0,
  },
  highlight: {
    backgroundColor: colors.warningContainer,
    color: colors.text,
  },
  iconButtonPressed: filterIconButtonPressed,
  input: {
    flex: 1,
    height: controlSize.regular,
    minWidth: 0,
    padding: 0,
    ...typeScale.body,
    color: colors.text,
  },
  label: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  list: { flex: 1 },
  notice: {
    ...typeScale.caption,
    color: colors.textMuted,
    margin: spacing.md,
  },
  partialNotice: {
    alignItems: "center",
    flexDirection: "row",
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
  reset: {
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  result: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.selected,
    gap: spacing.xs,
    marginHorizontal: threadListLayout.edgeInset,
    marginVertical: spacing.optical,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  resultExcerpt: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  resultHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  resultPressed: {
    backgroundColor: colors.secondaryContainer,
  },
  resultTitle: {
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
    color: colors.text,
  },
  root: {
    flex: 1,
    minHeight: 0,
  },
  searchBar: {
    ...searchFieldLayout,
    flex: 1,
    height: controlSize.regular,
    minWidth: 0,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
});
