import { StyleSheet } from "react-native";
import { colors, typeScale, typeWeight } from "../theme";

export const styles = StyleSheet.create({
  composerContextCount: {
    alignSelf: "center",
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: "center",
  },
  composerContextCountHidden: { opacity: 0 },
  composerContextRefreshOverlay: {
    alignItems: "flex-start",
    inset: 0,
    justifyContent: "center",
    position: "absolute",
  },
  composerContextText: {
    color: colors.textMuted,
    flexGrow: 0,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  composerContextValue: {
    alignSelf: "center",
    justifyContent: "center",
  },
  composerContextWave: {
    flexGrow: 0,
    flexShrink: 0,
  },
});
