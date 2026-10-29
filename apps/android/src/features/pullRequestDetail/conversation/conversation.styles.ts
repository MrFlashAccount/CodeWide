import { StyleSheet } from "react-native";

import { colors, radii } from "../../../theme";

/** Conversation surfaces share the merge box frame: a 16dp bordered card with hairline rows. */
export const conversationStyles = StyleSheet.create({
  frame: {
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    overflow: "hidden",
  },
});
