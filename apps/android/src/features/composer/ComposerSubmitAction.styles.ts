import { StyleSheet } from "react-native";
import { colors, radii, touchTarget } from "../../theme";
export const styles = StyleSheet.create({
  sendButton: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    borderRadius: radii.composer,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  sendButtonPressed: { backgroundColor: colors.primaryPressed },
  stopButton: { backgroundColor: colors.red },
  disabled: { opacity: 0.42 },
});
