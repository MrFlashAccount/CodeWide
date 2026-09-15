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
  threadSidebar: {
    minWidth: 280,
    maxWidth: 480,
    flexShrink: 0,
    backgroundColor: colors.threadListSurface,
    overflow: "hidden",
  },
  threadListHeaderChrome: { flexShrink: 0, backgroundColor: colors.threadListSurface },
  threadListContentSurface: { flex: 1, minHeight: 0 },
  threadListSuspended: { flex: 1 },
  sidebarHeader: {
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingTop: 0,
    paddingBottom: spacing.xxs,
  },
  serverTitleRow: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  serverTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
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
  threadSearchBox: { ...searchFieldLayout, height: controlSize.regular, flex: 1, minWidth: 0 },
  searchBox: {
    height: controlSize.touch,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainer,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.body, paddingVertical: 0 },
  mobileSearchWrap: {
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingBottom: spacing.xs,
  },
});
