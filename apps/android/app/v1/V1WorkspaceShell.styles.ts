import { StyleSheet } from "react-native";

import { colors } from "../../src/theme";

export const v1WorkspaceShellStyles = StyleSheet.create({
  desktopWorkspace: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    flexDirection: "row",
  },
  flex: { flex: 1 },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
