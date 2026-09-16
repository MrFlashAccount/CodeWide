import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  conversationContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.compact,
  },
  conversationContentCompact: {
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  conversationContentWide: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
  },
  conversationScroll: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
  },
  historyBeginning: {
    color: colors.textDim,
    ...typeScale.caption,
    paddingVertical: spacing.md,
    textAlign: "center",
  },
});
