import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeTracking, typeWeight } from "../../theme";
import { THREAD_LIST_SECTION_HEIGHT } from "./threadListModel";

export const styles = StyleSheet.create({
  sectionHeader: {
    height: THREAD_LIST_SECTION_HEIGHT,
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
    textTransform: "uppercase",
    letterSpacing: typeTracking.caps,
  },
});
