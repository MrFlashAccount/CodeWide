import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  agentMarkdownDocument: {
    alignSelf: "flex-start",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
  },
  agentMarkdownDocumentFill: {
    alignSelf: "stretch",
    width: "100%",
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
});
