import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";
import { listRowHeight } from "../../ui/AppListRow.types";

export const styles = StyleSheet.create({
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  flex: { flex: 1 },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  menuScroll: {
    flex: 1,
    minHeight: 0,
  },
  menuTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  sheetHeaderIconSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
  threadAttachmentCell: { height: listRowHeight.double },
  threadResourceDocumentContent: {
    alignSelf: "stretch",
    gap: spacing.sm,
    minWidth: 0,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  threadResourceOverlay: {
    backgroundColor: colors.surfaceContainerHigh,
    minHeight: 0,
    width: "100%",
  },
  threadResourcePreviewCenter: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 180,
    paddingHorizontal: spacing.md,
  },
  threadResourceRoute: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  threadResourcesContent: { paddingBottom: spacing.md },
  threadResourcesEmpty: {
    alignItems: "center",
    gap: spacing.xxs,
    justifyContent: "center",
    minHeight: 180,
  },
});
