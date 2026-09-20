import { StyleSheet } from "react-native";
import { filterIconButtonDotLayout } from "../../presentation/input/filterIconButtonLayout";
import { colors } from "../../theme";

export const styles = StyleSheet.create({
  threadFilterActiveDot: {
    ...filterIconButtonDotLayout,
    backgroundColor: colors.primary,
  },
});
