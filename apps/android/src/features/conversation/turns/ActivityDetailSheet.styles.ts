import { StyleSheet } from "react-native";
import { colors, spacing, touchTarget, typeScale, typeTracking, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.lg,
    paddingHorizontal: 0,
  },
  detailContent: {
    paddingBottom: spacing.lg,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  row: {
    minWidth: 0,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
  webSearchCount: {
    color: colors.textDim,
    ...typeScale.label,
    marginTop: spacing.compact,
  },
  webSearchHeader: {
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  webSearchLabelText: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
    textTransform: "uppercase",
  },
  webSearchQuery: {
    color: colors.text,
    ...typeScale.heading,
    marginTop: spacing.xs,
  },
});
