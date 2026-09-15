import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  errorText: { color: colors.red, ...typeScale.body },
  flex: { flex: 1 },
  goalDialogContent: { gap: spacing.md },
  goalDialogIntro: { gap: spacing.xxs, paddingRight: spacing.xl },
  goalObjectiveInput: {
    minHeight: 112,
    color: colors.text,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    textAlignVertical: "top",
    ...typeScale.body,
  },
  goalClearPrompt: { color: colors.red, ...typeScale.label },
  goalDialogActions: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  fieldInput: {
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    ...typeScale.body,
  },
});
