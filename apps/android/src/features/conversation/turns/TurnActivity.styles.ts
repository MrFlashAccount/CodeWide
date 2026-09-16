import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  activityChevronSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  activityIconSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
  pressed: { opacity: 0.68 },
  thinkingStatusSection: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: 0,
  },
  turnActivity: {
    alignSelf: "flex-start",
    marginTop: spacing.optical,
    maxWidth: "100%",
  },
  turnActivityCompact: { marginTop: 0 },
  turnActivityExpanded: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  turnActivityLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  turnActivityLabelWave: {
    alignSelf: "center",
    flexShrink: 1,
    minWidth: 0,
  },
  turnActivityList: {
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    paddingBottom: spacing.optical,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: spacing.optical,
    width: "100%",
  },
  turnActivityListWithoutToggle: { paddingLeft: 0 },
  turnActivityToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.compact,
    paddingHorizontal: 0,
  },
  turnActivityToggleCompact: { minHeight: typeScale.body.lineHeight },
});
