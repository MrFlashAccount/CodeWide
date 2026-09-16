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

export const styles = StyleSheet.create({
  advancedToggle: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: controlSize.regular,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  fieldGroup: {
    gap: spacing.xxs,
  },
  fieldInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: 1,
    color: colors.text,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    ...typeScale.body,
  },
  fieldLabel: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  flex: {
    flex: 1,
  },
  goalClearPrompt: {
    color: colors.red,
    ...typeScale.label,
  },
  goalDialogActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xxs,
    minHeight: controlSize.regular,
  },
  goalDialogClose: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: touchTarget,
  },
  goalDialogContent: { padding: 0 },
  goalDialogForm: {
    gap: spacing.md,
    padding: spacing.md,
  },
  goalDialogIntro: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  goalDialogTitle: {
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  goalObjectiveInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: 1,
    color: colors.text,
    minHeight: 112,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    textAlignVertical: "top",
    ...typeScale.body,
  },
});
