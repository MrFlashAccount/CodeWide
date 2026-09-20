import { StyleSheet } from "react-native";
import { colors, radii } from "../../theme";

export const styles = StyleSheet.create({
  composerSticky: {
    // Keep a one-physical-pixel overlap so keyboard translation rounding cannot expose a seam.
    bottom: -StyleSheet.hairlineWidth,
    left: 0,
    minWidth: 0,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
  conversation: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
    minWidth: 0,
  },
  conversationContentSurface: {
    flex: 1,
    minHeight: 0,
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
  conversationKeyboard: {
    alignSelf: "stretch",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    minWidth: 0,
  },
  conversationKeyboardBody: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
    minHeight: 0,
  },
  conversationRaised: {
    borderBottomLeftRadius: radii.composer,
    borderTopLeftRadius: radii.composer,
    overflow: "hidden",
  },
});
