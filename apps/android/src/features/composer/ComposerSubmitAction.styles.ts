import { StyleSheet } from "react-native";
import { colors, radii, touchTarget } from "../../theme";

export const styles = StyleSheet.create({
  disabled: { opacity: 0.42 },
  sendButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.composer,
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  sendButtonPressed: { backgroundColor: colors.primaryPressed },
  stopButton: { backgroundColor: colors.red },
});
