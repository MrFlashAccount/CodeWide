import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  category: {
    gap: spacing.xxs,
  },
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  gridCell: {
    padding: spacing.xxs,
    width: "50%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  heading: {
    flex: 1,
    minWidth: 0,
  },
  hint: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  layoutButton: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  listCell: {
    padding: spacing.xxs,
    width: "100%",
  },
  pressed: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  service: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch + spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  services: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  serviceTitle: {
    color: colors.text,
    ...typeScale.body,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
  wideCell: {
    padding: spacing.xxs,
    width: "25%",
  },
});
