import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeWeight } from "../../../theme";

/** The status dot, like the avatars' badges. */
const DOT_SIZE = 8;

export const styles = StyleSheet.create({
  command: {
    backgroundColor: colors.code,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  commandPrompt: {
    color: colors.textDim,
    ...typeScale.code,
  },
  commandText: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.code,
  },
  details: {
    color: colors.textMuted,
    flexShrink: 1,
    ...typeScale.label,
  },
  dot: {
    borderRadius: DOT_SIZE,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
  error: {
    color: colors.red,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...typeScale.label,
  },
  status: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
});
