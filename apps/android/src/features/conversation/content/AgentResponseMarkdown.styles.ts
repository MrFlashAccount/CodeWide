import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  virtualizedMarkdownBlockGap: {
    paddingBottom: spacing.xxs,
  },
});
