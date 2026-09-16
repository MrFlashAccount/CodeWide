import { Platform, StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  diffFile: {
    backgroundColor: colors.code,
    borderRadius: radii.small,
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  diffFileHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: controlSize.compact,
    minWidth: 0,
    paddingHorizontal: spacing.compact,
    paddingVertical: spacing.xxs,
    width: "100%",
  },
  diffFilePath: {
    color: colors.text,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
  },
  diffKind: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.caption,
    textTransform: "uppercase",
  },
  diffLines: {
    minWidth: 0,
    paddingVertical: spacing.xxs,
    width: "100%",
  },
  diffStat: {
    flexShrink: 0,
    minWidth: 18,
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
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
});
