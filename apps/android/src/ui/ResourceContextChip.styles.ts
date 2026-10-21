import { StyleSheet } from "react-native";
import { colors, typeScale, typeWeight } from "../theme";

/** One long name (a branch) gives way here instead of crowding the chip strip. */
const CONTEXT_LABEL_MAX_WIDTH = 200;

export const styles = StyleSheet.create({
  composerContextCount: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    flexGrow: 0,
    flexShrink: 0,
  },
  composerContextCountLabel: {
    flexShrink: 1,
    maxWidth: CONTEXT_LABEL_MAX_WIDTH,
  },
  composerContextText: {
    color: colors.textMuted,
    flexGrow: 0,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  composerContextWave: {
    flexGrow: 0,
    flexShrink: 0,
  },
});
