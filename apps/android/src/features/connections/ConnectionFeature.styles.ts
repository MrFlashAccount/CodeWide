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
    marginTop: spacing.md,
  },
});
