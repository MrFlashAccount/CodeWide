import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

const PRESSED_OPACITY = 0.68;

export const styles = StyleSheet.create({
  iconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  leading: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  leadingIcon: {
    position: "absolute",
  },
  list: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  notice: {
    color: colors.textMuted,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    ...typeScale.body,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  section: {
    gap: spacing.xxs,
  },
  sectionTitle: {
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    ...typeScale.label,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
  titleRow: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
});
