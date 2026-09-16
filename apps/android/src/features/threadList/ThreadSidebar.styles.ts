import { StyleSheet } from "react-native";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import {
  colors,
  controlSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

export const styles = StyleSheet.create({
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  mobileSearchWrap: {
    paddingBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
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
  serverTitle: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  serverTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: touchTarget,
  },
  sidebarHeader: {
    paddingBottom: spacing.xxs,
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingTop: 0,
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
  threadSidebar: {
    backgroundColor: colors.threadListSurface,
    flexShrink: 0,
    maxWidth: 480,
    minWidth: 280,
    overflow: "hidden",
  },
});
