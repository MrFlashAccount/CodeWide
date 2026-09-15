import { StyleSheet } from "react-native";
import { colors, radii } from "../../theme";

export const styles = StyleSheet.create({
  conversation: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.conversationSurface,
  },
  conversationRaised: {
    borderBottomLeftRadius: radii.composer,
    borderTopLeftRadius: radii.composer,
    overflow: "hidden",
  },
  conversationKeyboard: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    backgroundColor: colors.conversationSurface,
  },
  conversationHeaderChrome: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 30,
  },
  conversationHeaderUnderlay: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 29,
  },
  conversationContentSurface: {
    flex: 1,
    minHeight: 0,
  },
  conversationKeyboardBody: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
    minHeight: 0,
  },
  composerSticky: {
    bottom: 0,
    left: 0,
    minWidth: 0,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
});
