import { StyleSheet } from "react-native";

import { spacing } from "../theme";

/** Layout shared by every complete Markdown document, including chat responses and forge content. */
export const completeMarkdownStyles = StyleSheet.create({
  document: {
    alignSelf: "flex-start",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
  },
  documentFill: {
    alignSelf: "stretch",
    width: "100%",
  },
});
