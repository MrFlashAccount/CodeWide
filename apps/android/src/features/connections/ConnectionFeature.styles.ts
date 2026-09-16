import { StyleSheet } from "react-native";
import { radii, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  connectionStateDot: {
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  serverEmoji: { ...typeScale.emoji },
});
