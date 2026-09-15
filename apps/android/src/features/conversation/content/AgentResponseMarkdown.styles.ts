import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  agentMarkdownDocument: {
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "flex-start",
    gap: spacing.xxs,
  },
  agentMarkdownDocumentFill: { width: "100%", alignSelf: "stretch" },
  errorText: { color: colors.red, ...typeScale.body },
});
