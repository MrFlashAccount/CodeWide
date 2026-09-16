import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  menuActionTitle: {
    color: colors.text,
    ...typeScale.title,
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
