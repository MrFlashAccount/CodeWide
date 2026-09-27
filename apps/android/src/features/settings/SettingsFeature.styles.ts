import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { listRowHeight } from "../../ui/AppListRow.types";

export const styles = StyleSheet.create({
  agentModelRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: listRowHeight.single,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  agentModelTitle: {
    color: colors.text,
    ...typeScale.body,
  },
  agentModelValue: {
    color: colors.textMuted,
    flexShrink: 1,
    ...typeScale.body,
  },
  agentModelValueGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  helpText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  orbStyleSettings: { gap: spacing.md },
  personalityForm: { gap: spacing.sm },
  personalityInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: 1,
    color: colors.text,
    minHeight: touchTarget + touchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typeScale.body,
  },
  personalVoiceFilterSettings: {
    gap: spacing.sm,
  },
  personalVoiceFilterToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  saveButton: { alignSelf: "stretch" },
  savedText: {
    color: colors.green,
    ...typeScale.body,
  },
  voiceAssistantSettings: { gap: spacing.lg },
});
