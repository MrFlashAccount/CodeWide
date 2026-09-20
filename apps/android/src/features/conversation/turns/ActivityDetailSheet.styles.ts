import { StyleSheet } from "react-native";
import { colors, spacing, touchTarget, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  row: {
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
