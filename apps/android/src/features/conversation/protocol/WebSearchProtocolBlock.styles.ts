import { StyleSheet } from "react-native";
import { colors, spacing, touchTarget, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  openIcon: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
  },
  openIconText: {
    color: colors.textDim,
    ...typeScale.title,
  },
  resultContent: {
    flex: 1,
    minWidth: 0,
  },
  resultDomain: {
    color: colors.textMuted,
    ...typeScale.label,
    marginBottom: spacing.xxs,
  },
  resultIndex: {
    color: colors.textDim,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
    paddingTop: spacing.optical,
    width: spacing.lg,
  },
  resultSnippet: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.xxs,
  },
  resultTitle: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  searchResult: {
    alignItems: "flex-start",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingVertical: spacing.sm,
  },
});
