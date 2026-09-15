import { Platform, StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  diffFile: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    borderRadius: radii.small,
    backgroundColor: colors.code,
  },
  diffFileHeader: {
    width: "100%",
    minWidth: 0,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.compact,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    backgroundColor: colors.surface,
  },
  diffFilePath: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
  },
  diffKind: {
    flexShrink: 0,
    color: colors.textMuted,
    ...typeScale.caption,
    textTransform: "uppercase",
  },
  diffStat: {
    minWidth: 18,
    flexShrink: 0,
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  diffStatAdd: { color: colors.green },
  diffStatDelete: { color: colors.red },
  diffLines: {
    width: "100%",
    minWidth: 0,
    paddingVertical: spacing.xxs,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
});
