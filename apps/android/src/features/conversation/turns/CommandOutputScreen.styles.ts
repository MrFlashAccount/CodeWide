import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

const DOT_SIZE = 8;

export const styles = StyleSheet.create({
  command: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  commandError: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
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
  loading: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  search: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    ...typeScale.body,
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
