import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget, typeScale } from "../../../theme";

const PRESSED_OPACITY = 0.72;

export const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceHover,
    borderRadius: radii.pill,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  actionLabel: {
    color: colors.text,
    ...typeScale.label,
  },
  body: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  error: {
    color: colors.red,
    marginTop: spacing.xs,
    ...typeScale.label,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  output: {
    color: colors.text,
    ...typeScale.code,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  status: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
  },
});
