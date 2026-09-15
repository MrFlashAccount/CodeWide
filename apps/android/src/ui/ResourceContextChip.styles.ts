import { StyleSheet } from "react-native";
import { colors, typeScale, typeWeight } from "../theme";

export const styles = StyleSheet.create({
composerContextText: {
    flexGrow: 0,
    flexShrink: 0,
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
composerContextCount: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "center",
    justifyContent: "center",
  },
composerContextCountHidden: { opacity: 0 },
composerContextRefreshOverlay: {
    position: "absolute",
    inset: 0,
    alignItems: "flex-start",
    justifyContent: "center",
  },
composerContextValue: { alignSelf: "center", justifyContent: "center" },
composerContextWave: { flexGrow: 0, flexShrink: 0 }
});
