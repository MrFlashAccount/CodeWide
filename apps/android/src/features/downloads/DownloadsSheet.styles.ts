import { StyleSheet } from "react-native";

import { disabledOpacity, colors, controlSize, radii, spacing, typeScale } from "../../theme";

const EMPTY_ICON_OPACITY = 0.8;
const EMPTY_VERTICAL_INSET = 72;
const PRESSED_OPACITY = 0.68;

export const styles = StyleSheet.create({
  dim: { opacity: disabledOpacity },
  empty: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: EMPTY_VERTICAL_INSET,
  },
  emptyIcon: { opacity: EMPTY_ICON_OPACITY },
  error: {
    color: colors.red,
    ...typeScale.body,
  },
  formActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  formButton: {
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  formTitle: {
    color: colors.text,
    ...typeScale.title,
  },
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
    paddingBottom: spacing.sm,
  },
  nameInput: {
    color: colors.text,
    ...typeScale.body,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.small,
    marginVertical: spacing.sm,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  notice: {
    color: colors.textMuted,

    ...typeScale.body,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  sectionTitle: {
    color: colors.textMuted,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    ...typeScale.label,
  },
  selectionBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  selectionTitle: {
    ...typeScale.title,
    color: colors.text,
    flex: 1,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
  titleRow: {
    alignItems: "center",
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
});
