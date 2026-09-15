import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

export const styles = StyleSheet.create({
  threadListHeaderChrome: {
    flexShrink: 0,
    backgroundColor: colors.threadListSurface,
  },
  threadListContentSurface: {
    flex: 1,
    minHeight: 0,
  },
  threadListSuspended: { flex: 1 },
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  threadSearchRow: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.optical,
  },
  threadSearchBox: {
    ...searchFieldLayout,
    height: controlSize.regular,
    flex: 1,
    minWidth: 0,
  },
  searchBox: {
    height: controlSize.touch,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainer,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...typeScale.body,
    paddingVertical: 0,
  },
  mobileList: {
    flex: 1,
    backgroundColor: colors.threadListSurface,
    overflow: "hidden",
  },
  mobileTitleRow: {
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
    paddingRight: threadListLayout.edgeInset,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.optical,
  },
  mobileTitleSelector: {
    flex: 1,
    minWidth: 0,
    minHeight: touchTarget,
    paddingHorizontal: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.medium,
  },
  mobileIdentity: {
    flex: 1,
    minWidth: 0,
  },
  mobileTitle: {
    flexShrink: 1,
    color: colors.text,
    ...typeScale.title,
  },
  mobileTitleGrow: {
    flex: 1,
    minWidth: 0,
  },
  mobileSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  mobileSearchWrap: {
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingBottom: spacing.xs,
  },
});
