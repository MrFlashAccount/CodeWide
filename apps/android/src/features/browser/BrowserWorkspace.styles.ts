import { StyleSheet } from "react-native";
import { colors } from "../../theme";

export const styles = StyleSheet.create({
  hiddenPage: { display: "none" },
  page: {
    flex: 1,
    minHeight: 0,
  },
  pages: {
    flex: 1,
    minHeight: 0,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  tabBar: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
  },
});
