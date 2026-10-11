import { StyleSheet } from "react-native";
import { radii, spacing } from "../../theme";

export const styles = StyleSheet.create({
  connectionStateDot: {
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  softwareRows: {
    gap: spacing.xxs,
  },
  softwareSection: {
    // The connection editor above ends with `spacing.xs` of padding; together
    // they match the `spacing.md` + `spacing.xxs` gap before account sections.
    marginTop: spacing.sm,
  },
});
