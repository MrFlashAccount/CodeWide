import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  menuContentInset,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";

const PRESSED_OPACITY = 0.72;
const TRIGGER_ELEVATION = 4;

export const styles = StyleSheet.create({
  label: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  list: {
    gap: spacing.xxs,
    paddingHorizontal: menuContentInset,
    paddingVertical: spacing.xs,
  },
  listTitle: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  phrase: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  row: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
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
    backgroundColor: colors.surfaceHover,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    elevation: TRIGGER_ELEVATION,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xs,
    maxWidth: "92%",
    minHeight: controlSize.compact,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.inputInset,
  },
});
