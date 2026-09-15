import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  searchResult: {
    paddingVertical: spacing.compact,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  rawLink: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  protocolBody: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    gap: spacing.xxs,
  },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
});
