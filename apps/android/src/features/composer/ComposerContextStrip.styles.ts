import { StyleSheet } from "react-native";
import { spacing } from "../../theme";
import { conversationChromeEdgeInset } from "../../ui/conversation-chrome-layout";
import { COMPOSER_CHIP_TOP_INSET } from "./composerLayout";

export const styles = StyleSheet.create({
  composerContextStrip: {
    flexGrow: 0,
    flexShrink: 0,
  },
  composerContextContent: {
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: COMPOSER_CHIP_TOP_INSET,
    paddingBottom: 0,
  },
});
