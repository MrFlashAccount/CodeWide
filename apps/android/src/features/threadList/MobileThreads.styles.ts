import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  mobileIdentity: {
    flex: 1,
    minWidth: 0,
  },
  mobileList: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    overflow: "hidden",
  },
  mobileTitle: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.title,
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
