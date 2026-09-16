import { StyleSheet } from "react-native";
import { colors, controlSize, radii, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  activityMoreButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
  },
  activityMoreText: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  agentPlaceholder: {
    color: colors.textDim,
    ...typeScale.label,
  },
});
