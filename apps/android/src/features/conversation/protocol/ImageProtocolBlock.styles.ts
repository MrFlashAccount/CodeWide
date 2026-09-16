import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  generatedImage: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    maxWidth: 600,
    width: "100%",
  },
  imageOpenBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: controlSize.compact,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  openableImage: {
    borderRadius: radii.medium,
    height: "100%",
    width: "100%",
  },
  userImage: {
    alignItems: "center",
    aspectRatio: 4 / 3,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    justifyContent: "center",
    maxWidth: "100%",
    overflow: "hidden",
    width: 220,
  },
});
