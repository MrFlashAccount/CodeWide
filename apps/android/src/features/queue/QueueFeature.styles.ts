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
  menuScrollContent: { paddingBottom: spacing.sm },
  menuTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  queueBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xxs,
  },
  queueCompactRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: layoutSize.row,
  },
  queueDragHandle: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: 34,
  },
  queueMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  queueRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.compact,
    marginTop: spacing.xs,
    padding: spacing.xs,
  },
  queueSteerButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.inputInset,
  },
  queueSteerLabel: {
    color: colors.onPrimary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  queueText: {
    color: colors.text,
    ...typeScale.body,
  },
  queueTime: {
    color: colors.textDim,
    ...typeScale.label,
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
