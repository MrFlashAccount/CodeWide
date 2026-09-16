import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  bubbleNestedSurface: { backgroundColor: "transparent" },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: spacing.xxs,
    width: "100%",
  },
  cardContent: {
    alignSelf: "stretch",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.compact,
    minWidth: 0,
    opacity: 1,
    width: "100%",
  },
  cardHeaderToggle: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.compact,
    minWidth: 0,
    opacity: 1,
  },
  cardIconSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  cardStatusDot: {
    backgroundColor: colors.green,
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  cardStatusIcon: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    minHeight: typeScale.label.lineHeight,
    minWidth: typeScale.label.lineHeight,
  },
  cardTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  cardTitleWave: {
    alignSelf: "center",
    justifyContent: "center",
  },
  flex: { flex: 1 },
});
