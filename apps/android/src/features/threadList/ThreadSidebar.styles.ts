import { StyleSheet } from "react-native";
import { colors } from "../../theme";

export const styles = StyleSheet.create({
  // Layout only; `CatalogTitle` owns the typography shared by every catalog.
  serverTitle: {
    flex: 1,
    minWidth: 0,
  },
  threadListContentSurface: {
    flex: 1,
    minHeight: 0,
  },
  threadListHeaderChrome: {
    backgroundColor: colors.threadListSurface,
    flexShrink: 0,
    zIndex: 1,
  },
  threadListSuspended: { flex: 1 },
  // Fills the catalog pane, whose box the pane frame sizes.
  threadSidebar: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    overflow: "hidden",
  },
});
