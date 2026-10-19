import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";

const PRESSED_OPACITY = 0.72;
/** Floats over the timeline like the live plan's chip. */
const TRIGGER_ELEVATION = 4;

export const styles = StyleSheet.create({
  divider: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.label,
  },
  label: {
    color: colors.textMuted,
    flexShrink: 1,
    ...typeScale.label,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  rowName: {
    color: colors.text,
    ...typeScale.body,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    elevation: TRIGGER_ELEVATION,
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xxs,
    minHeight: controlSize.compact,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.inputInset,
  },
});
