import { Platform } from "react-native";
import { colors, spacing, typeScale, typeWeight } from "../theme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
runningThreadTitle: {
    maxWidth: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
threadTitle: {
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
threadTitleWave: { maxWidth: "100%" },
emojiText: { fontFamily: Platform.select({ web: "system-ui", default: "sans-serif" }) }
});
