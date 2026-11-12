import { StyleSheet } from "react-native";
import { catalogModeBarContentInset } from "../../presentation/layouts/catalogModeBarGeometry";
import { colors, radii, spacing, touchTarget } from "../../theme";

export const styles = StyleSheet.create({
  floatingBarContent: {
    paddingBottom: catalogModeBarContentInset,
  },
  mobileIdentity: {
    flex: 1,
    minWidth: 0,
  },
  mobileList: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    overflow: "hidden",
  },
  // Layout only; `CatalogTitle` owns the typography shared by every catalog.
  mobileTitle: {
    flexShrink: 1,
  },
  mobileTitleGrow: {
    flex: 1,
    minWidth: 0,
  },
  mobileTitleSelector: {
    alignItems: "center",
    borderRadius: radii.medium,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  searchOverlayList: { backgroundColor: "transparent" },
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
});
