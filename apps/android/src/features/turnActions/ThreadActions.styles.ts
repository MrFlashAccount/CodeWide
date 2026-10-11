import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../theme";

const DISABLED_OPACITY = 0.45;

export const styles = StyleSheet.create({
  forkButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.md,
  },
  forkButtonDisabled: {
    opacity: DISABLED_OPACITY,
  },
  forkButtonText: {
    ...typeScale.body,
    color: colors.onPrimary,
  },
  forkHandoffNote: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  forkModelRow: {
    flexDirection: "row",
  },
  forkSheet: {
    gap: spacing.md,
  },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  headerMenuAnchor: {
    flexShrink: 0,
    height: touchTarget,
    width: touchTarget,
  },
  sheetEmpty: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
