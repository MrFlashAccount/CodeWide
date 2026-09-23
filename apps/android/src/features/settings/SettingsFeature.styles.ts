import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
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
