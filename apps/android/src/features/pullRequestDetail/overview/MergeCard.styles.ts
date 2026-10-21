import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing } from "../../../theme";

export const mergeCardStyles = StyleSheet.create({
  reason: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  split: {
    alignItems: "center",
    columnGap: spacing.optical,
    flexDirection: "row",
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  splitToggle: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
});
