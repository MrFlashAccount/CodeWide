import { Platform, StyleSheet } from "react-native";
import { spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  liveAgentResponse: {
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "flex-start",
  },
  liveAgentResponseFill: {
    width: "100%",
    alignSelf: "stretch",
  },
  liveMarkdownResponse: { gap: spacing.xxs },
  codeLine: {
    minWidth: 0,
    maxWidth: "100%",
    color: "#B8B8B8",
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
  },
});
