import { StyleSheet } from "react-native";
import { touchTarget } from "../../theme";

export const styles = StyleSheet.create({
  composerIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  disabled: { opacity: 0.42 },
});
