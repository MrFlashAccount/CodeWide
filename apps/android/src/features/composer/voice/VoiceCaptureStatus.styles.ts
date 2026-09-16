import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  voiceCapture: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.inputInset,
    minHeight: touchTarget,
    paddingLeft: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  voiceCaptureLabel: {
    color: colors.textMuted,
    ...typeScale.voiceLabel,
    fontVariant: ["tabular-nums"],
  },
  voiceMeter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    height: controlSize.compact,
  },
  voiceMeterBar: {
    backgroundColor: colors.accent,
    borderRadius: radii.compact,
    maxHeight: 24,
    minHeight: 4,
    width: 3,
  },
});
