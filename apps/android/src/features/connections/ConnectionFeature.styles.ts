import { StyleSheet } from "react-native";
import { radii, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  serverEmoji: { ...typeScale.emoji },
  connectionStateDot: { width: 7, height: 7, borderRadius: radii.pill },
});
