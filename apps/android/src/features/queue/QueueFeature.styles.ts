import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  layoutSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  sheetTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.heading,
  },
  menuTitleRow: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  queueRow: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    gap: spacing.compact,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.medium,
  },
  queueCompactRow: {
    minHeight: layoutSize.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  queueDragHandle: {
    width: 34,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  queueBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xxs,
  },
  queueText: {
    color: colors.text,
    ...typeScale.body,
  },
  queueMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  queueTime: {
    color: colors.textDim,
    ...typeScale.label,
  },
  queueSteerButton: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.inputInset,
    borderRadius: radii.medium,
    backgroundColor: colors.accent,
  },
  queueSteerLabel: {
    color: colors.onPrimary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
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
  menuScrollContent: { paddingBottom: spacing.sm },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
});
