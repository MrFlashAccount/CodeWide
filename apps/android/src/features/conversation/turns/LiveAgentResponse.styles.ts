import { Platform, StyleSheet } from "react-native";
import { spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  codeLine: {
    color: "#B8B8B8",
    maxWidth: "100%",
    minWidth: 0,
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
  },
  liveAgentResponse: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: 0,
  },
  liveAgentResponseFill: {
    alignSelf: "stretch",
    width: "100%",
  },
  liveMarkdownResponse: { gap: spacing.xxs },
});
