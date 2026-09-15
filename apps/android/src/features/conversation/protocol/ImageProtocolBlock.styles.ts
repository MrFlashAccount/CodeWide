import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  userImage: {
    width: 220,
    maxWidth: "100%",
    aspectRatio: 4 / 3,
    overflow: "hidden",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  generatedImage: {
    width: "100%",
    maxWidth: 600,
    aspectRatio: 4 / 3,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  openableImage: { width: "100%", height: "100%", borderRadius: radii.medium },
  imageOpenBadge: {
    position: "absolute",
    right: 8,
    top: 8,
    width: controlSize.compact,
    height: controlSize.compact,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  menuNotice: { color: colors.textMuted, ...typeScale.body, paddingVertical: spacing.xs },
});
