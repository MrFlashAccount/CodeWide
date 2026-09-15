import { StyleSheet } from "react-native";
import { colors, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
});
