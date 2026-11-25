import { Platform, StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/** The content viewer's rows and tail; its frame is the shared full-screen output frame. */
export const styles = StyleSheet.create({
  code: {
    color: "#D3D7DE",
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
  },
  content: {
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  failure: {
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  label: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingBottom: spacing.xxs,
    paddingTop: spacing.md,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  markdownRow: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  retryText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  row: {
    paddingHorizontal: spacing.sm,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
});
