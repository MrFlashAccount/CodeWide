import { StyleSheet } from "react-native";

import { colors, controlSize, spacing, typeScale } from "../../../theme";

/** Geometry of the Add account sheet: one header row above the current sign-in step. */
export const providerSignInStyles = StyleSheet.create({
  back: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
  },
  mark: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
});
