import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  turnActivity: { maxWidth: "100%", alignSelf: "flex-start", marginTop: spacing.optical },
  turnActivityCompact: { marginTop: 0 },
  turnActivityExpanded: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch" },
  turnActivityToggle: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    paddingHorizontal: 0,
  },
  turnActivityToggleCompact: { minHeight: typeScale.body.lineHeight },
  activityIconSlot: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  activityChevronSlot: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  turnActivityLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  turnActivityLabelWave: { minWidth: 0, flexShrink: 1, alignSelf: "center" },
  turnActivityList: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    gap: spacing.xxs,
    paddingTop: spacing.optical,
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: spacing.optical,
  },
  turnActivityListWithoutToggle: { paddingLeft: 0 },
  thinkingStatusSection: {
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
});
