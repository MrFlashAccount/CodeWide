import { Platform } from "react-native";
import { colors, spacing, typeScale, typeWeight } from "../theme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  emojiText: {
    fontFamily: Platform.select({
      default: "sans-serif",
      web: "system-ui",
    }),
  },
  runningThreadTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    maxWidth: "100%",
    minWidth: 0,
  },
  threadTitle: {
    color: colors.text,
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  threadTitleWave: { maxWidth: "100%" },
});
