import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  voiceCapture: {
    flex: 1,
    minHeight: touchTarget,
    paddingLeft: spacing.xxs,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.inputInset,
  },
  voiceMeter: {
    height: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  voiceMeterBar: {
    width: 3,
    minHeight: 4,
    maxHeight: 24,
    borderRadius: radii.compact,
    backgroundColor: colors.accent,
  },
  voiceCaptureLabel: {
    color: colors.textMuted,
    ...typeScale.voiceLabel,
    fontVariant: ["tabular-nums"],
  },
});
