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
  menuActionTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
});
