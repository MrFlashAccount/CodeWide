import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingBottom: spacing.xs,
    paddingTop: spacing.md,
    textTransform: "uppercase",
  },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  protocolBody: {
    alignSelf: "stretch",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  rawLink: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  searchResult: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    paddingVertical: spacing.compact,
  },
});
