import { StyleSheet } from "react-native";
import {
  filterIconButtonDotLayout,
  filterIconButtonPressed,
} from "../../presentation/input/filterIconButtonLayout";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  apply: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    justifyContent: "center",
    margin: spacing.sm,
    minHeight: controlSize.regular,
  },
  caption: {
    ...typeScale.caption,
    color: colors.textDim,
    flexShrink: 0,
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
    margin: spacing.md,
  },
  filterDot: {
    ...filterIconButtonDotLayout,
    backgroundColor: colors.primary,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
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
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultHeading: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: spacing.sm,
  },
  resultTitle: {
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
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
