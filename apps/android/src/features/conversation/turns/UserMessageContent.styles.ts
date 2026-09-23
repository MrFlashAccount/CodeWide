import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  attachmentChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: "100%",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  attachmentText: {
    color: colors.textMuted,
    flex: 1,
    ...typeScale.label,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  pendingUserMessageShimmer: { alignSelf: "stretch" },
  userBubbleText: {
    color: colors.text,
    ...typeScale.body,
  },
  userImageFill: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    flex: 1,
    height: "100%",
    justifyContent: "center",
    maxWidth: "100%",
    width: "100%",
  },
  userImageFrame: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    overflow: "hidden",
  },
  userImageGallery: {
    alignSelf: "flex-start",
    borderRadius: radii.small,
    maxWidth: "100%",
    overflow: "hidden",
    width: 320,
  },
  userImageSeparatedFromBody: {
    marginBottom: spacing.xxs,
  },
  userMessageAttachmentGridSeparated: {
    marginTop: spacing.xxs,
  },
  userMessageContent: {
    gap: spacing.compact,
    minWidth: 0,
  },
  userMessageExpandButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "flex-end",
    minHeight: controlSize.compact,
    paddingTop: spacing.xxs,
  },
  userMessageExpandText: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  userMessageMediaContent: {
    maxWidth: "100%",
    width: 320,
  },
  userMessageTextBlock: { minWidth: 0 },
});
