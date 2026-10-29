import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../../theme";
import { CATALOG_ROW_CELL_HEIGHT } from "../../ui/CatalogRow.styles";
import { threadListLayout } from "../../ui/thread-list-layout";

const THREAD_LIST_SKELETON_PREVIEW_HEIGHT = 10;
const THREAD_LIST_SKELETON_TITLE_HEIGHT = 14;

export const styles = StyleSheet.create({
  threadListEmpty: {
    alignItems: "center",
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
  },
  threadListEmptyText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  threadListSkeleton: {
    paddingTop: spacing.xs,
  },
  threadListSkeletonPreview: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.compact,
    height: THREAD_LIST_SKELETON_PREVIEW_HEIGHT,
    width: "58%",
  },
  threadListSkeletonRow: {
    gap: spacing.xs,
    height: CATALOG_ROW_CELL_HEIGHT,
    justifyContent: "center",
    marginHorizontal: threadListLayout.edgeInset,
  },
  threadListSkeletonTitle: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.compact,
    height: THREAD_LIST_SKELETON_TITLE_HEIGHT,
    width: "78%",
  },
});
