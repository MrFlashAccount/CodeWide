import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeTracking, typeWeight } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";
import { THREAD_LIST_SECTION_HEIGHT } from "./threadListModel";

export const styles = StyleSheet.create({
  section: {
    alignItems: "center",
    flexDirection: "row",
    height: THREAD_LIST_SECTION_HEIGHT,
    paddingLeft: spacing.md,
    paddingRight: spacing.md + threadListLayout.edgeInset,
  },
  sectionHeader: {
    color: colors.textMuted,
    flex: 1,
    includeFontPadding: false,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
    textTransform: "uppercase",
  },
});
