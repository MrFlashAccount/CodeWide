import { StyleSheet } from "react-native";
import { colors, spacing, typeScale, typeTracking, typeWeight } from "../../theme";
import { THREAD_LIST_SECTION_HEIGHT } from "./threadListModel";

export const styles = StyleSheet.create({
  sectionHeader: {
    color: colors.textMuted,
    height: THREAD_LIST_SECTION_HEIGHT,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    textTransform: "uppercase",
  },
});
