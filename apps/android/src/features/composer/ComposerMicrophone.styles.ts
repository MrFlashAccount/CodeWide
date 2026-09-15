import { StyleSheet } from "react-native";
import { touchTarget } from "../../theme";
export const styles = StyleSheet.create({
  composerIcon: {
    width: touchTarget,
    height: touchTarget,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.42 },
});
