import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

const PRESSED_OPACITY = 0.72;

export const styles = StyleSheet.create({
  /** The anchor spans its row, so the menu below lines up with the row's edges. */
  anchorRow: {
    alignItems: "center",
  },
  label: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  lineRow: {
    alignItems: "center",
    paddingVertical: spacing.xxs,
    width: "100%",
  },
  phrase: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  result: {
    borderLeftColor: colors.border,
    borderLeftWidth: spacing.optical,
    marginBottom: spacing.xs,
    marginLeft: controlSize.compact,
    paddingLeft: spacing.sm,
  },
  row: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
  },
  rowDetails: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  rowName: {
    color: colors.text,
    ...typeScale.body,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xs,
    minHeight: controlSize.compact,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.sm,
  },
  /** An unmeasured row holds the pill's height so measuring it moves nothing. */
  unmeasuredLine: {
    minHeight: controlSize.compact + spacing.xxs + spacing.xxs,
  },
});
