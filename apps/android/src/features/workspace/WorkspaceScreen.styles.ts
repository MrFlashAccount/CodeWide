import { StyleSheet } from "react-native";
import { colors } from "../../theme";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  desktopWorkspace: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    flexDirection: "row",
  },
  flex: { flex: 1 },
});
