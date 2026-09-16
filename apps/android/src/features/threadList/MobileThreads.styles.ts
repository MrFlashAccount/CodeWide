import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

export const styles = StyleSheet.create({
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  mobileIdentity: {
    flex: 1,
    minWidth: 0,
  },
  mobileList: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    overflow: "hidden",
  },
  mobileSearchWrap: {
    paddingBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
  },
  mobileSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  mobileTitle: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.title,
  },
  mobileTitleGrow: {
    flex: 1,
    minWidth: 0,
  },
  mobileTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.optical,
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
    paddingRight: threadListLayout.edgeInset,
  },
  mobileTitleSelector: {
    alignItems: "center",
    borderRadius: radii.medium,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    height: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    paddingVertical: 0,
  },
  threadListContentSurface: {
    flex: 1,
    minHeight: 0,
  },
  threadListHeaderChrome: {
    backgroundColor: colors.threadListSurface,
    flexShrink: 0,
  },
  threadListSuspended: { flex: 1 },
  threadSearchBox: {
    ...searchFieldLayout,
    flex: 1,
    height: controlSize.regular,
    minWidth: 0,
  },
  threadSearchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.optical,
    minWidth: 0,
    width: "100%",
  },
});
