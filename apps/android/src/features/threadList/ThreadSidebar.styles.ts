import { StyleSheet } from "react-native";
import { colors, typeScale, typeWeight } from "../../theme";

export const styles = StyleSheet.create({
  serverTitle: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  threadListContentSurface: {
    flex: 1,
    minHeight: 0,
  },
  threadListHeaderChrome: {
    backgroundColor: colors.threadListSurface,
    flexShrink: 0,
  },
  threadListSuspended: { flex: 1 },
  threadSidebar: {
    backgroundColor: colors.threadListSurface,
    flexShrink: 0,
    maxWidth: 480,
    minWidth: 280,
    overflow: "hidden",
  },
});
